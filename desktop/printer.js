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

// طابعات وهمية لوضع التجربة (بدون طابعات حقيقية): الورق يطلع على شاشة «محاكي الطابعات» + ملف PDF
const VIRTUAL = [
  { name: '🧪 تجريبية — الكاشير', status: 0, isDefault: true },
  { name: '🧪 تجريبية — مطبخ 1', status: 0 },
  { name: '🧪 تجريبية — مطبخ 2', status: 0 },
  { name: '🧪 تجريبية — مطبخ 3', status: 0 },
  { name: '🧪 تجريبية — مطفية', status: 0x80 },
  { name: '🧪 تجريبية — خلص الورق', status: 0x10 },
];
const isVirtual = (name) => VIRTUAL.some((v) => v.name === name);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap">';

// يجهّز الورقة: خط عربي + بدون هوامش + عرض الورق
function preparePage(html, widthMm) {
  let doc = /<html[\s>]/i.test(html) ? html : `<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
  const head = `<meta charset="UTF-8">${/Tajawal/.test(doc) && !/fonts\.googleapis/.test(doc) ? FONT_LINK : ''}<style>@page{margin:0}html,body{margin:0}::-webkit-scrollbar{display:none;width:0;height:0}</style>`;
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + head) : doc.replace(/<html[^>]*>/i, (m) => m + '<head>' + head + '</head>');
  return doc;
}

// يفتح الورقة بنافذة مخفية، ينتظر الخط والصور، ويرجع طولها
async function withPage(BrowserWindow, tmpDir, html, widthMm, extraPrefs, fn) {
  const file = path.join(tmpDir, 'sora3a-print-' + crypto.randomUUID() + '.html');
  fs.writeFileSync(file, preparePage(html, widthMm), 'utf8');
  const pxW = Math.max(200, Math.round((widthMm / 25.4) * 96));
  const win = new BrowserWindow({
    // النافذة قصيرة حتى القياس يطلع طول المحتوى الحقيقي (مو طول النافذة)
    show: false, width: pxW, height: 40, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, ...extraPrefs },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  try {
    await win.loadFile(file);
    // ننتظر الخط والصور (حد أقصى ثانيتين حتى ما تتأخر التذكرة إذا ماكو نت)
    await win.webContents.executeJavaScript(`Promise.race([
      Promise.all([document.fonts ? document.fonts.ready : 0, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]),
      new Promise((r) => setTimeout(r, 2000))]).then(() => 0)`);
    // إذا المحتوى أعرض من الورق (مثلاً فاتورة 80 ملم على ورق 58) نصغّره حتى يدخل كله — ما ينقص شي من الأطراف
    await win.webContents.executeJavaScript(`(() => { const W = document.documentElement.clientWidth || innerWidth;
      const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
      if (sw > W + 1) document.documentElement.style.zoom = String(W / sw); return 0; })()`);
    const hPx = await win.webContents.executeJavaScript(`(() => { const b = document.body; if (!b) return 40;
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return Math.ceil(Math.max(b.scrollHeight, r.height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom), 40)); })()`);
    return await fn(win, hPx, pxW);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(file, () => {});
  }
}

// الطباعة الفعلية بنافذة مخفية (Electron)
function makeRenderer(BrowserWindow, tmpDir) {
  return async function render(html, { printer, widthMm, copies }) {
    await withPage(BrowserWindow, tmpDir, html, widthMm, {}, async (win, hPx) => {
      // طول الورقة = طول المحتوى (ما يطلع ورق فارغ) + 6 ملم للقص
      const height = Math.max(Math.ceil((hPx * 25400) / 96) + 6000, 30000);
      const go = (custom) => new Promise((res, rej) => win.webContents.print({
        silent: true, deviceName: printer || '', printBackground: true, copies, margins: { marginType: 'none' },
        ...(custom ? { pageSize: { width: widthMm * 1000, height } } : {}),
      }, (ok, reason) => (ok ? res() : rej(new Error(reason || 'فشلت الطباعة')))));
      // بعض تعريفات الطابعات ما تقبل حجم ورق مخصص → نطبع بحجم ورق الطابعة نفسها
      try { await go(true); }
      catch (e) { if (/page|size|paper|media/i.test(String(e.message))) await go(false); else throw e; }
    });
  };
}

// الطابعة الوهمية: صورة الورقة للمحاكي + ملف PDF بمجلد التجربة
function makeVirtualRenderer(BrowserWindow, tmpDir, outDir, onPaper) {
  return async function renderVirtual(html, { printer, widthMm, copies, title }) {
    await withPage(BrowserWindow, tmpDir, html, widthMm, { offscreen: true }, async (win, hPx, pxW) => {
      const h = Math.min(Math.max(hPx, 40), 12000);
      win.setContentSize(pxW, h);
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: pxW, height: h });
      const pdf = await win.webContents.printToPDF({
        printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: { width: widthMm / 25.4, height: Math.max(h / 96 + 0.25, 1) },
      });
      const safe = (x) => String(x).replace(/[\\/:*?"<>|]/g, '').replace(/^🧪\s*/, '').trim().slice(0, 40) || 'طباعة';
      const dir = path.join(outDir, safe(printer));
      fs.mkdirSync(dir, { recursive: true });
      const at = new Date();
      const stamp = at.toTimeString().slice(0, 8).replace(/:/g, '-');
      const file = path.join(dir, `${stamp} ${safe(title)}.pdf`);
      fs.writeFileSync(file, pdf);
      onPaper({ printer, title, copies, widthMm, at: at.getTime(), png: img.toDataURL(), pdf: file, w: pxW, h });
    });
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

function createPrinter({ getPrinters: getReal, render: renderReal, virtual = null, retries = 1 }) {
  const testOn = () => !!(virtual && virtual.enabled());
  const getPrinters = async () => [...(await getReal().catch(() => [])), ...(testOn() ? VIRTUAL : [])];
  const render = (html, o) => (isVirtual(o.printer) ? virtual.render(html, o) : renderReal(html, o));
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
    // وضع التجربة: «الطابعة الافتراضية» = طابعة الكاشير الوهمية
    if (testOn() && !o.printer) o.printer = VIRTUAL[0].name;
    if (testOn() && o.fallback === '') o.fallback = VIRTUAL[0].name;
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

module.exports = { createPrinter, makeRenderer, makeVirtualRenderer, describeStatus, preparePage, cleanOpts, VIRTUAL, isVirtual };
