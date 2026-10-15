// عامل خدمة بسيط لمنيو الزبون — يخلي المتصفح يعرض «تثبيت التطبيق»، ويفتح المنيو حتى بضعف النت.
const CACHE = 'sora3a-menu-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // صفحات التنقّل: من الشبكة أول، وإذا فشل نرجّع آخر نسخة محفوظة (فتح بلا نت)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
