// سرعة — الويتر: Service Worker صغير خاص بالويتر (التثبيت + فتح سريع)
// نطاقه /sora3a-rest2/waiter فقط، فما يتدخل بالكاشير. Firebase يشتغل بالشبكة مباشرة.
const CACHE = 'waiter-v1';
const SHELL = ['waiter.html', 'staff.js', 'waiter.webmanifest', 'waiter-192.png', 'waiter-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('waiter-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// الشبكة أولاً (حتى توصل التحديثات فوراً)، والنسخة المحفوظة إذا ماكو نت
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((r) => {
    if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then((cc) => cc.put(req, c)).catch(() => {}); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('waiter.html'))));
});
