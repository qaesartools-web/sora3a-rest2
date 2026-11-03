// سرعة — دخول موظفي المطعم للصفحات الصغيرة (شاشة «طلبك جاهز» وتطبيق الويتر)
// نفس حساب الكاشير ونفس الجلسة: الجهاز اللي مسجّل دخول بالكاشير يفتحها مباشرة.
// وشاشات المطبخ (المجهز والأقسام): تنربط بالمطعم برمز — بدون إيميل ولا كلمة سر (screenGate تحت).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocFromServer, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const CFG = {
  apiKey: "AIzaSyAwlFrbv-c6G0_K0-s0P1m1o_qD95aGGyQ",
  authDomain: "sora3a-system.firebaseapp.com",
  projectId: "sora3a-system",
  storageBucket: "sora3a-system.firebasestorage.app",
  messagingSenderId: "516304449260",
  appId: "1:516304449260:web:0110ba6c2621d6a16dbfc9"
};
export const app = initializeApp(CFG, "pos-v2");
// App Check (reCAPTCHA Enterprise / Fraud Defense): السيرفر يعرف إن الطلب جاي من تطبيقاتنا الحقيقية (بدون ما يحس المستخدم) — على الموقع بس، مو بالتجارب المحلية
const APPCHECK_KEY = '6LdWa_0tAAAAAEWXuLi8yrdnPjQmx-r-ayyoZ07h';
// داخل تطبيقات الأندرويد فحص كوكل (reCAPTCHA) ما يشتغل: رمز الحماية ياخذه الجهاز المربوط أو الحساب المسجّل من سيرفرنا
//  ⚠️ ما ننتظر الدخول هنا: الدخول نفسه يطلب رمز الحماية — إذا انتظرنا يعلكون ببعض و«تعذّر الدخول». بدون دخول نرجع خطأ فوراً
//  (الطلب يكمل بدون رمز، والرفض بعده مو مفعّل)، وبعد الدخول acKick يطلب الرمز من جديد
const srvAppCheck = (getAuth) => async () => {
  const au = getAuth(), u = au && au.currentUser;
  if (!u) throw new Error('not signed in');
  if (Date.now() - (window.__acFailAt || 0) < 60000) throw new Error('srv retry later');
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch('https://sora3a-push.qaesartools.workers.dev/appcheck', { method: 'POST', signal: ctl.signal, headers: { authorization: 'Bearer ' + await u.getIdToken(), 'content-type': 'application/json' }, body: '{}' }).finally(() => clearTimeout(tm));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) { window.__acState = 'err:srv ' + r.status + ' ' + String(j.error || '').slice(0, 40); throw new Error('srv ' + r.status); }
    window.__acState = 'ok (سيرفر)';
    return { token: j.token, expireTimeMillis: Date.now() + Math.max(120000, (j.ttlMillis || 3600000) - 600000) };
  } catch (e) { window.__acFailAt = Date.now(); if (!/^err/.test(window.__acState || '')) window.__acState = 'err:srv ' + String(e && e.message || e).slice(0, 60); throw e; }
};
// بعد الدخول أو الربط: نطلب الرمز من جديد (قبلها السيرفر يرفض لأن الجهاز بعده ما مربوط)
window.acKick = () => { if (!window.__acKick || !/; wv\)/.test(navigator.userAgent)) return; window.__acState = ''; window.__acFailAt = 0; window.__acKick.forEach((k) => { try { k().catch(() => {}); } catch (e) {} }); };
const appCheck = (a, getAuth) => { if (!/\.github\.io$/.test(location.hostname)) return; if (!document.getElementById('acHide')) document.head.insertAdjacentHTML('beforeend', '<style id="acHide">.grecaptcha-badge{visibility:hidden}</style>');
  import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js').then((m) => { const ac = m.initializeAppCheck(a, { provider: (getAuth && /; wv\)/.test(navigator.userAgent)) ? new m.CustomProvider({ getToken: srvAppCheck(getAuth) }) : new m.ReCaptchaEnterpriseProvider(APPCHECK_KEY), isTokenAutoRefreshEnabled: true }); if (getAuth) (window.__acKick = window.__acKick || []).push(() => m.getToken(ac, true)); m.getToken(ac).then(() => { window.__acState = window.__acState || 'ok'; }, (e) => { window.__acState = 'err:' + String((e && ((e.code || '') + ' ' + (e.message || ''))) || e).replace(/\s+/g, ' ').slice(0, 95); }); }).catch(() => {}); };
appCheck(app, () => auth);
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
// كاش محلي دائم: الشاشة تفتح بآخر بياناتها حتى لو انقطع النت (وتكمل ويا الكاشير على نفس الواي فاي — lanlink.js)
const mkDb = (a) => { try { return initializeFirestore(a, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); } catch (e) { return getFirestore(a); } };
export const db = mkDb(app);
export const logout = () => signOut(auth);

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// يوم الطلب بتوقيت بغداد (نفس حقل day بطلبات الكاشير)
// رقمنا وإيميلنا من البرج (config/brand، يقراه أي أحد) لشريط الهوية وسطر الحقوق — مرة كل ٦ ساعات بالأكثر (brand.js)
const brandSync = (dbx) => { if (window.SB) window.SB.sync(async () => { const s = await getDoc(doc(dbx, 'config', 'brand')); return s.exists() ? s.data() : null; }); };
// ساعة الجهاز: إذا غلط (تلفزيون أو جهاز جديد مثلاً) رمز الحماية يبقى ينبعث بعد ما تخلص مدته والسيرفر يرفض الطلبات —
// نقارنها بساعة الموقع (رأس Date من طلب HEAD، بدون أي قراءة من قاعدة البيانات) ونطلع تنبيه لحد ما تتصلّح
let clockT = 0;
const clockCheck = async () => {
  try {
    const t0 = Date.now(), r = await fetch('brand.css', { method: 'HEAD', cache: 'no-store' }), t1 = Date.now();
    const srv = Date.parse(r.headers.get('date') || '');
    if (!srv) return;
    const skew = Math.round(((t0 + t1) / 2 - srv) / 60000);   // بالدقايق: موجب = الجهاز مقدّم
    let b = document.getElementById('clockWarn');
    if (Math.abs(skew) < 5) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'clockWarn'; b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:0;right:0;top:var(--sbH,0px);z-index:150;background:#B45309;color:#fff;font-weight:700;font-size:18px;font-size:clamp(14px,1.5vw,24px);line-height:1.6;padding:8px 14px;text-align:center;direction:rtl';
      document.body.appendChild(b);
    }
    const n = Math.abs(skew), amt = n >= 1440 ? Math.round(n / 1440) + ' يوم' : n >= 60 ? Math.round(n / 60) + ' ساعة' : n + ' دقيقة';
    b.textContent = '⏰ ساعة هذا الجهاز ' + (skew > 0 ? 'مقدّمة' : 'متأخرة') + ' ' + amt + ' — صلّحها من إعدادات الجهاز ← التاريخ والوقت ← «تلقائي»، وإلا الطلبات ممكن توكف';
  } catch (e) {}
};
const watchClock = () => { if (clockT) return; clockCheck(); clockT = setInterval(clockCheck, 30 * 60000); };
export const bagDay = (ms) => new Date((ms == null ? Date.now() : ms) + 3 * 3600000).toISOString().slice(0, 10);

const ERR = { 'auth/invalid-credential': 'الإيميل أو الرمز غلط', 'auth/wrong-password': 'الإيميل أو الرمز غلط', 'auth/user-not-found': 'الإيميل أو الرمز غلط',
  'auth/too-many-requests': 'محاولات كثيرة — انتظر شوية وجرّب', 'auth/network-request-failed': 'ماكو إنترنت' };

// el: مكان نموذج الدخول — onIn({uid, role, name, rid, rest}) / onOut()
// remember: يحفظ آخر إيميل دخل بيه على هذا الجهاز (التلفزيون: بس يكتب الرمز بالريموت)
// device: 'claim' — حساب الكاشير يسجّل جلسته على هذا الجهاز (الأجهزة المعتمدة)، مثل الويتر.
//   وبإيميل المطعم: الجهاز نفسه لازم معتمد (المطبخ، المجهز، الويتر) لما الخدمة شغّالة.
//   بدونه (شاشة طلبك جاهز): لما الخدمة شغّالة الكاشيرية ما يدخلون — الشاشة تدخل بحساب صاحب المطعم
const EMAIL_KEY = 'sora3a_staff_email';
const lastEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; } };
export function staffGate(el, { title, sub, onIn, onOut, remember, device }) {
  let busy = false;
  const form = (msg) => {
    const saved = remember ? lastEmail() : '';
    el.hidden = false;
    el.innerHTML = `<form class="gate-f" autocomplete="on"><div class="gate-logo">س</div><h1>${esc(title)}</h1><p>${esc(sub || 'سجّل دخول بحساب المطعم أو حساب الكاشير')}</p>
      <input class="gate-i" id="gEmail" type="email" inputmode="email" dir="ltr" placeholder="الإيميل" autocomplete="username" value="${esc(saved)}" required>
      <input class="gate-i" id="gPass" type="password" dir="ltr" placeholder="الرمز" autocomplete="current-password" required>
      <button class="gate-b" id="gGo" type="submit">دخول</button><div class="gate-e" id="gErr">${esc(msg || '')}</div></form>`;
    // ريموت التلفزيون: ⬆️⬇️ تتنقل بين الخانات، و OK يكتب أو يدخل
    const keys = ['gEmail', 'gPass', 'gGo'].map((id) => el.querySelector('#' + id));
    el.querySelector('form').addEventListener('keydown', (e) => {
      const i = keys.indexOf(document.activeElement), d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!d || i < 0) return;
      e.preventDefault(); keys[Math.max(0, Math.min(keys.length - 1, i + d))].focus();
    });
    setTimeout(() => { try { keys[saved ? 1 : 0].focus(); } catch (e) {} }, 300);
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault(); if (busy) return; busy = true;
      el.querySelector('#gGo').textContent = '⏳ …'; el.querySelector('#gErr').textContent = '';
      try { await signInWithEmailAndPassword(auth, el.querySelector('#gEmail').value.trim(), el.querySelector('#gPass').value); }
      catch (err) { el.querySelector('#gErr').textContent = ERR[err.code] || 'تعذّر الدخول'; el.querySelector('#gGo').textContent = 'دخول'; }
      busy = false;
    };
  };
  // الشاشة (remember): ما تطلع من الحساب وحدها أبداً — نت مقطوع، كهرباء، حساب موقوف مؤقتاً… تنتظر وترجع وحدها.
  //   تسجيل الخروج بس من زر «تسجيل خروج» (أو إذا انغيّرت كلمة السر من الإدارة).
  let retryT = 0, tries = 0, cur = null;
  const hold = (msg, user) => {
    clearTimeout(retryT);
    const ms = Math.min(60000, 5000 * Math.pow(2, Math.min(tries++, 4)));
    el.hidden = false;
    el.innerHTML = `<div class="gate-f gate-hold"><div class="gate-logo">س</div><h1>${esc(title)}</h1><p class="gate-msg">${esc(msg)}</p>
      <p class="gate-sub">الشاشة ترجع وحدها — ما تحتاج تكتب الرمز</p><div class="gate-w gate-spin">⏳</div>
      <button class="gate-b gate-out" type="button">تسجيل خروج</button></div>`;
    el.querySelector('.gate-out').onclick = () => { clearTimeout(retryT); signOut(auth).catch(() => {}); };
    retryT = setTimeout(() => check(user), ms);
  };
  const netErr = (e) => !e || e.code === 'unavailable' || e.code === 'deadline-exceeded' || e.code === 'failed-precondition' || /offline|network/i.test(e.message || '');
  window.addEventListener('online', () => { if (cur && retryT) { clearTimeout(retryT); tries = 0; check(cur); } });
  onAuthStateChanged(auth, (user) => {
    clearTimeout(retryT); retryT = 0; tries = 0; cur = user;
    if (!user) { onOut && onOut(); form(); return; }
    check(user);
  });
  async function check(user) {
    if (user !== cur) return;
    retryT = 0;
    el.hidden = false; el.innerHTML = '<div class="gate-w">⏳</div>';
    const deny = async (msg, keep) => { if (remember && keep) return hold(msg, user); await signOut(auth).catch(() => {}); form(msg); };
    try {
      const u = await getDoc(doc(db, 'users', user.uid)), d = u.exists() ? u.data() : null;
      if (d && d.disabled) return deny('⛔ الحساب موقوف حالياً — أول ما يتفعّل', true);
      if (!d || !['restaurant', 'cashier'].includes(d.role)) return deny('❌ هذا الحساب مو حساب مطعم أو كاشير');
      let rid = d.restaurantId;
      if (!rid && d.role === 'restaurant') {
        const q = await getDocs(query(collection(db, 'restaurants'), where('userId', '==', user.uid)));
        if (!q.empty) rid = q.docs[0].id;
      }
      if (!rid) return deny('❌ الحساب مو مربوط بمطعم');
      // صاحب الفروع: نفس الفرع المختار على هذا الجهاز بالكاشير
      if (d.role === 'restaurant' && Array.isArray(d.branches) && d.branches.length) {
        let saved = null; try { saved = localStorage.getItem('pos_branch_' + user.uid); } catch (e) {}
        if (saved && d.branches.includes(saved)) rid = saved;
      }
      if (remember && user.email) { try { localStorage.setItem(EMAIL_KEY, user.email); } catch (e) {} }
      const r = await getDoc(doc(db, 'restaurants', rid)), rest = r.exists() ? r.data() : {};
      // الأجهزة المعتمدة (حساب كاشير، أو شاشة بإيميل المطعم)
      const SD = window.SoraDev;
      if (d.role === 'cashier' && SD && device !== 'claim' && SD.devicesOn(rest)) return deny('🔐 هذي الصفحة تدخل بحساب صاحب المطعم — حسابات الكاشيرية بس على أجهزة الكاشير المعتمدة');
      if (SD && device === 'claim') {
        const fsx = { db, doc, getDoc, setDoc, updateDoc, onSnapshot }, ud = { ...d, restaurantId: rid };
        if (await (d.role === 'cashier' ? SD.claim(fsx, user, ud, rest) : SD.check(fsx, user, ud, rest)) === 'blocked') {
          if (!document.getElementById('devCss')) { const st = document.createElement('style'); st.id = 'devCss'; st.textContent = SD.CSS; document.head.appendChild(st); }
          el.hidden = false; el.innerHTML = SD.blockHtml(SD.info());
          el.querySelector('#devOut').onclick = async () => { await signOut(auth).catch(() => {}); location.reload(); };
          SD.watch(fsx, SD.info(), () => location.reload(), rid);
          return;
        }
      }
      tries = 0;
      el.hidden = true; el.innerHTML = '';
      brandSync(db);
      watchClock();
      if (window.SB && SB.welcome) SB.welcome({ name: d.name || '', rest: (rest && rest.name) || '' });   // شاشة الترحيب
      if (window.acKick) window.acKick();
      if (window.SB && SB.health) SB.health((hid, hd) => setDoc(doc(db, 'devHealth', hid), hd), { rid, rest: (rest && rest.name) || '', who: d.name || '' });   // صحة الجهاز
      onIn({ uid: user.uid, role: d.role, name: d.name || '', rid, rest });
    } catch (e) {
      if (e.code === 'permission-denied') deny('⛔ الحساب موقوف أو خارج وقت الدوام', true);
      else if (remember && netErr(e)) hold('📶 ننتظر الإنترنت…', user);
      else deny('📶 تعذّر الاتصال — تأكد من الإنترنت', true);
    }
  }
}

// ══ شاشات المطبخ وتلفونات الويتر المربوطة برمز ══
// جلسة «مجهولة» بتطبيق Firebase منفصل (sora3a-screen) — ما تمس جلسة الكاشير أو الويتر بنفس المتصفح.
// الشاشة تطلع رمز (screenPairs/{الرمز}) ← صاحب المطعم (لوحة الإدارة ← الشاشات) أو برج سرعة يكتبه ← screens/{uid}
// ← تفتح وحدها. إذا «الأجهزة المعتمدة» شغّالة، اللي يربطها صاحب المطعم تنتظر اعتماد البرج.
let scrFb = null;
// ── حارس الاتصال لشاشات التلفزيون والمطبخ (تبقى شغّالة أيام) ──
//  أحياناً مكتبة قاعدة البيانات «تعلك» بالأجهزة الضعيفة (خصوصاً بعد زحمة طلبات): الطلبات توقف تتحدث بدون أي خطأ،
//  والشاشة تبقى على آخر شكل. كل 3 دقايق نسأل السيرفر سؤال صغير (مستند واحد) — إذا النت شغّال وما جاوب:
//  نعيد الاتصال، وإذا بقى عالق نعيد تحميل الصفحة. خطأ داخلي قاتل من المكتبة ← تحميل من جديد فوراً،
//  وإذا تكرر التحميل بسبب نسخة محلية خربانة نمسح النسخة المحلية (الطلبات ترجع من السيرفر)
//  quiet(): وقت مناسب للتحميل (مو وقت ما رقم جديد يومض أو القائمة مفتوحة)
let guardOn = false;
export function liveGuard(db, ref, { every = 180000, timeout = 20000, quiet = () => true } = {}) {
  if (guardOn) return; guardOn = true;
  every = window.__lgMs || every; timeout = window.__lgTo || timeout;   // الاختبارات تقصّر الأوقات
  let fails = 0, busy = false, going = false;
  const RK = 'sb_guard_reloads';
  const netUp = () => fetch('brand.css?lg=' + Date.now(), { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);
  const reload = async (why) => {
    if (going) return;
    if (!quiet()) { setTimeout(() => reload(why), 5000); return; }
    going = true;
    let n = [];
    try { n = JSON.parse(localStorage.getItem(RK) || '[]').filter((t) => Date.now() - t < 30 * 60000); n.push(Date.now()); localStorage.setItem(RK, JSON.stringify(n)); } catch (e) {}
    console.warn('liveGuard reload:', why);
    // ٣ مرات بنص ساعة: النسخة المحلية بالجهاز غالباً خربانة ← نمسحها (الربط والدخول ما يتأثرون)
    if (n.length >= 3 && window.indexedDB && indexedDB.databases) {
      try { (await indexedDB.databases()).forEach((d) => { if (d && /^firestore\//.test(d.name || '')) indexedDB.deleteDatabase(d.name); }); localStorage.setItem(RK, '[]'); } catch (e) {}
    }
    setTimeout(() => location.reload(), 300);
  };
  async function probe() {
    if (busy || going) return;
    const r = ref && ref(); if (!r) return;
    busy = true;
    try {
      const ok = await Promise.race([
        getDocFromServer(r).then(() => true, (e) => !!(e && e.code === 'permission-denied')),   // رفض = السيرفر جاوب
        new Promise((res) => setTimeout(() => res(false), timeout)),
      ]);
      if (ok) { fails = 0; window.__fsOk = Date.now(); return; }
      if (navigator.onLine === false || !(await netUp())) return;   // النت نفسه مقطوع: الشاشة تكمل على الواي فاي (الكاشير)
      fails++;
      // أول مرة: اتصال جديد — وإذا إعادة الاتصال نفسها علكت (تصير ويا الاتصال العالق) ← تحميل من جديد
      if (fails === 1) {
        const done = await Promise.race([disableNetwork(db).then(() => enableNetwork(db)).then(() => true, () => true), new Promise((res) => setTimeout(() => res(false), timeout))]);
        if (!done) reload('reconnect stuck');
      } else reload('server does not answer');
    } finally { busy = false; }
  }
  setInterval(probe, every);
  const fatal = (m) => /INTERNAL ASSERTION FAILED|Unexpected state/i.test(String(m || ''));
  window.addEventListener('error', (e) => { if (fatal(e.message) || fatal(e.error && e.error.message)) setTimeout(() => reload('fatal error'), 2000); });
  window.addEventListener('unhandledrejection', (e) => { const x = e.reason; if (fatal(x && (x.message || x))) setTimeout(() => reload('fatal error'), 2000); });
  // المكتبة تكتب خطأها القاتل بالـ console قبل ما تتوقف
  const ce = console.error;
  console.error = function () { try { if ([].some.call(arguments, (a) => fatal(a && (a.message || a)))) setTimeout(() => reload('fatal error'), 2000); } catch (e) {} return ce.apply(console, arguments); };
}
export function screenFb() {
  if (!scrFb) {
    const a = initializeApp(CFG, 'sora3a-screen');
    appCheck(a, () => scrFb && scrFb.auth);
    scrFb = { app: a, auth: initializeAuth(a, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }), db: mkDb(a) };
  }
  return scrFb;
}
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rndCode = () => { const a = new Uint32Array(6); crypto.getRandomValues(a); return Array.from(a, (x) => ABC[x % ABC.length]).join(''); };
const lsx = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const osName = () => { const ua = navigator.userAgent; return /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'جهاز'; };
// الدخول القديم بإيميل المطعم على هذا الجهاز (قبل الربط بالرمز): نطلّعه مرة وحدة حتى محد يفتح الكاشير بحساب صاحب المطعم
async function dropOwnerLogin() {
  if (lsx.get('sora3a_scr_v1')) return;
  try {
    await auth.authStateReady();
    const u = auth.currentUser;
    if (u) { const d = await getDoc(doc(db, 'users', u.uid)); if (d.exists() && d.data().role === 'restaurant') await signOut(auth); }
    lsx.set('sora3a_scr_v1', '1');
  } catch (e) {}
}
const PAIR_CSS = `.pair-code{font-family:ui-monospace,Consolas,monospace;font-size:44px;font-weight:900;letter-spacing:8px;background:var(--bg);border:2px dashed #3DF08B;border-radius:16px;padding:10px 6px;margin:6px 0 10px;color:var(--text)}
.pair-qr{width:170px;height:170px;margin:4px auto 10px;background:#fff;border-radius:12px;padding:8px}.pair-qr svg{width:100%;height:100%;display:block}
.pair-steps{text-align:right;font-size:13.5px;line-height:1.9;color:var(--muted);margin:0 0 10px;padding-inline-start:20px}.pair-steps b{color:var(--text)}
.pair-st{font-size:14px;font-weight:700;color:#3DF08B;margin-top:4px}.pair-st.warn{color:#FFB020}.pair-st.bad{color:#FF4D2E}`;
// شاشة «طلبك جاهز» جانت داخلة بإيميل المطعم (قبل الربط بالرمز): تنربط وحدها بنفس المطعم (بجلسة صاحب المطعم اللي عليها)
// بدل ما تطلع رمز وتوكف، وبعدين تطلع جلسة صاحب المطعم. إذا «الأجهزة المعتمدة» شغّالة تنتظر اعتماد البرج مثل أي جهاز.
async function adoptOwnerScreen(uid, code, platform) {
  if (lsx.get('sora3a_scr_v1')) return false;
  try {
    await auth.authStateReady();
    const o = auth.currentUser;
    if (!o) return false;
    const u = await getDoc(doc(db, 'users', o.uid)), d = u.exists() ? u.data() : null;
    if (!d || d.role !== 'restaurant' || !d.restaurantId) return false;
    const r = await getDoc(doc(db, 'restaurants', d.restaurantId)), max = +((r.exists() && r.data().screenMax) || 0);
    // عدد شاشات «طلبك جاهز» يحدده البرج: إذا وصل الحد الشاشة تبقى على الرمز (ولوحة الإدارة تكول وصلت الحد)
    if (max > 0) {
      const n = (await getDocs(query(collection(db, 'screens'), where('restaurantId', '==', d.restaurantId)))).docs.filter((x) => x.data().kind === 'ready').length;
      if (n >= max) return false;
    }
    await setDoc(doc(db, 'screens', uid), { restaurantId: d.restaurantId, restName: String((r.exists() && r.data().name) || '').slice(0, 80), kind: 'ready',
      name: 'شاشة طلبك جاهز', code, platform, pairedBy: 'owner', approved: false, atMs: Date.now() });
    return true;
  } catch (e) { return false; }
}
// kind: 'kitchen' | 'kitchenSec' | 'waiter' | 'ready' — onIn({uid, rid, rest, screen}) / onOut()
export function screenGate(el, { title, kind, label, onIn, onOut }) {
  const F = screenFb();
  if (!document.getElementById('pairCss')) { const st = document.createElement('style'); st.id = 'pairCss'; st.textContent = PAIR_CSS; document.head.appendChild(st); }
  let unsub = null, retryT = 0, inUid = '', cur = null, busy = false, adopted = false;
  const platform = (osName() + ' • ' + (label || title)).slice(0, 80);
  const box = (html) => { el.hidden = false; el.innerHTML = `<div class="gate-f"><div class="gate-logo">س</div><h1>${esc(title)}</h1>${html}</div>`; };
  const leave = () => { if (inUid) { inUid = ''; onOut && onOut(); } };
  const stop = () => { clearTimeout(retryT); retryT = 0; if (unsub) { unsub(); unsub = null; } };
  async function anon() {
    try { await signInAnonymously(F.auth); }
    catch (e) {
      box(`<p class="pair-st bad">${e && /operation-not-allowed|admin-restricted/.test(e.code || '') ? '⚙️ الربط بدون إيميل مو مفعّل بعد — كلّم إدارة سرعة' : '📶 ننتظر الإنترنت…'}</p><p class="gate-sub">الشاشة تحاول وحدها</p>`);
      retryT = setTimeout(anon, 20000);
    }
  }
  // شاشة «طلبك جاهز»: نخلي جلسة صاحب المطعم لحد ما نجرب نربطها بيها (adoptOwnerScreen)، وبعدين نطلّعها
  (kind === 'ready' ? Promise.resolve() : dropOwnerLogin()).finally(() => onAuthStateChanged(F.auth, (user) => {
    stop(); cur = user;
    if (!user) { leave(); box('<div class="gate-w gate-spin">⏳</div>'); anon(); return; }
    unsub = onSnapshot(doc(F.db, 'screens', user.uid), (s) => { if (s.exists()) linked(user, s.data()); else pairUi(user); }, () => pairUi(user));
  }));
  // ما مربوطة: رمز + QR (يفتح لوحة الإدارة على «ربط شاشة» بالرمز جاهز)
  async function pairUi(user) {
    leave();
    if (busy || user !== cur) return; busy = true;
    const key = 'sora3a_scr_code_' + user.uid;
    let code = lsx.get(key), ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      if (!/^[A-Z2-9]{6}$/.test(code)) code = rndCode();
      try { await setDoc(doc(F.db, 'screenPairs', code), { uid: user.uid, atMs: Date.now(), platform, kind }); ok = true; }
      catch (e) { if (e && e.code === 'permission-denied') code = ''; else break; }   // الرمز مأخوذ ← رمز ثاني
    }
    busy = false;
    if (user !== cur) return;
    lsx.set(key, code);
    // مفتوحة من زر الكاشير (شاشة ثانية على نفس الكمبيوتر): نخلي جلسة الكاشير، وإلا (تلفزيون) نطلّع جلسة صاحب المطعم منها
    if (ok && kind === 'ready' && !adopted) { adopted = true; await adoptOwnerScreen(user.uid, code, platform); if (!/[?&]from=pos\b/.test(location.search)) await dropOwnerLogin(); if (user !== cur) return; }
    const link = new URL('../sora3a-admin/?pair=' + code, location.href).href;
    box(`<p>اربط ${kind === 'waiter' ? 'هذا التلفون' : 'هذي الشاشة'} بالمطعم — بدون إيميل وبدون رمز سري</p>
      <div class="pair-code" id="pairCode" dir="ltr">${esc(code)}</div><div class="pair-qr" id="pairQr"></div>
      <ol class="pair-steps"><li>صاحب المطعم: <b>لوحة الإدارة ← 📺 الشاشات والخدمات ← 🔗 ربط جهاز</b> ويكتب الرمز${kind === 'waiter' ? ' واسم الويتر' : ''}، أو يمسح الـQR بكاميرا التلفون</li><li>أو <b>إدارة سرعة</b> تربطه من برج سرعة</li></ol>
      <div class="pair-st" id="pairSt">${ok ? '⏳ بانتظار الربط… تفتح وحدها' : '📶 ننتظر الإنترنت حتى يشتغل الرمز…'}</div>`);
    try { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); el.querySelector('#pairQr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
    catch (e) { const b = el.querySelector('#pairQr'); if (b) b.remove(); }
    if (!ok) retryT = setTimeout(() => pairUi(user), 15000);
  }
  // مربوطة: نجرب نقرا المطعم — إذا انرفض يعني تنتظر الاعتماد (أو المطعم موقوف)
  async function linked(user, d) {
    clearTimeout(retryT); retryT = 0;
    try {
      const r = await getDoc(doc(F.db, 'restaurants', d.restaurantId));
      if (user !== cur || inUid) return;
      inUid = user.uid; el.hidden = true; el.innerHTML = '';
      brandSync(F.db);
      watchClock();
      if (window.SB && SB.welcome) SB.welcome({ name: kind === 'waiter' ? (d.name || '') : '', rest: (r.exists() && r.data().name) || '', role: kind === 'waiter' ? '' : (d.name || '') });   // شاشة الترحيب
      if (window.acKick) window.acKick();
      if (window.SB && SB.health) SB.health((hid, hd) => setDoc(doc(F.db, 'devHealth', hid), hd), { rid: d.restaurantId, rest: (r.exists() && r.data().name) || '', who: d.name || '' });   // صحة الجهاز
      onIn({ uid: user.uid, rid: d.restaurantId, rest: r.exists() ? r.data() : {}, screen: d });
    } catch (e) {
      if (user !== cur) return;
      leave();
      const wait = e && e.code === 'permission-denied';
      box(`<p>✅ انربطت${d.restName ? ' بـ<b>' + esc(d.restName) + '</b>' : ''}</p>
        <div class="pair-st ${wait ? 'warn' : ''}">${!wait ? '📶 ننتظر الإنترنت…' : d.approved === false ? '⏳ بانتظار اعتماد إدارة سرعة… تفتح وحدها أول ما تنعتمد' : '⛔ المطعم موقوف حالياً — الشاشة ترجع وحدها'}</div>
        <button class="gate-b gate-out" type="button" id="pairOut">🔌 فصل ${kind === 'waiter' ? 'التلفون' : 'الشاشة'}</button>`);
      el.querySelector('#pairOut').onclick = () => unlinkScreen();
      retryT = setTimeout(() => linked(user, d), wait ? 30000 : 10000);
    }
  }
}
// «فصل الشاشة»: تمسح ربطها وترجع لرمز جديد
export async function unlinkScreen() {
  const F = screenFb(), u = F.auth.currentUser;
  if (!u) return;
  try { await deleteDoc(doc(F.db, 'screens', u.uid)); } catch (e) {}
}

// أنماط نموذج الدخول (مشتركة)
export const GATE_CSS = `.gate{position:fixed;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;padding:16px;z-index:100;background:var(--bg)}
.gate-f{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px 22px;text-align:center}
.gate-logo{width:56px;height:56px;margin:0 auto 10px;border-radius:16px;background:#0A100D;color:#3DF08B;display:grid;place-items:center;font-size:30px;font-weight:700}
.gate-f h1{font-size:21px;margin-bottom:4px}.gate-f p{color:var(--muted);font-size:13.5px;margin-bottom:14px}
.gate-i{display:block;width:100%;margin-top:10px;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--text);font:inherit;font-size:15px;text-align:left}
.gate-b{display:block;width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#0A100D;color:#3DF08B;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.gate-e{color:#FF4D2E;font-weight:600;font-size:13.5px;margin-top:10px;min-height:1em}
.gate-w{font-size:40px}
.gate-hold .gate-msg{font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px}.gate-hold .gate-sub{margin-bottom:6px}
.gate-spin{display:inline-block;animation:gateSpin 2.4s linear infinite;margin:6px 0}@keyframes gateSpin{to{transform:rotate(360deg)}}
.gate-out{background:transparent;color:var(--muted);border:1.5px solid var(--line);font-weight:600;font-size:14px;padding:11px}`;
