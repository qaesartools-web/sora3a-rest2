// هوية سرعة الموحدة («الشريط»): شريط بلون التطبيق فوق بيه شعارنا واسم التطبيق، سطر حقوقنا تحت، وشاشة فتح موحدة.
// نفس الملف بكل مستودع (sora3a-rest2 / sora3a-captain / sora3a-admin) — أي تعديل ينعاد بالثلاثة.
// رقمنا وإيميلنا مكتوبين هنا: صاحب المطعم ما يكدر يغيرهن ولا يخفيهن. يتغيرن من برج سرعة بس (config/brand) وينحفظن بالجهاز.
(function () {
  var APPS = {
    cashier: ['الكاشير', '#2BC46A', '#0F7A3D'],
    admin: ['لوحة الإدارة', '#4F6BED', '#1E3A8A'],
    kitchen: ['المطبخ', '#22C7D9', '#0B6A80'],
    prep: ['المجهز', '#A78BFA', '#5B21B6'],
    waiter: ['الويتر', '#FF5C7A', '#B3123C'],
    captain: ['الكابتن', '#F7A41D', '#D9480F'],
    screen: ['شاشة طلبك جاهز', '#FACC15', '#A16207', '#2A1F00'],
    line: ['خط المطعم', '#4B5563', '#111827'],
    store: ['إدارة المخزن', '#B07A4A', '#6B4423'],
    menu: ['منيو المطعم', '#2BC46A', '#0F7A3D'],
    tracking: ['تتبع الطلب', '#2BC46A', '#0F7A3D']
  };
  var DEF = { phone: '0771 139 1715', email: 'qaesar.thelove@gmail.com' };
  var KEY = 'sb_brand', SYNC_MS = 6 * 3600000;
  var saved = function () { try { var j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.phone && j.email) return j; } catch (e) {} return null; };
  var cur = saved() || { phone: DEF.phone, email: DEF.email };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var P = 'M96 38 V54 A8 8 0 0 1 80 54 V46 V54 A8 8 0 0 1 64 54 V46 V60 A22 22 0 0 1 20 60 V54';
  var mark = function (fg) {
    return '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><path d="' + P + '" fill="none" stroke="' + fg + '" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M30 88 H64 M44 100 H84" stroke="' + fg + '" stroke-opacity=".7" stroke-width="7" stroke-linecap="round"/></svg>';
  };
  var credit = function (name) {
    return (name ? '<b>منظومة سرعة</b><i>·</i>' : '') + '<bdi data-sb="phone">' + esc(cur.phone) + '</bdi><i>·</i><bdi data-sb="email">' + esc(cur.email) + '</bdi>';
  };
  var el = function (cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };

  // شاشة الفتح: إذا الصفحة بيها #splash (الكاشير، الإدارة، الكابتن) نلبسه الشكل الموحد ونخلي الصفحة تخفيه مثل قبل،
  // وإذا ما بيها نسوي وحدة تختفي بعد ما تفتح الصفحة. ما تمنع اللمس، فالشاشة تشتغل من أول لحظة.
  function splash(app) {
    var a = APPS[app], s = document.getElementById('splash'), own = !s;
    if (own) { s = el('sb-own'); s.id = 'sbSplash'; document.body.appendChild(s); }
    s.classList.add('sb-splash');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<div class="sb-sp-mid"><span class="sb-sp-m">' + mark('currentColor') + '</span><span class="sb-wm">سرعة</span><span class="sb-an">' + a[0] + '</span></div>' +
      '<div class="sb-sp-ft">منظومة سرعة<bdi data-sb="phone">' + esc(cur.phone) + '</bdi></div>';
    if (!own) return;
    var t0 = Date.now(), gone = false;
    var done = function () {
      if (gone) return; gone = true;
      setTimeout(function () { s.classList.add('sb-gone'); setTimeout(function () { s.remove(); }, 450); }, Math.max(0, 900 - (Date.now() - t0)));
    };
    if (document.readyState === 'complete') done(); else window.addEventListener('load', done);
    setTimeout(done, 3000);
  }

  // شاشة الترحيب: تطلع عند كل دخول (بعد تسجيل الدخول أو ربط الشاشة) — لون التطبيق، تحية حسب الوقت، الاسم والمطعم.
  // تختفي وحدها بعد ثانيتين تقريباً أو بضغطة. o: { app, name, rest, role, ms }
  var curApp = '';
  // شاشة الترحيب «النفق» عند كل دخول: نجوم تنسحب بسرعة الضوء بلون التطبيق، والشعار يطلع من نص النفق بومضة،
  //  ويمه «سرعة» و«SORA3A» واسم التطبيق بالعربي والإنكليزي. ضغطة تخفيها، وتختفي وحدها بعد ثانيتين ونص
  var EN = { cashier: 'CASHIER', admin: 'ADMIN', kitchen: 'KITCHEN', prep: 'EXPEDITOR', waiter: 'WAITER', captain: 'CAPTAIN',
    screen: 'ORDER READY', line: 'PHONE LINE', store: 'WAREHOUSE', menu: 'MENU', tracking: 'TRACKING' };
  var rgbA = function (h, a) { h = String(h).replace('#', ''); return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')'; };
  // النجوم على canvas — الأجهزة الضعيفة عدد أقل، والقديمة اللي ما بيها canvas تطلع بدونها
  function warp(cv, col) {
    var ctx = cv && cv.getContext && cv.getContext('2d');
    if (!ctx) return function () {};
    var rq = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(+new Date()); }, 33); };
    var cq = window.cancelAnimationFrame || clearTimeout;
    var dpr = Math.min(1.5, window.devicePixelRatio || 1), weak = (navigator.hardwareConcurrency || 4) <= 2;
    var W = cv.width = Math.max(1, Math.round((cv.offsetWidth || innerWidth) * dpr)), H = cv.height = Math.max(1, Math.round((cv.offsetHeight || innerHeight) * dpr));
    var R = Math.sqrt(W * W + H * H) * 0.62, cx = W / 2, cy = H * 0.45, t0 = 0, raf = 0, live = true, stars = [], i;
    var star = function (any) { return { a: Math.random() * 6.2832, d: any ? Math.random() * 0.9 : 0.01 + Math.random() * 0.05, s: 0.35 + Math.random() * 0.75, c: Math.random() < 0.45 }; };
    for (i = 0; i < (weak ? 70 : 150); i++) stars.push(star(true));
    function frame(now) {
      if (!live) return;
      if (!t0) t0 = now;
      var el = (now - t0) / 1000, sp = el < 1 ? 1 : Math.max(0.05, 1 - (el - 1) / 0.9);
      ctx.clearRect(0, 0, W, H);
      for (var j = 0; j < stars.length; j++) {
        var st = stars[j], d0 = st.d;
        st.d += sp * st.s * 0.035 * (0.25 + st.d * 2.6);
        if (st.d > 1.05) { stars[j] = star(false); continue; }
        var ca = Math.cos(st.a), sa = Math.sin(st.a), bk = Math.max(d0 - sp * 0.05, 0);
        ctx.strokeStyle = st.c ? col : 'rgba(255,255,255,0.9)';
        ctx.globalAlpha = Math.min(1, st.d * 1.8);
        ctx.lineWidth = Math.max(1, st.d * 2.6 * dpr);
        ctx.beginPath(); ctx.moveTo(cx + ca * bk * R, cy + sa * bk * R); ctx.lineTo(cx + ca * st.d * R, cy + sa * st.d * R); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = rq(frame);
    }
    raf = rq(frame);
    return function () { live = false; cq(raf); };
  }
  function welcome(o) {
    o = o || {};
    var app = o.app || curApp, a = APPS[app], B = document.body;
    if (!a || !B || welcome.done || (window.SB_NO_WELCOME && !window.SB_WELCOME_TEST)) return;
    welcome.done = true;
    var g1 = a[1], g2 = a[2];
    var w = el('sb-welcome', '<canvas class="sb-w-cv" aria-hidden="true"></canvas><i class="sb-w-fl"></i>' +
      '<div class="sb-w-in"><span class="sb-w-t">' + mark('#fff') + '</span><div class="sb-w-x">' +
      '<div class="sb-w-ar"><span>سرعة</span></div><div class="sb-w-en">SORA3A</div>' +
      '<div class="sb-w-a"><b>' + esc(o.role || a[0]) + '</b>' + (EN[app] ? '<i>' + EN[app] + '</i>' : '') + '</div></div></div>' +
      '<div class="sb-w-pb"><i></i></div>');
    w.setAttribute('role', 'status'); w.setAttribute('aria-label', 'سرعة — ' + (o.role || a[0]));
    // لون التطبيق (بدون متغيرات CSS حتى يشتغل بالمتصفحات القديمة)
    w.style.background = 'radial-gradient(ellipse at 50% 45%,' + rgbA(g2, 0.55) + ' 0%,#030507 70%)';
    w.querySelector('.sb-w-t').style.background = 'linear-gradient(145deg,' + g1 + ',' + g2 + ')';
    w.querySelector('.sb-w-t').style.boxShadow = 'inset 0 0 0 3px rgba(255,255,255,.18),0 18px 60px ' + rgbA(g1, 0.5);
    w.querySelector('.sb-w-fl').style.background = 'radial-gradient(circle,rgba(255,255,255,.95) 0,' + rgbA(g1, 0.55) + ' 22%,rgba(0,0,0,0) 60%)';
    w.querySelector('.sb-w-en').style.color = g1;
    w.querySelector('.sb-w-pb i').style.background = g1;
    var stop = function () {};
    var gone = false, hide = function () { if (gone) return; gone = true; w.className += ' sb-gone'; setTimeout(function () { stop(); if (w.parentNode) w.parentNode.removeChild(w); }, 450); };
    w.addEventListener('click', hide);
    document.addEventListener('keydown', function k() { document.removeEventListener('keydown', k); hide(); });
    // شاشة الفتح تختفي حتى ما يتداخلن
    var sp = document.querySelectorAll('.sb-splash'); for (var i = 0; i < sp.length; i++) sp[i].style.visibility = 'hidden';
    B.appendChild(w);
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) { try { stop = warp(w.querySelector('.sb-w-cv'), g1); } catch (e) {} }
    setTimeout(hide, o.ms || 2600);
  }

  // opts: { bar:false } بدون شريط (منيو المطعم)، { foot:false } بدون سطر تحت (الصفحة تحط الحقوق بمكانها بـ SB.fill)، { splash:false }
  function mount(app, o) {
    o = o || {};
    var a = APPS[app], H = document.documentElement, B = document.body;
    if (!a || !B || H.classList.contains('sb-on')) return;
    H.classList.add('sb-on', 'sb-' + app); curApp = app;
    if (o.bar === false) H.classList.add('sb-nobar');
    if (o.foot === false) H.classList.add('sb-nofoot');
    H.style.setProperty('--sbG1', a[1]); H.style.setProperty('--sbG2', a[2]); H.style.setProperty('--sbOn', a[3] || '#fff');
    if (o.bar !== false) {
      B.insertBefore(el('sb-bar', '<span class="sb-m">' + mark('currentColor') + '</span><span class="sb-wm">سرعة</span><span class="sb-sep"></span><span class="sb-an">' + a[0] + '</span>' +
        (o.barNote ? '<span class="sb-note">' + esc(o.barNote) + '</span>' : '')), B.firstChild);
    }
    if (o.foot !== false) B.appendChild(el('sb-foot', '<span class="sb-tile">' + mark('#fff') + '</span><span class="sb-c">' + credit(true) + '</span>'));
    if (o.splash !== false) splash(app);
  }

  // يحط سطر الحقوق داخل عنصر من الصفحة (مثلاً تذييل شاشة طلبك جاهز، أو شريط آخر منيو المطعم)
  function fill(target, kind, href) {
    var t = typeof target === 'string' ? document.querySelector(target) : target;
    if (!t) return;
    var tag = href ? 'a' : 'div', at = href ? ' href="' + esc(href) + '" target="_blank" rel="noopener"' : '';
    t.innerHTML = kind === 'band'
      ? '<' + tag + ' class="sb-band"' + at + '><span class="sb-band-r"><span class="sb-m">' + mark('currentColor') + '</span><span class="sb-wm">سرعة</span></span><span class="sb-c">' + credit(false) + '</span></' + tag + '>'
      : '<span class="sb-inline"><span class="sb-tile">' + mark('currentColor') + '</span><span class="sb-c">' + credit(true) + '</span></span>';
  }

  // آخر الوصل (أبيض وأسود لأن الطابعة حرارية): شعارنا + منظومة سرعة + الرقم + الإيميل
  function receipt() {
    return '<div style="text-align:center;margin-top:8px;border-top:1px dashed #000;padding-top:8px;color:#000">' +
      '<div style="width:30px;height:30px;margin:0 auto 2px">' + mark('#000') + '</div>' +
      '<div style="font-weight:800;font-size:13px">منظومة سرعة للمطاعم</div>' +
      '<div dir="ltr" style="font-weight:700;font-size:12.5px">' + esc(cur.phone) + '</div>' +
      '<div dir="ltr" style="font-size:11px">' + esc(cur.email) + '</div></div>';
  }

  var paint = function () {
    document.querySelectorAll('[data-sb="phone"]').forEach(function (e) { e.textContent = cur.phone; });
    document.querySelectorAll('[data-sb="email"]').forEach(function (e) { e.textContent = cur.email; });
  };
  var clean = function (d) {
    var phone = String((d && d.phone) || '').trim(), email = String((d && d.email) || '').trim();
    return /^[0-9+ ]{7,20}$/.test(phone) && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email) ? { phone: phone, email: email } : null;
  };
  // الرقم والإيميل من البرج: الصفحة تعطي دالة تقرا config/brand، ونقراه مرة كل ٦ ساعات بالأكثر (حتى ما نزيد القراءات)
  function sync(read) {
    try { if (Date.now() - (+localStorage.getItem(KEY + '_at') || 0) < SYNC_MS) return; } catch (e) {}
    Promise.resolve().then(read).then(function (d) {
      var c = clean(d) || { phone: DEF.phone, email: DEF.email };
      try { localStorage.setItem(KEY, JSON.stringify(c)); localStorage.setItem(KEY + '_at', String(Date.now())); } catch (e) {}
      if (c.phone !== cur.phone || c.email !== cur.email) { cur = c; paint(); }
    }).catch(function () {});
  }

  // ── صحة الجهاز (مرة كل 12 ساعة): فرق ساعة الجهاز، عمر المتصفح، ونتيجة فحص الحماية — تنحفظ بـ devHealth/{الجهاز}
  //    حتى برج سرعة يعرف يا جهاز يسبب رفض الطلبات (ساعة غلط أو متصفح قديم) قبل تفعيل الرفض. write(id, data) من التطبيق
  var devId = function () { try { var k = localStorage.getItem('sb_dev'); if (!k) { k = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('sb_dev', k); } return k; } catch (e) { return ''; } };
  // اسم المتصفح ورقمه: تطبيقات الأندرويد (WebView) بيها «Version/4.0» قبل Chrome — نفحص Chrome أول حتى يطلع رقمه الحقيقي
  var browserOf = function (ua) {
    var L = [['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Samsung', /SamsungBrowser\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
    for (var i = 0; i < L.length; i++) { var m = L[i][1].exec(ua); if (m) return L[i][0] + ' ' + m[1] + (/; wv\)/.test(ua) ? ' (تطبيق)' : ''); }
    return '?';
  };
  function health(write, info) {
    info = info || {};
    var id = devId(); if (!id || typeof write !== 'function') return;
    try { if (!window.SB_HEALTH_TEST && Date.now() - (+localStorage.getItem('sb_health_at') || 0) < 12 * 3600000) return; } catch (e) {}
    var t0 = Date.now();
    var go = function (skew) {
      var tries = 0;
      (function wait() {   // ننتظر نتيجة فحص الحماية شوية (تجي من appCheck بالصفحة)
        if (!window.__acState && /\.github\.io$/.test(location.hostname) && tries++ < 16) { setTimeout(wait, 500); return; }
        var ua = String(navigator.userAgent || '');
        var d = { app: curApp || '', page: (location.pathname.split('/').pop() || 'index.html').slice(0, 40), ua: ua.slice(0, 200), browser: browserOf(ua).slice(0, 40),
          skewSec: skew == null ? null : skew, ac: String(window.__acState || (/\.github\.io$/.test(location.hostname) ? 'pending' : 'off')).slice(0, 100),
          rid: String(info.rid || '').slice(0, 60), rest: String(info.rest || '').slice(0, 80), who: String(info.who || '').slice(0, 60), atMs: Date.now(), v: 1 };
        Promise.resolve().then(function () { return write(id, d); }).then(function () { try { localStorage.setItem('sb_health_at', String(Date.now())); } catch (e) {} }).catch(function () {});
      })();
    };
    fetch('brand.css', { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var t1 = Date.now(), srv = Date.parse(r.headers.get('date') || '');
      go(srv ? Math.round(((t0 + t1) / 2 - srv) / 1000) : null);   // بالثواني: موجب = الجهاز مقدّم
    }).catch(function () { go(null); });
  }

  window.SB = {
    mount: mount, fill: fill, receipt: receipt, sync: sync, mark: mark, welcome: welcome, health: health,
    get phone() { return cur.phone; }, get email() { return cur.email; }, apps: APPS
  };
})();
