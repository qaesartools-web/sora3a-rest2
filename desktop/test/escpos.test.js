// اختبار طباعة الصورة (ESC/POS) للطابعات بتعريف «Generic / Text Only» — حتى العربي ما يطلع رموز
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../escpos');
const { createRaw, isTextOnlyDriver, parseDrivers, SEND_PS, DRIVERS_PS } = require('../rawprint');
const { makeAutoRenderer, createPrinter } = require('../printer');

// صورة BGRA صغيرة: مربع أسود بنص أبيض
function img(w, h, blackRows) {
  const b = Buffer.alloc(w * h * 4, 255);
  for (const y of blackRows) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; b[p] = b[p + 1] = b[p + 2] = 0; }
  return b;
}

test('paper width → printer dots: 80 mm at 203 dpi = 576, at 180 dpi (SAM4S GIANT-100) = 512, unknown = 512 (fits every 80 mm printer); 58 mm = 384', () => {
  assert.equal(E.dotsFor(80, 203), 576); assert.equal(E.dotsFor(80, 180), 512); assert.equal(E.dotsFor(80), 512);
  assert.equal(E.dotsFor(58), 384); assert.equal(E.dotsFor(58, 203), 384);
});

test('threshold: dark = black, light and transparent = white', () => {
  const b = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 120, 120, 120, 255]);
  assert.deepEqual([...E.threshold(b, 4, 1)], [1, 0, 0, 1]);
});

test('raster: GS v 0 header, bits packed left→right, split into 128-line bands', () => {
  const w = 10, h = 130, black = new Uint8Array(w * h);
  black[0] = 1; black[9] = 1;                    // أول سطر: أول نقطة وآخر نقطة
  const r = E.raster(black, w, h);
  assert.deepEqual([...r.subarray(0, 8)], [0x1d, 0x76, 0x30, 0x00, 2, 0, 128, 0]);
  assert.equal(r[8], 0x80); assert.equal(r[9], 0x40);
  const second = 8 + 2 * 128;
  assert.deepEqual([...r.subarray(second, second + 8)], [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
  assert.equal(r.length, 8 + 2 * 128 + 8 + 2 * 2);
});

test('job: init + image + feed + cut for each copy; blank tail trimmed', () => {
  const w = 8, h = 6, black = E.threshold(img(w, h, [1]), w, h);
  assert.equal(E.trimBottom(black, w, h), 2);
  const j = E.job(black, w, 2, 2);
  const one = 2 + 3 + (8 + 2) + 3 + 4;
  assert.equal(j.length, one * 2);
  assert.deepEqual([...j.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x61, 0x01], 'init + centre the image');
  assert.deepEqual([...j.subarray(one - 4, one)], [0x1d, 0x56, 0x42, 0x00]);
  assert.deepEqual([...E.job(black, w, 2, 1, { kick: true }).subarray(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

test('Generic / Text Only driver is detected (the one that prints Arabic as ╟ß π)', () => {
  assert.equal(isTextOnlyDriver('Generic / Text Only'), true);
  assert.equal(isTextOnlyDriver('generic/text only'), true);
  assert.equal(isTextOnlyDriver('POS-80C'), false);
  assert.equal(isTextOnlyDriver('EPSON TM-T20II Receipt5'), false);
  assert.equal(isTextOnlyDriver(''), false);
  const m = parseDrivers('[{"n":"CHALLENGE MONSTER 80mm","d":"Generic / Text Only","r":0},{"n":"طابعة المطبخ","d":"SAM4S GIANT-100","r":180}]');
  assert.deepEqual(m.get('CHALLENGE MONSTER 80mm'), { driver: 'Generic / Text Only', dpi: 0 }); assert.deepEqual(m.get('طابعة المطبخ'), { driver: 'SAM4S GIANT-100', dpi: 180 });
  assert.equal(parseDrivers('{"n":"One","d":"X"}').get('One').driver, 'X');
  assert.equal(parseDrivers('garbage').size, 0);
});

test('raw sender: printer name and file go by environment (never inside the command), RAW data type', async () => {
  const calls = [];
  const raw = createRaw({ tmpDir: require('os').tmpdir(), run: async (script, env) => {
    calls.push({ script, env });
    if (script === DRIVERS_PS) return '[{"n":"CHALLENGE MONSTER 80mm","d":"Generic / Text Only","r":60},{"n":"Kitchen","d":"SAM4S GIANT-100","r":180}]';
    assert.equal(require('fs').readFileSync(env.SORA_RAW_FILE).toString('hex'), '1b40');
    return 'OK';
  } });
  assert.equal(await raw.isTextOnly('CHALLENGE MONSTER 80mm'), true);
  assert.equal(await raw.isTextOnly('Kitchen'), false);
  assert.equal(calls.length, 1, 'driver list cached');
  assert.equal(await raw.dpi('Kitchen'), 180, 'dpi from the real driver');
  assert.equal(await raw.dpi('CHALLENGE MONSTER 80mm'), 0, 'text-only driver does not know the printer dpi');
  assert.equal(await raw.isTextOnly('New one'), false);
  assert.equal(calls.length, 2, 'unknown printer → read the list again');
  await raw.send('طابعة "x" & y', Buffer.from([0x1b, 0x40]), 'فاتورة #5');
  const s = calls[2];
  assert.equal(s.env.SORA_RAW_PRINTER, 'طابعة "x" & y'); assert.equal(s.env.SORA_RAW_TITLE, 'فاتورة #5');
  assert.doesNotMatch(s.script, /طابعة/); assert.match(SEND_PS, /pDataType = "RAW"/); assert.match(SEND_PS, /\n'@\n/);
  await assert.rejects(createRaw({ tmpDir: require('os').tmpdir(), run: async () => 'ERR open 1801' }).send('X', Buffer.from([1])), /ما استلمت/);
});

test('auto renderer: text-only printer → image (raw), other printers → normal Windows print; default printer resolved', async () => {
  const used = [];
  const render = makeAutoRenderer({
    normal: async (_h, o) => used.push(['normal', o.printer]),
    raw: async (_h, o) => used.push(['raw', o.printer, o.dpi]),
    isTextOnly: async (n) => n === 'CHALLENGE MONSTER 80mm',
    dpiOf: async () => 180,
    defaultName: async () => 'CHALLENGE MONSTER 80mm',
  });
  await render('x', { printer: 'CHALLENGE MONSTER 80mm' });
  await render('x', { printer: 'Kitchen' });
  await render('x', { printer: '' });
  assert.deepEqual(used, [['raw', 'CHALLENGE MONSTER 80mm', 180], ['normal', 'Kitchen'], ['raw', 'CHALLENGE MONSTER 80mm', 180]]);
  // فحص التعريف خرب ← طباعة عادية (ما توكف الطباعة)
  const r2 = makeAutoRenderer({ normal: async () => used.push(['normal2']), raw: async () => used.push(['raw2']), isTextOnly: async () => { throw new Error('ps'); } });
  await r2('x', { printer: 'A' });
  assert.deepEqual(used.at(-1), ['normal2']);
  // الصورة فشلت ← تنطبع بالطريقة العادية (الورقة ما تضيع)
  const r3 = makeAutoRenderer({ normal: async () => used.push(['normal3']), raw: async () => { throw new Error('viz'); }, isTextOnly: async () => true });
  await r3('x', { printer: 'A' });
  assert.deepEqual(used.at(-1), ['normal3']);
  const r4 = makeAutoRenderer({ normal: async () => { throw new Error('off'); }, raw: async () => { throw new Error('raw off'); }, isTextOnly: async () => true });
  await assert.rejects(r4('x', { printer: 'A' }), /raw off/);
});

test('printer list marks text-only printers (the cashier shows «تنطبع كصورة»)', async () => {
  const p = createPrinter({ platform: 'win32', getPrinters: async () => [{ name: 'M', status: 0 }, { name: 'K', status: 0 }, { name: 'G', status: 0 }], render: async () => {},
    isTextOnly: async (n) => n === 'M', isImage: (n) => n === 'G' });
  const l = await p.printers();
  assert.equal(l[0].textOnly, true); assert.equal(l[1].textOnly, undefined);
  assert.equal(l[2].image, true, 'image mode switched on by the cashier'); assert.equal(l[1].image, undefined);
});
