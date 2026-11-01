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

  // opts: { bar:false } بدون شريط (منيو المطعم)، { foot:false } بدون سطر تحت (الصفحة تحط الحقوق بمكانها بـ SB.fill)، { splash:false }
  function mount(app, o) {
    o = o || {};
    var a = APPS[app], H = document.documentElement, B = document.body;
    if (!a || !B || H.classList.contains('sb-on')) return;
    H.classList.add('sb-on', 'sb-' + app);
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

  window.SB = {
    mount: mount, fill: fill, receipt: receipt, sync: sync, mark: mark,
    get phone() { return cur.phone; }, get email() { return cur.email; }, apps: APPS
  };
})();
