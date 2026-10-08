// سرعة — محرك الطباعة داخل برنامج الكاشير (بدال QZ Tray)
// • يطبع بصمت على أي طابعة معرّفة بالويندوز بالاسم
// • طابور لكل طابعة (التذاكر ما تتداخل) + إعادة محاولة
// • إذا طابعة القسم ما اشتغلت: تنطبع التذكرة على الطابعة الرئيسية مع تنبيه (ما تضيع)
// • سجل آخر 50 طباعة مع إعادة الطباعة
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// حالات طابعة الويندوز (PRINTER_STATUS_*) اللي تعني إنها ما تطبع
const BAD = [
  [0x80, 'مطفية أو مفصولة'], [0x1000, 'غير متاحة'], [0x10, 'خلص الورق'], [0x8, 'الورق عالق'],
  [0x40, 'مشكلة بالورق'], [0x400000, 'الغطاء مفتوح'], [0x2, 'بيها خطأ'], [0x1, 'موقوفة مؤقتاً'],
  [0x100000, 'تحتاج تدخل'], [0x40000, 'خلص الحبر'],
];
function describeStatus(status) {
  const st = Number(status) || 0;
  const bad = BAD.find(([bit]) => st & bit);
  return bad ? { ok: false, statusText: bad[1] } : { ok: true, statusText: 'جاهزة' };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap">';

// يجهّز الورقة: خط عربي + بدون هوامش + عرض الورق
function preparePage(html, widthMm) {
  let doc = /<html[\s>]/i.test(html) ? html : `<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
  const head = `<meta charset="UTF-8">${/Tajawal/.test(doc) && !/fonts\.googleapis/.test(doc) ? FONT_LINK : ''}<style>@page{margin:0}html,body{margin:0}</style>`;
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + head) : doc.replace(/<html[^>]*>/i, (m) => m + '<head>' + head + '</head>');
  return doc;
}

// الطباعة الفعلية بنافذة مخفية (Electron)
function makeRenderer(BrowserWindow, tmpDir) {
  return async function render(html, { printer, widthMm, copies }) {
    const file = path.join(tmpDir, 'sora3a-print-' + crypto.randomUUID() + '.html');
    fs.writeFileSync(file, preparePage(html, widthMm), 'utf8');
    const win = new BrowserWindow({
      show: false, width: Math.max(200, Math.round((widthMm / 25.4) * 96)), height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await win.loadFile(file);
      // ننتظر الخط والصور (حد أقصى ثانيتين حتى ما تتأخر التذكرة إذا ماكو نت)
      await win.webContents.executeJavaScript(`Promise.race([
        Promise.all([document.fonts ? document.fonts.ready : 0, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]),
        new Promise((r) => setTimeout(r, 2000))]).then(() => 0)`);
      const hPx = await win.webContents.executeJavaScript('Math.ceil(Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight))');
      // طول الورقة = طول المحتوى (ما يطلع ورق فارغ) + 6 ملم للقص
      const height = Math.max(Math.ceil((hPx * 25400) / 96) + 6000, 30000);
      const go = (custom) => new Promise((res, rej) => win.webContents.print({
        silent: true, deviceName: printer || '', printBackground: true, copies, margins: { marginType: 'none' },
        ...(custom ? { pageSize: { width: widthMm * 1000, height } } : {}),
      }, (ok, reason) => (ok ? res() : rej(new Error(reason || 'فشلت الطباعة')))));
      // بعض تعريفات الطابعات ما تقبل حجم ورق مخصص → نطبع بحجم ورق الطابعة نفسها
      try { await go(true); }
      catch (e) { if (/page|size|paper|media/i.test(String(e.message))) await go(false); else throw e; }
    } finally {
      if (!win.isDestroyed()) win.destroy();
      fs.rm(file, () => {});
    }
  };
}

function cleanOpts(o) {
  o = o || {};
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const w = Number(o.widthMm);
  return {
    printer: str(o.printer, 200),
    widthMm: w >= 40 && w <= 120 ? Math.round(w) : 80,
    copies: Math.max(1, Math.min(5, Math.round(Number(o.copies) || 1))),
    title: str(o.title, 80) || 'طباعة',
    fallback: typeof o.fallback === 'string' ? o.fallback.slice(0, 200) : null,
  };
}

function createPrinter({ getPrinters, render, retries = 1 }) {
  const queues = new Map();
  const jobs = [];
  let seq = 0;
  const enqueue = (key, fn) => {
    const run = (queues.get(key) || Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  };
  async function attempt(html, o) {
    let err = null;
    for (let i = 0; i <= retries; i++) {
      try { await enqueue(o.printer, () => render(html, o)); return null; }
      catch (e) { err = String((e && e.message) || e); }
    }
    return err;
  }
  async function print(html, opts) {
    const o = cleanOpts(opts);
    const job = { id: ++seq, at: Date.now(), title: o.title, printer: o.printer || 'الطابعة الافتراضية', copies: o.copies, ok: null, error: '', fallback: '', html: html.length < 400000 ? html : '', opts: o };
    jobs.unshift(job); if (jobs.length > 50) jobs.length = 50;
    let err = null;
    if (o.printer) {
      const list = await getPrinters().catch(() => []);
      const p = list.find((x) => x.name === o.printer);
      if (!p) err = 'الطابعة مو موجودة بهالحاسبة';
      else if (!describeStatus(p.status).ok) err = 'الطابعة ' + describeStatus(p.status).statusText;
    }
    if (!err) err = await attempt(html, o);
    if (!err) { job.ok = true; return { ok: true, id: job.id, printer: job.printer }; }
    job.ok = false; job.error = err;
    // ما نضيّع التذكرة: نطبعها على الطابعة الرئيسية مع تنبيه
    if (o.fallback !== null && o.fallback !== o.printer) {
      const note = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;border:2px solid #000;margin:4px;padding:4px;font-size:14px;font-weight:900">⚠️ طابعة «${esc(o.printer || 'الافتراضية')}» ما اشتغلت</div>`;
      const html2 = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + note) : note + html;
      const err2 = await attempt(html2, { ...o, printer: o.fallback });
      if (!err2) { job.fallback = o.fallback || 'الطابعة الافتراضية'; return { ok: false, fallback: true, error: err, id: job.id, printer: job.fallback }; }
      job.error += ' — والرئيسية: ' + err2;
    }
    return { ok: false, fallback: false, error: job.error, id: job.id };
  }
  return {
    print,
    async printers() {
      const list = await getPrinters().catch(() => []);
      return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, ...describeStatus(p.status) }));
    },
    jobs: () => jobs.map(({ html, opts, ...j }) => ({ ...j, canReprint: !!html })),
    async reprint(id) {
      const j = jobs.find((x) => x.id === Number(id));
      if (!j || !j.html) return { ok: false, error: 'ما لكينا هالطباعة' };
      return print(j.html, { ...j.opts, title: '🔁 ' + j.opts.title.replace(/^🔁 /, '') });
    },
  };
}

module.exports = { createPrinter, makeRenderer, describeStatus, preparePage, cleanOpts };
