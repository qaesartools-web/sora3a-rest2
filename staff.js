// سرعة — دخول موظفي المطعم للصفحات الصغيرة (شاشة «طلبك جاهز» وتطبيق الويتر)
// نفس حساب الكاشير ونفس الجلسة: الجهاز اللي مسجّل دخول بالكاشير يفتحها مباشرة.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const app = initializeApp({
  apiKey: "AIzaSyAwlFrbv-c6G0_K0-s0P1m1o_qD95aGGyQ",
  authDomain: "sora3a-system.firebaseapp.com",
  projectId: "sora3a-system",
  storageBucket: "sora3a-system.firebasestorage.app",
  messagingSenderId: "516304449260",
  appId: "1:516304449260:web:0110ba6c2621d6a16dbfc9"
}, "pos-v2");
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
export const db = getFirestore(app);
export const logout = () => signOut(auth);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// يوم الطلب بتوقيت بغداد (نفس حقل day بطلبات الكاشير)
export const bagDay = (ms) => new Date((ms ?? Date.now()) + 3 * 3600000).toISOString().slice(0, 10);

const ERR = { 'auth/invalid-credential': 'الإيميل أو الرمز غلط', 'auth/wrong-password': 'الإيميل أو الرمز غلط', 'auth/user-not-found': 'الإيميل أو الرمز غلط',
  'auth/too-many-requests': 'محاولات كثيرة — انتظر شوية وجرّب', 'auth/network-request-failed': 'ماكو إنترنت' };

// el: مكان نموذج الدخول — onIn({uid, role, name, rid, rest}) / onOut()
export function staffGate(el, { title, sub, onIn, onOut }) {
  let busy = false;
  const form = (msg) => {
    el.hidden = false;
    el.innerHTML = `<form class="gate-f" autocomplete="on"><div class="gate-logo">س</div><h1>${esc(title)}</h1><p>${esc(sub || 'سجّل دخول بحساب المطعم أو حساب الكاشير')}</p>
      <input class="gate-i" id="gEmail" type="email" inputmode="email" dir="ltr" placeholder="الإيميل" autocomplete="username" required>
      <input class="gate-i" id="gPass" type="password" dir="ltr" placeholder="الرمز" autocomplete="current-password" required>
      <button class="gate-b" id="gGo" type="submit">دخول</button><div class="gate-e" id="gErr">${esc(msg || '')}</div></form>`;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault(); if (busy) return; busy = true;
      el.querySelector('#gGo').textContent = '⏳ …'; el.querySelector('#gErr').textContent = '';
      try { await signInWithEmailAndPassword(auth, el.querySelector('#gEmail').value.trim(), el.querySelector('#gPass').value); }
      catch (err) { el.querySelector('#gErr').textContent = ERR[err.code] || 'تعذّر الدخول'; el.querySelector('#gGo').textContent = 'دخول'; }
      busy = false;
    };
  };
  const deny = async (msg) => { await signOut(auth).catch(() => {}); form(msg); };
  onAuthStateChanged(auth, async (user) => {
    if (!user) { onOut && onOut(); form(); return; }
    el.hidden = false; el.innerHTML = '<div class="gate-w">⏳</div>';
    try {
      const u = await getDoc(doc(db, 'users', user.uid)), d = u.exists() ? u.data() : null;
      if (!d || d.disabled || !['restaurant', 'cashier'].includes(d.role)) return deny('❌ هذا الحساب مو حساب مطعم أو كاشير');
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
      const r = await getDoc(doc(db, 'restaurants', rid));
      el.hidden = true; el.innerHTML = '';
      onIn({ uid: user.uid, role: d.role, name: d.name || '', rid, rest: r.exists() ? r.data() : {} });
    } catch (e) { deny(e.code === 'permission-denied' ? '⛔ الحساب موقوف أو خارج وقت الدوام' : '📶 تعذّر الاتصال — تأكد من الإنترنت'); }
  });
}

// أنماط نموذج الدخول (مشتركة)
export const GATE_CSS = `.gate{position:fixed;inset:0;display:grid;place-items:center;padding:16px;z-index:100;background:var(--bg)}
.gate-f{width:min(380px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px 22px;text-align:center}
.gate-logo{width:56px;height:56px;margin:0 auto 10px;border-radius:16px;background:#0A100D;color:#3DF08B;display:grid;place-items:center;font-size:30px;font-weight:700}
.gate-f h1{font-size:21px;margin-bottom:4px}.gate-f p{color:var(--muted);font-size:13.5px;margin-bottom:14px}
.gate-i{display:block;width:100%;margin-top:10px;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--text);font:inherit;font-size:15px;text-align:left}
.gate-b{display:block;width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#0A100D;color:#3DF08B;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.gate-e{color:#FF4D2E;font-weight:600;font-size:13.5px;margin-top:10px;min-height:1em}
.gate-w{font-size:40px}`;
