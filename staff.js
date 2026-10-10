// سرعة — دخول موظفي المطعم للصفحات الصغيرة (شاشة «طلبك جاهز» وتطبيق الويتر)
// نفس حساب الكاشير ونفس الجلسة: الجهاز اللي مسجّل دخول بالكاشير يفتحها مباشرة.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, collection, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// يوم الطلب بتوقيت بغداد (نفس حقل day بطلبات الكاشير)
export const bagDay = (ms) => new Date((ms == null ? Date.now() : ms) + 3 * 3600000).toISOString().slice(0, 10);

const ERR = { 'auth/invalid-credential': 'الإيميل أو الرمز غلط', 'auth/wrong-password': 'الإيميل أو الرمز غلط', 'auth/user-not-found': 'الإيميل أو الرمز غلط',
  'auth/too-many-requests': 'محاولات كثيرة — انتظر شوية وجرّب', 'auth/network-request-failed': 'ماكو إنترنت' };

// el: مكان نموذج الدخول — onIn({uid, role, name, rid, rest}) / onOut()
// remember: يحفظ آخر إيميل دخل بيه على هذا الجهاز (التلفزيون: بس يكتب الرمز بالريموت)
// device: 'claim' — حساب الكاشير يسجّل جلسته على هذا الجهاز (الأجهزة المعتمدة)، مثل الويتر.
//   بدونه (الشاشة): لما الخدمة شغّالة الكاشيرية ما يدخلون — الشاشة تدخل بحساب صاحب المطعم
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
      if (remember && user.email) { try { localStorage.setItem(EMAIL_KEY, user.email); } catch (e) {} }
      const r = await getDoc(doc(db, 'restaurants', rid)), rest = r.exists() ? r.data() : {};
      // الأجهزة المعتمدة (حساب كاشير)
      const SD = window.SoraDev;
      if (d.role === 'cashier' && SD && device !== 'claim' && SD.devicesOn(rest)) return deny('🔐 هذي الصفحة تدخل بحساب صاحب المطعم — حسابات الكاشيرية بس على أجهزة الكاشير المعتمدة');
      if (d.role === 'cashier' && SD && device === 'claim') {
        const fsx = { db, doc, getDoc, setDoc, updateDoc, onSnapshot };
        if (await SD.claim(fsx, user, { ...d, restaurantId: rid }, rest) === 'blocked') {
          if (!document.getElementById('devCss')) { const st = document.createElement('style'); st.id = 'devCss'; st.textContent = SD.CSS; document.head.appendChild(st); }
          el.hidden = false; el.innerHTML = SD.blockHtml(SD.info());
          el.querySelector('#devOut').onclick = async () => { await signOut(auth).catch(() => {}); location.reload(); };
          SD.watch(fsx, SD.info(), () => location.reload(), rid);
          return;
        }
      }
      el.hidden = true; el.innerHTML = '';
      onIn({ uid: user.uid, role: d.role, name: d.name || '', rid, rest });
    } catch (e) { deny(e.code === 'permission-denied' ? '⛔ الحساب موقوف أو خارج وقت الدوام' : '📶 تعذّر الاتصال — تأكد من الإنترنت'); }
  });
}

// أنماط نموذج الدخول (مشتركة)
export const GATE_CSS = `.gate{position:fixed;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;padding:16px;z-index:100;background:var(--bg)}
.gate-f{width:min(380px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px 22px;text-align:center}
.gate-logo{width:56px;height:56px;margin:0 auto 10px;border-radius:16px;background:#0A100D;color:#3DF08B;display:grid;place-items:center;font-size:30px;font-weight:700}
.gate-f h1{font-size:21px;margin-bottom:4px}.gate-f p{color:var(--muted);font-size:13.5px;margin-bottom:14px}
.gate-i{display:block;width:100%;margin-top:10px;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--text);font:inherit;font-size:15px;text-align:left}
.gate-b{display:block;width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#0A100D;color:#3DF08B;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.gate-e{color:#FF4D2E;font-weight:600;font-size:13.5px;margin-top:10px;min-height:1em}
.gate-w{font-size:40px}`;
