// سرعة — دخول موظفي المطعم للصفحات الصغيرة (شاشة «طلبك جاهز» وتطبيق الويتر)
// نفس حساب الكاشير ونفس الجلسة: الجهاز اللي مسجّل دخول بالكاشير يفتحها مباشرة.
// وشاشات المطبخ (المجهز والأقسام): تنربط بالمطعم برمز — بدون إيميل ولا كلمة سر (screenGate تحت).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
export const db = getFirestore(app);
export const logout = () => signOut(auth);

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// يوم الطلب بتوقيت بغداد (نفس حقل day بطلبات الكاشير)
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
      onIn({ uid: user.uid, role: d.role, name: d.name || '', rid, rest });
    } catch (e) {
      if (e.code === 'permission-denied') deny('⛔ الحساب موقوف أو خارج وقت الدوام', true);
      else if (remember && netErr(e)) hold('📶 ننتظر الإنترنت…', user);
      else deny('📶 تعذّر الاتصال — تأكد من الإنترنت', true);
    }
  }
}

// ══ شاشات المطبخ المربوطة برمز ══
// جلسة «مجهولة» بتطبيق Firebase منفصل (sora3a-screen) — ما تمس جلسة الكاشير أو الويتر بنفس المتصفح.
// الشاشة تطلع رمز (screenPairs/{الرمز}) ← صاحب المطعم (لوحة الإدارة ← الشاشات) أو برج سرعة يكتبه ← screens/{uid}
// ← تفتح وحدها. إذا «الأجهزة المعتمدة» شغّالة، اللي يربطها صاحب المطعم تنتظر اعتماد البرج.
let scrFb = null;
export function screenFb() {
  if (!scrFb) {
    const a = initializeApp(CFG, 'sora3a-screen');
    scrFb = { app: a, auth: initializeAuth(a, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }), db: getFirestore(a) };
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
// kind: 'kitchen' | 'kitchenSec' — onIn({uid, rid, rest, screen}) / onOut()
export function screenGate(el, { title, kind, label, onIn, onOut }) {
  const F = screenFb();
  if (!document.getElementById('pairCss')) { const st = document.createElement('style'); st.id = 'pairCss'; st.textContent = PAIR_CSS; document.head.appendChild(st); }
  let unsub = null, retryT = 0, inUid = '', cur = null, busy = false;
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
  dropOwnerLogin().finally(() => onAuthStateChanged(F.auth, (user) => {
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
    const link = new URL('../sora3a-admin/?pair=' + code, location.href).href;
    box(`<p>اربط هذي الشاشة بالمطعم — بدون إيميل وبدون رمز سري</p>
      <div class="pair-code" id="pairCode" dir="ltr">${esc(code)}</div><div class="pair-qr" id="pairQr"></div>
      <ol class="pair-steps"><li>صاحب المطعم: <b>لوحة الإدارة ← 📺 الشاشات ← 🔗 ربط شاشة</b> ويكتب الرمز، أو يمسح الـQR بكاميرا التلفون</li><li>أو <b>إدارة سرعة</b> تربطها من برج سرعة</li></ol>
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
      onIn({ uid: user.uid, rid: d.restaurantId, rest: r.exists() ? r.data() : {}, screen: d });
    } catch (e) {
      if (user !== cur) return;
      leave();
      const wait = e && e.code === 'permission-denied';
      box(`<p>✅ انربطت${d.restName ? ' بـ<b>' + esc(d.restName) + '</b>' : ''}</p>
        <div class="pair-st ${wait ? 'warn' : ''}">${!wait ? '📶 ننتظر الإنترنت…' : d.approved === false ? '⏳ بانتظار اعتماد إدارة سرعة… تفتح وحدها أول ما تنعتمد' : '⛔ المطعم موقوف حالياً — الشاشة ترجع وحدها'}</div>
        <button class="gate-b gate-out" type="button" id="pairOut">🔌 فصل الشاشة</button>`);
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
.gate-f{width:min(380px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px 22px;text-align:center}
.gate-logo{width:56px;height:56px;margin:0 auto 10px;border-radius:16px;background:#0A100D;color:#3DF08B;display:grid;place-items:center;font-size:30px;font-weight:700}
.gate-f h1{font-size:21px;margin-bottom:4px}.gate-f p{color:var(--muted);font-size:13.5px;margin-bottom:14px}
.gate-i{display:block;width:100%;margin-top:10px;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--text);font:inherit;font-size:15px;text-align:left}
.gate-b{display:block;width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#0A100D;color:#3DF08B;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.gate-e{color:#FF4D2E;font-weight:600;font-size:13.5px;margin-top:10px;min-height:1em}
.gate-w{font-size:40px}
.gate-hold .gate-msg{font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px}.gate-hold .gate-sub{margin-bottom:6px}
.gate-spin{display:inline-block;animation:gateSpin 2.4s linear infinite;margin:6px 0}@keyframes gateSpin{to{transform:rotate(360deg)}}
.gate-out{background:transparent;color:var(--muted);border:1.5px solid var(--line);font-weight:600;font-size:14px;padding:11px}`;
