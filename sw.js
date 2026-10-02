// سرعة — كاشير المطعم: Service Worker (يعمل بدون إنترنت + إشعارات الخلفية)
const CACHE_VERSION = 'rest2-v7';
const CACHE_NAME = `app-cache-${CACHE_VERSION}`;
const SCOPE = '/sora3a-rest2/';
const PRECACHE = [SCOPE, SCOPE + 'index.html', SCOPE + 'pos-pro.js?v=6', SCOPE + 'pos-pro.css?v=4', SCOPE + 'manifest.json'];

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
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
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
    event.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match(SCOPE + 'index.html') : undefined))));
    return;
  }
  // مكتبات ثابتة بإصدار محدد + الخطوط: من الذاكرة أولاً
  if (/^https:\/\/(www\.gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com)/.test(url.href)) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => put(req, r))));
  }
});
