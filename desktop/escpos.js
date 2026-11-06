// أوامر طابعات الفواتير الحرارية (ESC/POS): الورقة تنطبع كصورة حتى العربي يطلع صحيح بأي طابعة
// (نفس اللي بتطبيق الأندرويد EscPos.java) — نحتاجه بالويندوز لما الطابعة معرّفة بتعريف «Generic / Text Only»:
// هذا التعريف يحوّل الورقة لكتابة إنكليزية بس، فالعربي يطلع رموز (╟ß π…)
'use strict';

const INIT = Buffer.from([0x1b, 0x40]);
const CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);            // قص جزئي بعد تغذية بسيطة
const KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);      // فتح درج الفلوس (ESC p 0 25 250)
const feed = (lines) => Buffer.from([0x1b, 0x64, Math.max(0, Math.min(255, lines | 0))]);

// عدد النقاط بعرض الورقة (203 نقطة بالإنج): 80 ملم ← 576، 58 ملم ← 384
const dotsFor = (widthMm) => (widthMm <= 60 ? 384 : 576);

// صورة BGRA (مثل NativeImage.toBitmap بالإلكترون) ← أبيض/أسود حسب الإضاءة، والشفاف = أبيض
function threshold(bgra, width, height, cut = 170) {
  const black = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < black.length; i++, p += 4) {
    const b = bgra[p], g = bgra[p + 1], r = bgra[p + 2], a = bgra[p + 3];
    let lum = (r * 299 + g * 587 + b * 114) / 1000;
    lum = 255 - ((255 - lum) * a) / 255;
    black[i] = lum < cut ? 1 : 0;
  }
  return black;
}

// نشيل الأسطر البيضاء من جوة (ما يطلع ورق فارغ) — نخلي سطر واحد على الأقل
function trimBottom(black, width, height) {
  let h = height;
  while (h > 1) {
    const row = black.subarray((h - 1) * width, h * width);
    if (row.some((v) => v)) break;
    h--;
  }
  return h;
}

// GS v 0 بشرائح 128 سطر (بعض الطابعات ذاكرتها صغيرة)
function raster(black, width, height) {
  const bytesW = (width + 7) >> 3, band = 128, parts = [];
  for (let y0 = 0; y0 < height; y0 += band) {
    const h = Math.min(band, height - y0);
    const out = Buffer.alloc(8 + bytesW * h);
    out.set([0x1d, 0x76, 0x30, 0x00, bytesW & 0xff, (bytesW >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
    let o = 8;
    for (let y = y0; y < y0 + h; y++) {
      const row = y * width;
      for (let bx = 0; bx < bytesW; bx++) {
        let v = 0;
        for (let bit = 0; bit < 8; bit++) { const x = (bx << 3) + bit; if (x < width && black[row + x]) v |= 0x80 >> bit; }
        out[o++] = v;
      }
    }
    parts.push(out);
  }
  return Buffer.concat(parts);
}

// ورقة كاملة: تهيئة + الصورة + تغذية + قص، مكررة بعدد النسخ (+ فتح الدرج إذا مطلوب)
function job(black, width, height, copies = 1, { kick = false } = {}) {
  const img = raster(black, width, height), parts = [];
  for (let c = 0; c < Math.max(1, copies | 0); c++) parts.push(INIT, img, feed(4), CUT);
  if (kick) parts.push(KICK);
  return Buffer.concat(parts);
}

module.exports = { INIT, CUT, KICK, feed, dotsFor, threshold, trimBottom, raster, job };
