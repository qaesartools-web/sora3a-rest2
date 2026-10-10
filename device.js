// سرعة — الأجهزة المعتمدة (مشترك: الكاشير + الويتر)
// كل جهاز إله مفتاح سري (يتولد مرة وحدة ويبقى بالجهاز) ورمز قصير يقراه الكاشير لإدارة سرعة.
// الكاشير لما يدخل: يسجّل جلسته على هذا الجهاز (sessions/{uid}) — السيرفر يقبلها بس إذا الجهاز معتمد لمطعمه
// (لما خدمة «الأجهزة المعتمدة» شغّالة). وكل جهاز يسجّل نفسه بطلب اعتماد (deviceReqs) حتى تشوفه الإدارة وتعتمده.
// fs = { db, doc, getDoc, setDoc, updateDoc, onSnapshot } — setDoc/updateDoc لازم ينتظرون رد السيرفر
(function () {
  'use strict';
  const KEY = 'sora3a_dev_key', CODE = 'sora3a_dev_code';
  const rnd = (n, abc) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, (x) => abc[x % abc.length]).join(''); };
  const ls = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  function info() {
    let key = ls.get(KEY), code = ls.get(CODE);
    if (key.length < 20) { key = rnd(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'); ls.set(KEY, key); }
    if (!/^[A-Z2-9]{6}$/.test(code)) { code = rnd(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); ls.set(CODE, code); }
    const ua = navigator.userAgent;
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
    const D = window.SoraDesktop;
    const app = /waiter/.test(location.pathname) ? 'الويتر' : D ? (D.platform === 'android' ? 'تطبيق الكاشير' : 'برنامج الكاشير') : 'الكاشير (متصفح)';
    return { key, code, platform: os + ' • ' + app };
  }
  const devicesOn = (rest) => !!(rest && rest.features && rest.features.devices === true);
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);
  // يسجّل الجهاز عند الإدارة (طلب اعتماد) — ما يأثر على الدخول
  async function register(fs, user, ud, d) {
    const ref = fs.doc(fs.db, 'deviceReqs', d.key);
    const last = { lastAtMs: Date.now(), lastUid: user.uid, lastName: String(ud.name || ud.email || '').slice(0, 80), platform: d.platform };
    try {
      const s = await fs.getDoc(ref);
      if (!s.exists()) await fs.setDoc(ref, { restaurantId: ud.restaurantId, code: d.code, status: 'pending', createdAtMs: Date.now(), ...last });
      else if (s.data().status === 'pending') await fs.updateDoc(ref, last);
    } catch (e) {}
  }
  // يسجّل جلسة الكاشير على هذا الجهاز. يرجّع 'ok' أو 'blocked' (الجهاز مو معتمد والخدمة شغّالة)
  async function claim(fs, user, ud, rest) {
    const d = info();
    let authTime = 0;
    try { authTime = Number((await user.getIdTokenResult()).claims.auth_time) || 0; } catch (e) {}
    register(fs, user, ud, d);
    try {
      await timeout(fs.setDoc(fs.doc(fs.db, 'sessions', user.uid), { device: d.key, authTime, restaurantId: ud.restaurantId, atMs: Date.now(),
        name: (String(ud.name || '').slice(0, 30) + ' • ' + d.platform).slice(0, 80) }), 9000);
      return 'ok';
    } catch (e) {
      return e && e.code === 'permission-denied' && devicesOn(rest) ? 'blocked' : 'ok';   // بدون إنترنت أو الخدمة مطفية: يكمل
    }
  }
  // شاشة «الجهاز مو معتمد» برمز الجهاز، وتنتظر الاعتماد وتفتح وحدها
  function blockHtml(d) {
    return `<div class="dev-box"><div class="dev-i">🔐</div><b>هذا الجهاز مو معتمد لمطعمك</b>
      <div class="dev-s">حتى تشتغل على هذا الجهاز، اتصل بإدارة سرعة واعطيهم رمز الجهاز:</div>
      <div class="dev-code" dir="ltr">${d.code}</div>
      <div class="dev-st" id="devSt">⏳ بانتظار الاعتماد… يفتح وحده أول ما يعتمدونه</div>
      <button type="button" class="dev-out" id="devOut">🚪 تسجيل خروج</button></div>`;
  }
  // rid = مطعم الكاشير. يفتح وحده بس مرة بالدقيقة (حتى ما يدور إذا الطلب «معتمد» بس الجهاز مو معتمد لهذا المطعم)
  function watch(fs, d, onApproved, rid) {
    return fs.onSnapshot(fs.doc(fs.db, 'deviceReqs', d.key), (s) => {
      const r = s.exists() ? s.data() : {}, st = r.status || '', el = document.getElementById('devSt');
      if (!el) return;
      if (rid && r.restaurantId && r.restaurantId !== rid) { el.textContent = '⚠️ هذا الجهاز مسجّل باسم مطعم ثاني — كلّم إدارة سرعة'; return; }
      if (st === 'approved') {
        let last = 0; try { last = +sessionStorage.getItem('sora3a_dev_reload') || 0; } catch (e) {}
        if (Date.now() - last < 60000) { el.textContent = '⚠️ الجهاز معتمد بس ما انفتح — سجّل خروج وادخل مرة ثانية، أو كلّم إدارة سرعة'; return; }
        try { sessionStorage.setItem('sora3a_dev_reload', String(Date.now())); } catch (e) {}
        el.textContent = '✅ انعتمد الجهاز — دا يفتح…'; setTimeout(onApproved, 700);
      } else if (st === 'rejected') el.textContent = '❌ انرفض اعتماد هذا الجهاز — كلّم إدارة سرعة';
      else el.textContent = '⏳ بانتظار الاعتماد… يفتح وحده أول ما يعتمدونه';
    }, () => {});
  }
  const CSS = `.dev-box{background:#fff;color:#0E1726;border-radius:22px;padding:26px 22px;max-width:380px;width:100%;text-align:center;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:inherit}
.dev-i{font-size:50px;line-height:1}.dev-box b{font-size:19px}.dev-s{font-size:13.5px;color:#5B6476;line-height:1.7}
.dev-code{font-family:ui-monospace,Consolas,monospace;font-size:38px;font-weight:900;letter-spacing:6px;background:#EEF1F6;border:2px dashed #4F6BED;border-radius:14px;padding:10px 6px;color:#1E3A8A}
.dev-st{font-size:13.5px;font-weight:700;color:#0F7A3D}.dev-out{border:1px solid #E3E7EF;background:#F7F8FB;border-radius:12px;padding:11px;font:inherit;font-weight:700;cursor:pointer}`;
  window.SoraDev = { info, claim, register, blockHtml, watch, devicesOn, CSS };
})();
