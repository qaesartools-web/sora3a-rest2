// سرعة — كاشير المطعم: Service Worker (يعمل بدون إنترنت + إشعارات الخلفية)
const CACHE_VERSION = 'rest2-v31';
const CACHE_NAME = `app-cache-${CACHE_VERSION}`;
const SCOPE = '/sora3a-rest2/';
const PRECACHE = [SCOPE, SCOPE + 'index.html', SCOPE + 'pos-pro.js?v=26', SCOPE + 'pos-pro.css?v=19', SCOPE + 'manifest.json',
  SCOPE + 'logo.svg', SCOPE + 'icon-192.png', SCOPE + 'icon-512.png'];
// مكتبات Firebase تُخزَّن مسبقاً حتى يفتح الكاشير بدون إنترنت حتى لو أول مرة بعد التحديث
const PRECACHE_CDN = ['app', 'auth', 'firestore'].map((m) => `https://www.gstatic.com/firebasejs/10.7.1/firebase-${m}.js`);

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyAwlFrbv-c6G0_K0-s0P1m1o_qD95aGGyQ',
  authDomain: 'sora3a-system.firebaseapp.com',
  projectId: 'sora3a-system',
  storageBucket: 'sora3a-system.firebasestorage.app',
  messagingSenderId: '516304449260',
  appId: '1:516304449260:web:0110ba6c2621d6a16dbfc9',
});
firebase.messaging().onBackgroundMessage((payload) => {
  if (payload.notification) return; // يعرضه Firebase تلقائياً
  const d = payload.data || {};
  return self.registration.showNotification(d.title || 'سرعة', {
    body: d.body || '', tag: d.tag || 'rest', renotify: true, icon: SCOPE + 'icon-192.png',
    dir: 'rtl', lang: 'ar', data: { url: d.link || SCOPE },
  });
});
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  if (data.FCM_MSG) return;
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes(SCOPE) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(data.url || SCOPE);
  }));
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => Promise.all([c.addAll(PRECACHE).catch(() => {}),
    ...PRECACHE_CDN.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {}))])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (req, r) => { if (r && r.ok) { const c = r.clone(); caches.open(CACHE_NAME).then((cc) => cc.put(req, c)).catch(() => {}); } return r; };
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/firebaseio\.com|firestore\.googleapis|identitytoolkit|securetoken|fcmregistrations|firebaseinstallations/.test(url.hostname)) return;
  // ملفات التطبيق نفسه: الشبكة أولاً (حتى تصل التحديثات فوراً) ثم النسخة المخزنة بدون إنترنت
  if (url.origin === self.location.origin) {
    // إنترنت ضعيف: ننتظر الشبكة ٣ ثواني فقط ثم نفتح النسخة المخزنة
    const cached = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match(SCOPE + 'index.html') : undefined));
    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const t = setTimeout(() => cached().then((r) => { if (r && !settled) { settled = true; resolve(r); } }), 3000);
      // الصفحة الرئيسية: نتأكد دائماً من السيرفر (حتى يوصل التحديث فوراً)
      fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req).then((r) => { if (r.redirected && req.mode === 'navigate') r = Response.redirect(r.url, 302); else put(req, r); if (!settled) { settled = true; clearTimeout(t); resolve(r); } })
        .catch(() => cached().then((r) => { if (!settled) { settled = true; clearTimeout(t); resolve(r || Response.error()); } }));
    }));
    return;
  }
  // مكتبات ثابتة بإصدار محدد + الخطوط: من الذاكرة أولاً
  if (/^https:\/\/(www\.gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/npm\/qz-tray@)/.test(url.href)) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => put(req, r))));
  }
});
