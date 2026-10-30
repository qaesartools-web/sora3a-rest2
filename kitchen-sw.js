// سرعة — شاشة المطبخ/المجهز: Service Worker صغير خاص بيها (التثبيت + فتح سريع + تفتح بدون نت)
// نطاقه /sora3a-rest2/kitchen فقط، فما يتدخل بالكاشير. بيانات Firebase نفسها تمشي بالشبكة (وبدون نت من الكاشير على نفس الواي فاي).
const CACHE = 'kitchen-v4';
const SHELL = ['kitchen.html', 'staff.js', 'lanlink.js?v=1', 'vendor/qrcode.js', 'kitchen-192.png', 'kitchen-512.png', 'kitchen-apple-180.png'];
// مكتبات Firebase (إصدار ثابت): تنحفظ حتى الشاشة تفتح حتى لو انقطع النت
const CDN = ['app', 'auth', 'firestore'].map((m) => `https://www.gstatic.com/firebasejs/10.7.1/firebase-${m}.js`);
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([c.addAll(SHELL).catch(() => {}), ...CDN.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {}))]))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('kitchen-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const put = (req, r) => { if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then((cc) => cc.put(req, c)).catch(() => {}); } return r; };
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(url.href)) { e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => put(req, r)))); return; }
  if (url.origin !== self.location.origin) return;
  // الشبكة أولاً (حتى توصل التحديثات فوراً) — والواي فاي بدون نت: بعد ٣ ثواني النسخة المحفوظة
  const cached = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match('kitchen.html') : undefined));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => cached().then((r) => { if (r && !done) { done = true; resolve(r); } }), 3000);
    fetch(req).then((r) => { put(req, r); if (!done) { done = true; clearTimeout(t); resolve(r); } })
      .catch(() => cached().then((r) => { if (!done) { done = true; clearTimeout(t); resolve(r || Response.error()); } }));
  }));
});
