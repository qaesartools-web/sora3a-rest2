// سرعة — نوافذ التأكيد والإدخال (مشترك: الكاشير + خط المطعم)
// تطبيق الأندرويد القديم (قبل تحديث الـ APK) يتجاهل confirm/prompt/alert ويرجّع «لا» وحده —
// فبالتطبيق نعرض نافذة داخل الصفحة، وبالمتصفح نخلي نوافذ المتصفح نفسها.
//   if (!(await askOk('تسجيل الخروج؟'))) return;
//   const name = await askText('اسم الفرع الجديد:', 'مشويات');   // null = إلغاء
//   askInfo('خطأ: ...');
(function () {
  'use strict';
  const IN_APP = /SoraCashierApp|SoraScreenApp/.test(navigator.userAgent);
  const CSS = '.ask-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl}'
    + '.ask-box{background:#fff;color:#1a1a1a;border-radius:16px;padding:20px 18px 16px;width:100%;max-width:360px;box-shadow:0 10px 40px rgba(0,0,0,.35);font-family:inherit}'
    + '.ask-msg{font-size:16px;font-weight:700;line-height:1.6;white-space:pre-line;margin-bottom:14px}'
    + '.ask-in{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:1.5px solid #ccc;border-radius:10px;margin-bottom:14px}'
    + '.ask-btns{display:flex;gap:10px}.ask-btns button{flex:1;font:inherit;font-size:16px;font-weight:700;padding:12px;border-radius:12px;border:0;cursor:pointer}'
    + '.ask-yes{background:#16a34a;color:#fff}.ask-no{background:#e5e7eb;color:#1a1a1a}';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(msg, { input = false, def = '', ok = 'نعم', no = 'لا' } = {}) {
    if (!document.getElementById('askCss')) { const st = document.createElement('style'); st.id = 'askCss'; st.textContent = CSS; document.head.appendChild(st); }
    return new Promise((res) => {
      const ov = document.createElement('div');
      ov.className = 'ask-ov';
      ov.innerHTML = `<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-msg">${esc(msg)}</div>`
        + (input ? `<input class="ask-in" value="${esc(def)}">` : '')
        + `<div class="ask-btns"><button type="button" class="ask-yes">${esc(ok)}</button>${no ? `<button type="button" class="ask-no">${esc(no)}</button>` : ''}</div></div>`;
      const inp = ov.querySelector('.ask-in');
      const done = (yes) => { window.removeEventListener('keydown', key, true); ov.remove(); res(input ? (yes ? inp.value : null) : yes); };
      // Enter = نعم، Esc = لا — وما توصل لاختصارات الكاشير (مثلاً Enter بنافذة الدفع)
      const key = (e) => { if (e.key !== 'Escape' && e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); done(e.key === 'Enter'); };
      ov.querySelector('.ask-yes').onclick = () => done(true);
      if (no) ov.querySelector('.ask-no').onclick = () => done(false);
      window.addEventListener('keydown', key, true);
      document.body.appendChild(ov);
      (inp || ov.querySelector('.ask-yes')).focus();
      if (inp) inp.select();
    });
  }

  window.askOk = (msg, ok, no) => (IN_APP ? show(msg, { ok, no }) : Promise.resolve(confirm(msg)));
  window.askText = (msg, def) => (IN_APP ? show(msg, { input: true, def, ok: 'تمام', no: 'إلغاء' }) : Promise.resolve(prompt(msg, def == null ? '' : def)));
  window.askInfo = (msg) => (IN_APP ? show(msg, { ok: 'تمام', no: '' }).then(() => {}) : Promise.resolve(alert(msg)));
})();
