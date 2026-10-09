// مجلد الفلاشة: يبني صفحة «اقرأني أولاً» (بأكواد QR لتنزيل تطبيقات الأندرويد) وروابط الويندوز (.url)
// الاستعمال: node tools/flash-kit/build.cjs '<مجلد التطبيقات>'   — يشغّله .github/workflows/flash-kit.yml
const fs = require('fs'), path = require('path');
const qrcode = require(path.join(__dirname, '../../vendor/qrcode.js'));
const D = process.argv[2];
const qr = (u) => { const q = qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GH = 'https://github.com/qaesartools-web/';
const apks = [
  ['🛵', 'الكابتن', 'سرعة - الكابتن.apk', GH + 'sora3a-captain/releases/latest/download/sora3a-captain.apk', 'لتلفون الكابتن (السايق). يرن مثل المكالمة حتى والتلفون مقفول.', '#EA7A0C'],
  ['🧾', 'الكاشير (أندرويد)', 'سرعة - الكاشير (أندرويد).apk', GH + 'sora3a-rest2/releases/download/cashier-android/sora3a-cashier.apk', 'لجهاز الكاشير الأندرويد (اللي بيه طابعة مدمجة) أو تابلت.', '#16A34A'],
  ['📞', 'خط المطعم', 'سرعة - خط المطعم.apk', GH + 'sora3a-rest2/releases/download/line-android/sora3a-line.apk', 'لتلفون رقم المطعم: رقم المتصل يطلع بالكاشير.', '#0D9488'],
  ['📺', 'الشاشة (للتيفي)', 'سرعة - الشاشة (للتيفي).apk', GH + 'sora3a-rest2/releases/download/screen-android/sora3a-screen.apk', 'للتلفزيون أو التيفي بوكس: شاشة «طلبك جاهز» قدام الزبائن.', '#4F6BED'],
];
const web = [
  ['🛡️', 'لوحة الإدارة', 'https://qaesartools-web.github.io/sora3a-admin/', 'المنيو، الموظفين، التقارير، الفروع والخدمات.'],
  ['🧾', 'الكاشير (من المتصفح)', 'https://qaesartools-web.github.io/sora3a-rest2/', 'نفس الكاشير بدون تنصيب — لأي جهاز.'],
  ['🧑‍🍳', 'الويتر', 'https://qaesartools-web.github.io/sora3a-rest2/waiter.html', 'الويتر يفتحه بتلفونه ويطلب للطاولات.'],
  ['📺', 'شاشة «طلبك جاهز»', 'https://qaesartools-web.github.io/sora3a-rest2/screen.html', 'تنفتح على أي تلفزيون ذكي أو تابلت.'],
  ['🛵', 'الكابتن (للآيفون)', 'https://qaesartools-web.github.io/sora3a-captain/captain.html', 'للكابتن اللي عنده آيفون.'],
];
// روابط ويندوز (.url): دبل كلك تفتح الصفحة
const L = path.join(D, '3 - روابط تنفتح من المتصفح');
web.forEach(([, n, u]) => fs.writeFileSync(path.join(L, n.replace(/[«»"]/g, '') + '.url'), '[InternetShortcut]\r\nURL=' + u + '\r\n'));
const date = new Date().toLocaleDateString('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Baghdad' });
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>سرعة — كل التطبيقات</title>
<style>
:root{--ink:#0E1726;--muted:#5B6476;--line:#E3E7EF;--bg:#F4F6FA}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Tahoma,'Segoe UI',Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.7;padding:24px 16px 60px}
.w{max-width:980px;margin:0 auto}
.hero{background:linear-gradient(135deg,#FFC14D,#F5891F 55%,#D9480F);color:#fff;border-radius:24px;padding:26px 24px;box-shadow:0 20px 40px -24px rgba(120,40,0,.6)}
.hero h1{font-size:30px}.hero p{opacity:.95;font-size:15px}
.band{height:6px;border-radius:6px;margin:18px 0 6px;background:linear-gradient(270deg,#16A34A 0 25%,#EA7A0C 25% 50%,#4F6BED 50% 75%,#0D9488 75%)}
h2{font-size:21px;margin:26px 0 10px}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px 18px;margin-bottom:12px;box-shadow:0 10px 24px -20px rgba(15,30,60,.4)}
.steps{counter-reset:s;list-style:none}
.steps li{counter-increment:s;position:relative;padding-right:34px;margin:6px 0}
.steps li::before{content:counter(s);position:absolute;right:0;top:2px;width:24px;height:24px;border-radius:50%;background:#16A34A;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.app{background:#fff;border:1px solid var(--line);border-top:6px solid var(--c);border-radius:18px;padding:14px;text-align:center}
.app .ic{font-size:30px}.app b{display:block;font-size:17px;margin:2px 0}
.app small{display:block;color:var(--muted);font-size:13px;min-height:44px}
.app svg{width:150px;height:150px;margin:8px auto 4px;display:block}
.app .f{font-size:12px;color:var(--muted);direction:rtl;word-break:break-all}
.lk{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin-bottom:8px}
.lk .ic{font-size:24px}.lk div{flex:1}.lk a{color:#1E3A8A;font-weight:700;word-break:break-all;font-size:14px;direction:ltr;display:inline-block}
.lk small{display:block;color:var(--muted);font-size:13px}
.note{background:#FFF4E6;border:1px solid #FFD3A1;border-radius:14px;padding:12px 14px;font-size:14px}
code{background:#EEF1F6;border-radius:6px;padding:1px 6px;font-size:13px;unicode-bidi:isolate;font-family:Tahoma,Arial,sans-serif}
@media print{body{background:#fff}.app,.card,.lk{break-inside:avoid}}
</style></head><body><div class="w">
<div class="hero"><h1>⚡ سرعة — كل التطبيقات</h1><p>نسخة الفلاشة • ${date}. كل التطبيقات تتحدث وحدها بعد التنصيب — ما تحتاج تغيّر الفلاشة كل مرة.</p></div>
<div class="band"></div>

<h2>💻 1) الكاشير على اللابتوب (ويندوز)</h2>
<div class="card"><ol class="steps">
<li>افتح مجلد <b>«1 - الكاشير للابتوب (ويندوز)»</b> واضغط دبل كلك على <code>سرعة - الكاشير (ويندوز).exe</code>.</li>
<li>إذا طلعت رسالة زرگة <b>«Windows protected your PC»</b>: اضغط <b>More info</b> ← بعدها <b>Run anyway</b>.</li>
<li>ينتصب وحده ويفتح — سجّل دخول بإيميل ورمز المطعم. بعدها يتحدث وحده.</li>
</ol></div>

<h2>📱 2) تطبيقات الأندرويد</h2>
<div class="card"><ol class="steps">
<li><b>أسهل طريقة:</b> افتح كاميرا التلفون وامسح الكود تحت التطبيق — ينزل مباشرة (أحدث نسخة).</li>
<li><b>أو من الفلاشة:</b> انسخ ملف <code>.apk</code> من مجلد <b>«2 - تطبيقات الأندرويد»</b> للتلفون وافتحه.</li>
<li>إذا طلب <b>«السماح بالتثبيت من هذا المصدر»</b> فعّله وارجع ← <b>تثبيت</b>.</li>
<li><b>التيفي:</b> شبّك الفلاشة بالتيفي، افتح «مدير الملفات» واختار <code>سرعة - الشاشة (للتيفي).apk</code>.</li>
</ol></div>
<div class="grid">${apks.map(([ic, n, f, u, d, c]) => `<div class="app" style="--c:${c}"><div class="ic">${ic}</div><b>${esc(n)}</b><small>${esc(d)}</small>${qr(u)}<div class="f">📁 ${esc(f)}</div></div>`).join('')}</div>

<h2>🌐 3) تنفتح من المتصفح (بدون تنصيب)</h2>
<p style="color:var(--muted);font-size:14px;margin-bottom:8px">بمجلد «3 - روابط تنفتح من المتصفح» تلكه نفس الروابط: دبل كلك وتنفتح.</p>
${web.map(([ic, n, u, d]) => `<div class="lk"><span class="ic">${ic}</span><div><b>${esc(n)}</b><small>${esc(d)}</small><a href="${esc(u)}">${esc(u)}</a></div></div>`).join('')}

<h2>💡 ملاحظات</h2>
<div class="note">• كل تطبيق يتحدث وحده من الإنترنت — الفلاشة بس للتنصيب أول مرة.<br>
• أحدث نسخة من كل تطبيق أندرويد دائماً على نفس كود الـ QR فوق.<br>
• إذا تحتاج مساعدة، كلّم فريق سرعة.</div>
</div></body></html>`;
fs.writeFileSync(path.join(D, 'اقرأني أولاً — دليل التطبيقات.html'), html);
console.log('flash kit page ready:', D);
