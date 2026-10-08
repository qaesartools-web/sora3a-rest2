// اختبار محرك الطباعة: الطابور، إعادة المحاولة، الطباعة البديلة، السجل
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrinter, describeStatus, preparePage, cleanOpts } = require('../printer');

const PRINTERS = [
  { name: 'Kitchen', status: 0 }, { name: 'Grill', status: 0 }, { name: 'Main', status: 0, isDefault: true },
  { name: 'OffPrinter', status: 0x80 }, { name: 'NoPaper', status: 0x10 },
];
function rig({ failOn = [], failTimes = {} } = {}) {
  const done = [];
  const left = { ...failTimes };
  const render = async (html, o) => {
    await new Promise((r) => setTimeout(r, 5));
    if (failOn.includes(o.printer)) throw new Error('boom');
    if (left[o.printer] > 0) { left[o.printer]--; throw new Error('flaky'); }
    done.push({ printer: o.printer, html, copies: o.copies, widthMm: o.widthMm });
  };
  return { done, p: createPrinter({ getPrinters: async () => PRINTERS, render }) };
}

test('prints to the named printer with clean options', async () => {
  const { done, p } = rig();
  const r = await p.print('<html><body>x</body></html>', { printer: 'Kitchen', widthMm: 58, copies: 2, title: 'تذكرة' });
  assert.equal(r.ok, true);
  assert.deepEqual(done.map((d) => [d.printer, d.copies, d.widthMm]), [['Kitchen', 2, 58]]);
});

test('jobs on the same printer never overlap (queue), different printers run together', async () => {
  let active = 0, maxActive = 0;
  const p = createPrinter({ getPrinters: async () => PRINTERS, render: async (_h, o) => {
    if (o.printer === 'Kitchen') { active++; maxActive = Math.max(maxActive, active); }
    await new Promise((r) => setTimeout(r, 20));
    if (o.printer === 'Kitchen') active--;
  } });
  await Promise.all([1, 2, 3].map(() => p.print('a', { printer: 'Kitchen' })).concat(p.print('b', { printer: 'Grill' })));
  assert.equal(maxActive, 1);
});

test('a flaky failure is retried once and succeeds', async () => {
  const { done, p } = rig({ failTimes: { Grill: 1 } });
  const r = await p.print('t', { printer: 'Grill' });
  assert.equal(r.ok, true); assert.equal(done.length, 1);
});

test('a dead section printer → ticket goes to the main printer with a warning (not lost)', async () => {
  const { done, p } = rig({ failOn: ['Grill'] });
  const r = await p.print('<html><body><b>T</b></body></html>', { printer: 'Grill', fallback: 'Main', title: 'تذكرة الشوي' });
  assert.equal(r.ok, false); assert.equal(r.fallback, true);
  assert.equal(done.length, 1); assert.equal(done[0].printer, 'Main');
  assert.match(done[0].html, /طابعة «Grill» ما اشتغلت/); assert.match(done[0].html, /<b>T<\/b>/);
  const j = p.jobs()[0]; assert.equal(j.ok, false); assert.equal(j.fallback, 'Main');
});

test('offline / out-of-paper / missing printers are detected before printing and fall back', async () => {
  for (const name of ['OffPrinter', 'NoPaper', 'Ghost']) {
    const { done, p } = rig();
    const r = await p.print('x', { printer: name, fallback: 'Main' });
    assert.equal(r.fallback, true, name);
    assert.deepEqual(done.map((d) => d.printer), ['Main'], name);
    assert.ok(r.error.length > 3, name);
  }
});

test('no fallback configured → reports the error', async () => {
  const { done, p } = rig({ failOn: ['Kitchen'] });
  const r = await p.print('x', { printer: 'Kitchen' });
  assert.equal(r.ok, false); assert.equal(r.fallback, false); assert.equal(done.length, 0);
});

test('history keeps the last 50 jobs and can reprint', async () => {
  const { done, p } = rig();
  for (let i = 0; i < 55; i++) await p.print('job' + i, { printer: 'Main', title: 'فاتورة ' + i });
  const js = p.jobs();
  assert.equal(js.length, 50); assert.equal(js[0].title, 'فاتورة 54'); assert.equal(js[0].canReprint, true);
  assert.equal(js[0].html, undefined, 'html not exposed in the list');
  const r = await p.reprint(js[0].id);
  assert.equal(r.ok, true); assert.equal(done.at(-1).html, 'job54');
  assert.match(p.jobs()[0].title, /^🔁 فاتورة 54$/);
});

test('printer list carries readable status', async () => {
  const { p } = rig();
  const l = await p.printers();
  assert.deepEqual(l.find((x) => x.name === 'OffPrinter'), { name: 'OffPrinter', displayName: 'OffPrinter', isDefault: false, ok: false, statusText: 'مطفية أو مفصولة' });
  assert.equal(l.find((x) => x.name === 'Main').isDefault, true);
  assert.deepEqual(describeStatus(0), { ok: true, statusText: 'جاهزة' });
});

test('options are clamped; page gets Arabic font and zero margins', () => {
  assert.deepEqual(cleanOpts({ copies: 99, widthMm: 5000, printer: 7 }), { printer: '', widthMm: 80, copies: 5, title: 'طباعة', fallback: null });
  const doc = preparePage('<div style="font-family:Tajawal">x</div>', 80);
  assert.match(doc, /fonts\.googleapis\.com/); assert.match(doc, /@page\{margin:0\}/); assert.match(doc, /<body><div/);
});

test('test mode: virtual printers appear, go to the simulator renderer, and "off" printers fall back', async () => {
  let on = false;
  const real = [], virt = [];
  const p = createPrinter({
    getPrinters: async () => [],
    render: async (h, o) => { real.push(o.printer); },
    virtual: { enabled: () => on, render: async (h, o) => { virt.push({ printer: o.printer, html: h }); } },
  });
  assert.equal((await p.printers()).length, 0, 'no virtual printers unless test mode is on');
  on = true;
  const list = await p.printers();
  assert.equal(list.length, 6);
  assert.deepEqual(list.filter((x) => !x.ok).map((x) => x.statusText), ['مطفية أو مفصولة', 'خلص الورق']);
  // «الطابعة الافتراضية» بوضع التجربة = طابعة الكاشير الوهمية
  assert.equal((await p.print('r', { printer: '', title: 'فاتورة' })).ok, true);
  assert.equal(virt.at(-1).printer, '🧪 تجريبية — الكاشير');
  assert.equal((await p.print('k', { printer: '🧪 تجريبية — مطبخ 2', fallback: '' })).ok, true);
  assert.equal(virt.at(-1).printer, '🧪 تجريبية — مطبخ 2');
  // الطابعة الوهمية «المطفية» → تنطبع على الكاشير الوهمية مع التنبيه
  const r = await p.print('<html><body>T</body></html>', { printer: '🧪 تجريبية — مطفية', fallback: '' });
  assert.equal(r.fallback, true);
  assert.equal(virt.at(-1).printer, '🧪 تجريبية — الكاشير');
  assert.match(virt.at(-1).html, /ما اشتغلت/);
  assert.deepEqual(real, [], 'nothing reached a real printer');
});
