/* ══════════ سرعة — كاشير احترافي ══════════
   يُحمَّل بعد السكربت الرئيسي ويطوّر وظائفه:
   • منيو سحابي متزامن بين كل أجهزة المطعم (مع الصور)
   • بحث، ملاحظات للأصناف، إضافة سريعة، خصم، ضريبة وخدمة
   • نافذة دفع (نقد/بطاقة/مختلط/لاحقاً) مع حساب الباقي
   • ورديات: فتح/إيداع/سحب/إغلاق + تقرير نهاية الوردية (Z)
   • شاشة مطبخ (KDS) بمؤقتات وتنبيه صوتي
   • إعدادات الفاتورة والتوصيل والطاولات + إشعارات المطعم */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const fb = () => window._fb;
  const rid = () => restData && restData.id;
  const sub = (...p) => fb().doc(fb().db, 'restaurants', rid(), ...p);
  const subCol = (...p) => fb().collection(fb().db, 'restaurants', rid(), ...p);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const money = (n) => fmt(Math.round(n || 0)) + ' د.ع';
  const num = (v) => { const n = Number(String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
  // صلاحيات: صاحب المطعم كل شيء، والكاشير حسب ما يحدده صاحب المطعم من تطبيق الإدارة
  const can = (p) => !window.posUser || window.posUser.role === 'owner' || !!((window.posUser.perms || {})[p]);
  const deny = () => toast('🔒 ليس لديك صلاحية — اطلبها من صاحب المطعم');
  const deviceId = lsGet('pos_device', null) || (() => { const d = uid('dev'); lsSet('pos_device', d); return d; })();

  // ══════════ الإعدادات ══════════
  const DEFAULTS = {
    receiptTitle: '', receiptSub: '', receiptPhone: '', receiptFooter: 'شكراً لزيارتكم ❤️',
    defaultFee: 5000, feePresets: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000], taxPct: 0, servicePct: 0, tables: 0, pagers: 10,
    printKitchen: false, quickAdd: true, paper: 80, drawer: false,
    // أقسام المطبخ: كل قسم يستلم أصنافه فقط، ورقم الطلب يوحّدها
    kSecOn: false, catSection: {},
    sections: [{ id: 'k1', name: 'الشاورما', emoji: '🌯' }, { id: 'k2', name: 'الكنتاكي', emoji: '🍗' }, { id: 'k3', name: 'البرغر', emoji: '🍔' },
      { id: 'k4', name: 'البيتزا', emoji: '🍕' }, { id: 'k5', name: '', emoji: '🍽️' }, { id: 'k6', name: '', emoji: '🥗' }],
    quickNotes: ['بدون بصل', 'بدون صوص', 'حار', 'زيادة جبن', 'بدون مخلل'],
  };
  let settings = { ...DEFAULTS };
  const setKey = () => 'pos_settings_' + rid();

  // ══════════ حالة الكاشير ══════════
  let disc = { type: 'amt', value: 0, reason: '' };
  let prodQuery = '';
  let shift = null;           // الوردية المفتوحة
  let lastSaved = null;       // آخر طلب انحفظ من finalOrder (رقمه لدين الزبون)
  let closedShifts = [];
  let kdsSound = lsGet('pos_kds_sound', true);
  const kdsSeen = new Set();
  let kdsReady = false;

  // ══════════ الحسابات ══════════
  function totals(type, items) {
    const list = items || cart;
    const subT = list.reduce((s, c) => s + (c.price || 0) * (c.qty || 1), 0);
    let d = disc.type === 'pct' ? Math.round(subT * Math.min(100, disc.value) / 100) : Math.min(disc.value || 0, subT);
    d = Math.max(0, d);
    // الضريبة وخدمة الصالة انشالت من الإعدادات ← ما تنحسب (حتى ما تبقى رسوم مخفية ما أحد يكدر يغيّرها)
    const service = 0, tax = 0;
    return { sub: subT, disc: d, service, tax, total: subT - d + service + tax };
  }

  // ══════════ المنيو السحابي ══════════
  let hasLocalMenu = false, menuCloudTs = 0, menuPushT = null, menuCloudExists = null;
  // المنيو يتعدل من لوحة الإدارة بس: الكاشير يرفع تغيّر «المخزون الجاهز» من البيع والإلغاء فقط،
  //  فوق آخر نسخة بالسحابة (transaction) — حتى ما يمسح تعديل سوّاه المالك بنفس اللحظة
  let stockDelta = {};
  window.posStockDelta = (name, d) => { if (name && d) stockDelta[name] = (stockDelta[name] || 0) + d; };
  const MENU_KEY = () => 'pos_menu_' + (rid() || 'def');
  const imgKey = (id) => 'pos_img_' + id;
  const imgSig = (d) => d ? d.length + ':' + d.slice(-32) : '';

  // استبدال loadMenu: لا نعرض منيو مطعم آخر للمطاعم الجديدة
  window.loadMenu = function () {
    const s = lsGet(MENU_KEY(), null);
    hasLocalMenu = Array.isArray(s) && s.length > 0;
    menu = hasLocalMenu ? s : [{ cat: 'عام', emoji: '🍽️', items: [] }];
  };
  // الأساس (كان بـ index.html) — نفس الكود
function saveMenuCore(){try{localStorage.setItem(menuKey(),JSON.stringify(menu));}catch(e){toast('⚠️ الذاكرة ممتلئة — قلّل حجم الصور');}}
  window.saveMenu = function (opts) {
    saveMenuCore();
    hasLocalMenu = true;
    if (!(opts && opts.local)) { clearTimeout(menuPushT); menuPushT = setTimeout(() => pushMenu(opts), 1200); }
  };

  async function pushMenu(opts) {
    if (!rid()) return;
    // مطعم قديم ما عنده منيو بالسحابة (أول جهاز) أو استرجاع نسخة احتياطية: يرتفع المنيو كامل
    if (menuCloudExists === false || (opts && opts.full)) return pushMenuFull();
    const ds = stockDelta; if (!Object.keys(ds).length) return;
    stockDelta = {};
    const f = fb(), ref = sub('menu', 'main');
    try {
      await f.runTransaction(f.db, async (tx) => {
        const s = await tx.get(ref); if (!s.exists()) return;
        const d = s.data(); let ch = false;
        const cats = (d.cats || []).map((c) => ({ ...c, items: (c.items || []).map((p) => {
          if (!(p.name in ds) || typeof p.stock !== 'number') return p;
          ch = true; return { ...p, stock: Math.max(0, p.stock + ds[p.name]) };
        }) }));
        if (!ch) return;
        menuCloudTs = Date.now();
        tx.set(ref, { ...d, cats, updatedAtMs: menuCloudTs, device: deviceId });
      });
    } catch (e) {
      // بدون نت أو خطأ: التغيير يرجع للقائمة وينرفع بعدين
      Object.entries(ds).forEach(([k, v]) => { stockDelta[k] = (stockDelta[k] || 0) + v; });
      clearTimeout(menuPushT); menuPushT = setTimeout(() => pushMenu(), 30000);
      console.warn('menu stock push', e && e.code);
    }
  }
  async function pushMenuFull() {
    if (!rid()) return;
    const f = fb();
    try {
      const cats = [];
      for (const c of menu) {
        const items = [];
        for (const p of c.items) {
          const it = { ...p }; delete it.img;
          if (p.img && /^data:image\//.test(p.img)) {
            const sig = imgSig(p.img);
            if (!p.imgId || p._sig !== sig) {
              p.imgId = uid('i'); p._sig = sig;
              lsSet(imgKey(p.imgId), p.img);
              f.setDoc(sub('menuImages', p.imgId), { data: p.img, updatedAtMs: Date.now() }).catch(() => {});
            }
            it.imgId = p.imgId;
          } else delete it.imgId;
          delete it._sig;
          items.push(it);
        }
        cats.push({ cat: c.cat, emoji: c.emoji, items });
      }
      menuCloudTs = Date.now();
      saveMenuCore();
      await f.setDoc(sub('menu', 'main'), { cats, updatedAtMs: menuCloudTs, device: deviceId });
      pubSoon();
    } catch (e) { console.warn('menu push', e); }
  }

  async function applyCloudMenu(d) {
    const f = fb();
    const next = (d.cats || []).map((c) => ({ cat: c.cat, emoji: c.emoji, items: (c.items || []).map((p) => ({ ...p })) }));
    // الصور من الذاكرة المحلية أو من السحابة
    const old = {};
    menu.forEach((c) => c.items.forEach((p) => { if (p.imgId && p.img) old[p.imgId] = p.img; }));
    await Promise.all(next.flatMap((c) => c.items.map(async (p) => {
      if (!p.imgId) return;
      let data = old[p.imgId] || lsGet(imgKey(p.imgId), null);
      if (!data) {
        try { const s = await f.getDoc(sub('menuImages', p.imgId)); data = s.exists() ? s.data().data : null; if (data) lsSet(imgKey(p.imgId), data); } catch (e) {}
      }
      if (data && safeImg(data)) { p.img = data; p._sig = imgSig(data); }
    })));
    // نقص مخزون بالكاشير لسه ما انرفع: يبقى محسوب على النسخة الجديدة
    next.forEach((c) => c.items.forEach((p) => { if (typeof p.stock === 'number' && stockDelta[p.name]) p.stock = Math.max(0, p.stock + stockDelta[p.name]); }));
    menu = next;
    if (activeCat >= menu.length) activeCat = 0;
    saveMenu({ local: true });
    renderMenu();
    if ($('menuScreen').classList.contains('on') && $('mt4').classList.contains('on') && can('settings')) renderSettings();
    // منيو جاي من جهاز ثاني أو من برج سرعة (رفع إكسل) ← نحدّث منيو الباركود للزبائن
    pubSoon();
  }

  let menuUnsub = null;
  function onMenuSnap(s) {
    if (s.metadata.hasPendingWrites) return;
    if (!s.exists()) {
      if (s.metadata.fromCache) return;          // غياب بالذاكرة المحلية فقط ليس حكماً نهائياً
      menuCloudExists = false;
      if (hasLocalMenu) pushMenu();              // أول جهاز يرفع منيو المطعم
      renderMenu();
      return;
    }
    menuCloudExists = true;
    const d = s.data();
    if (d.device === deviceId && d.updatedAtMs <= menuCloudTs) return;
    menuCloudTs = Math.max(menuCloudTs, d.updatedAtMs || 0);
    applyCloudMenu(d);
  }
  function listenMenu() {
    const myRid = rid();
    if (menuUnsub) menuUnsub();
    menuUnsub = fb().onSnapshot(sub('menu', 'main'), onMenuSnap, (e) => {
      // خطأ عابر (مثلاً مباشرة بعد الدخول): نعيد الاشتراك بدل أن يبقى المنيو فارغاً
      console.warn('menu listen', e.code);
      setTimeout(() => { if (rid() === myRid && !dutyLocked) listenMenu(); }, 2000);
    });
    unsubs.push(() => { if (menuUnsub) { menuUnsub(); menuUnsub = null; } });
    // ضمان إضافي: إذا بقي المنيو فارغاً نجلبه مباشرة من السحابة
    setTimeout(async () => {
      if (rid() !== myRid || menu.some((c) => c.items.length)) return;
      try { const s = await fb().getDoc(sub('menu', 'main')); if (s.exists()) { menuCloudTs = 0; onMenuSnap(s); } } catch (e) {}
    }, 4000);
  }

  // ══════════ عرض المنيو + البحث ══════════
  // الأساس (كان بـ index.html) — نفس الكود
function renderMenuCore(){
  document.getElementById('cats').innerHTML=menu.map((c,i)=>
    `<button class="cb ${i===activeCat?'on':''}" onclick="selCat(${i})">${esc(c.emoji)} ${esc(c.cat)}</button>`
  ).join('');
  document.getElementById('prods').innerHTML=menu[activeCat].items.map((p,i)=>{const hs=typeof p.stock==='number',out=hs&&p.stock<=0,low=hs&&p.stock>0&&p.stock<=3;return `
    <div class="prod ${out?'soldout':''}" onclick="openVar(${activeCat},${i})">${out?'<div class="pstock out">نفذ</div>':low?`<div class="pstock low">باقي ${toA(p.stock)}</div>`:''}
      <div class="pimg">${safeImg(p.img)?`<img src="${p.img}" alt="">`:`${esc(menu[activeCat].emoji)}`}</div>
      <div class="pinfo"><div class="pname">${esc(p.name)}</div><div class="pprice">${p.variants.length===1?fmt(p.variants[0].price)+' د.ع':'متعدد'}</div></div>
      ${p.variants.length>1?`<div class="pbadge">${p.variants.length}</div>`:''}
    </div>`;}).join('');
}
  window.renderMenu = function () {
    if (!menu.length) menu = [{ cat: 'عام', emoji: '🍽️', items: [] }];
    if (activeCat >= menu.length) activeCat = 0;
    const totalItems = menu.reduce((s, c) => s + c.items.length, 0);
    if (!prodQuery) {
      renderMenuCore();
      if (!totalItems) {
        $('prods').innerHTML = `<div class="prod-empty"><div class="i">🍔</div><b>لا توجد أصناف بعد</b><br><small>المنيو يتضاف ويتعدل من تطبيق الإدارة ← «🍔 المنيو»، ويوصل هنا وحده</small>
          ${isOwnerPOS() ? '<br><button onclick="openAdminPanel(\'menu\')">🍔 فتح تطبيق الإدارة</button>' : ''}</div>`;
      }
      return;
    }
    // نتائج البحث من كل الفروع
    $('cats').innerHTML = `<button class="cb on" onclick="clearProdSearch()">✕ إلغاء البحث</button>`;
    const q = prodQuery.toLowerCase();
    const hits = [];
    menu.forEach((c, ci) => c.items.forEach((p, ii) => { if (String(p.name).toLowerCase().includes(q)) hits.push({ c, p, ci, ii }); }));
    $('prods').innerHTML = hits.length ? hits.map(({ c, p, ci, ii }) => {
      const out = typeof p.stock === 'number' && p.stock <= 0;
      return `<div class="prod ${out ? 'soldout' : ''}" onclick="openVar(${ci},${ii})">
        <div class="pimg">${safeImg(p.img) ? `<img src="${p.img}" alt="">` : esc(c.emoji)}</div>
        <div class="pinfo"><div class="pname">${esc(p.name)}</div><div class="pprice">${p.variants.length === 1 ? money(p.variants[0].price) : 'متعدد'}</div></div></div>`;
    }).join('') : `<div class="prod-empty"><div class="i">🔍</div>لا توجد نتائج لـ «${esc(prodQuery)}»</div>`;
  };
  window.clearProdSearch = () => { prodQuery = ''; $('prodSearch').value = ''; renderMenu(); };
  // تعديل المنيو (الأصناف والأسعار والفروع والصور والمخزون الجاهز) صار من تطبيق الإدارة بس
  const menuMoved = () => toast('🍔 تعديل المنيو صار من تطبيق الإدارة ← «المنيو»');
  ['importSampleMenu', 'saveNItem', 'editItem', 'delItem', 'updImg', 'setItemStock', 'addNewCat', 'renameCat', 'delCat'].forEach((k) => { window[k] = menuMoved; });

  // ══════════ إضافة للسلة: ملاحظات + إضافة سريعة ══════════
  // الأساس (كان بـ index.html) — نفس الكود
const openVarCore = (ci,ii)=>{
  if(typeof menu[ci].items[ii].stock==='number'&&menu[ci].items[ii].stock<=0){toast('⛔ الصنف نفذ من المخزن');return;}
  selProd=menu[ci].items[ii];selVar=null;qty=1;
  document.getElementById('varTitle').textContent=selProd.name;
  document.getElementById('qVal').textContent=toA(qty);
  document.getElementById('varsGrid').innerHTML=selProd.variants.map((v,i)=>`
    <div class="vbtn" onclick="selV(${i})" id="v${i}"><div class="vn">${esc(v.name)}</div><div class="vp">${fmt(v.price)} د.ع</div></div>`).join('');
  selV(0);document.getElementById('varOv').classList.add('on');
};
  window.openVar = (ci, ii) => {
    const p = menu[ci] && menu[ci].items[ii]; if (!p) return;
    if (typeof p.stock === 'number' && p.stock <= 0) { toast('⛔ الصنف نفذ من المخزن'); return; }
    if (settings.quickAdd && p.variants.length === 1) { addLine(p, p.variants[0], 1, ''); return; }
    openVarCore(ci, ii);
    $('varNote').value = '';
    $('varQuick').innerHTML = notesArr(settings.quickNotes).map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('');
  };
  $('varQuick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]'); if (!b) return;
    const inp = $('varNote'); inp.value = inp.value ? inp.value + '، ' + b.dataset.n : b.dataset.n;
  });
  function addLine(p, v, q, note) {
    if (typeof p.stock === 'number') {
      const inCart = cart.filter((c) => c.name === p.name).reduce((s, c) => s + c.qty, 0);
      if (inCart + q > p.stock) { toast('⚠️ المتوفر بالمخزن فقط ' + toA(p.stock)); return false; }
    }
    const ex = cart.find((c) => c.name === p.name && c.variant === v.name && (c.note || '') === note);
    if (ex) ex.qty += q; else cart.push({ name: p.name, variant: v.name, price: v.price, qty: q, note });
    renderCart(); toast('✅ ' + p.name + (q > 1 ? ' ×' + toA(q) : ''));
    return true;
  }
  window.addToCart = () => {
    if (selVar === null || !selProd) return;
    if (addLine(selProd, selProd.variants[selVar], qty, ($('varNote').value || '').trim().slice(0, 80))) closeVar();
  };

  // ══════════ السلة ══════════
  window.renderCart = function () {
    const el = $('cartList');
    el.innerHTML = cart.length ? cart.map((c, i) => `
      <div class="citem">
        <div class="cii"><div class="cin">${esc(c.name)}${c.variant && c.variant !== 'وحدة' ? ' <span class="cis">(' + esc(c.variant) + ')</span>' : ''}</div>
          ${c.note ? `<div class="cnote">📝 ${esc(c.note)}</div>` : ''}
          <div class="cip">${money(c.price * c.qty)}</div></div>
        <div class="cq" onclick="cQ(${i},-1)">−</div><div class="cq" style="border:none;font-weight:900">${toA(c.qty)}</div><div class="cq" onclick="cQ(${i},1)">+</div>
        <div class="cdel" title="ملاحظة" onclick="cNote(${i})">📝</div><div class="cdel" onclick="cDel(${i})">✕</div>
      </div>`).join('') : '<div class="cempty">السلة فارغة<br><small>اضغط على أي صنف لإضافته</small></div>';
    const t = totals(null);
    const rows = [];
    if (t.disc) rows.push(`<div class="trow"><span>المجموع الفرعي</span><b>${money(t.sub)}</b></div>`);
    if (t.disc) rows.push(`<div class="trow disc"><span>خصم${disc.type === 'pct' ? ' ' + toA(disc.value) + '٪' : ''}${disc.reason ? ' — ' + esc(disc.reason) : ''}</span><b>- ${money(t.disc)}</b></div>`);
    if (t.tax) rows.push(`<div class="trow"><span>ضريبة ${toA(settings.taxPct)}٪</span><b>${money(t.tax)}</b></div>`);
    $('cartBreak').innerHTML = rows.join('');
    $('cartTotal').textContent = money(t.total);
    $('cartMini').textContent = cart.length ? money(t.total) : '';
    if (!cart.length) document.querySelector('.cside').classList.remove('open');
    $('cartCnt').textContent = toA(cart.reduce((s, c) => s + c.qty, 0)) + ' عنصر';
    $('sendBtn').disabled = cart.length === 0;
    $('discBtn').classList.toggle('on', !!t.disc);
    $('discBtn').style.display = can('discount') ? '' : 'none';
    renderCurCust();
    renderPagers();
  };
  window.cNote = (i) => {
    const c = cart[i]; if (!c) return;
    acDialog('📝 ملاحظة: ' + c.name, notesArr(settings.quickNotes).join(' • '), [{ id: 'n', label: 'الملاحظة', value: c.note || '' }], (v) => {
      const note = v.n.trim().slice(0, 80);
      const dup = cart.find((x, j) => j !== i && x.name === c.name && x.variant === c.variant && (x.note || '') === note);
      if (dup) { dup.qty += c.qty; cart.splice(i, 1); } else c.note = note;
      renderCart();
    }, '✅ حفظ');
  };
  window.clearCart = async () => {
    if (!cart.length && !disc.value) return;
    if (cart.length && !(await askOk('تفريغ السلة؟'))) return;
    cart = []; disc = { type: 'amt', value: 0, reason: '' }; renderCart();
  };
  window.openDiscount = () => {
    if (!can('discount')) { deny(); return; }
    if (!cart.length) { toast('السلة فارغة'); return; }
    acDialog('٪ خصم على الطلب', 'المجموع ' + money(totals(null).sub), [
      { id: 't', label: 'نوع الخصم', type: 'select', value: disc.type, options: [{ v: 'amt', t: 'مبلغ (د.ع)' }, { v: 'pct', t: 'نسبة ٪' }] },
      { id: 'v', label: 'القيمة (0 = إزالة الخصم)', type: 'number', value: disc.value || '' },
      { id: 'r', label: 'السبب', type: 'select', value: disc.reason, options: ['', 'زبون دائم', 'عرض', 'تعويض عن خطأ', 'موظف', 'أخرى'].map((x) => ({ v: x, t: x || '— بدون —' })) },
    ], (v) => {
      const val = num(v.v);
      if (v.t === 'pct' && val > 100) { toast('⚠️ النسبة لا تتجاوز 100٪'); return false; }
      disc = { type: v.t, value: val, reason: val ? v.r : '' };
      renderCart();
    }, '✅ تطبيق');
  };

  // ══════════ ترحيل الطلب ══════════
  // صلاحيات أنواع الطلب لكل كاشير (من لوحة الإدارة أو برج سرعة) — غير المحدد مسموح
  const ORD_PERM = { salon: 'oSalon', quick: 'oTake', takeaway: 'oHold', delivery: 'oDeliv' };
  const myPerm = (k) => !isCashierRole() || (window.posUser.perms || {})[k] !== false;
  const typeOk = (t) => (t !== 'delivery' || feat('captain')) && myPerm(ORD_PERM[t]);
  window.posPerm = myPerm;
  function syncTypeBtns() {
    let n = 0;
    document.querySelectorAll('#typeOv .otype[data-t]').forEach((b) => { const ok = typeOk(b.dataset.t); b.style.display = ok ? '' : 'none'; if (ok) n++; });
    const z = $('typeNone'); if (z) z.style.display = n ? 'none' : '';
  }
  window.openOrderType = () => {
    if (!cart.length) return;
    syncTypeBtns();
    const t = totals(null);
    $('sumBox').innerHTML = cart.map((c) => `<div>• ${esc(c.name)} (${esc(c.variant)}) ×${c.qty}${c.note ? ' — 📝 ' + esc(c.note) : ''}</div>`).join('') +
      `<div style="font-weight:900;margin-top:4px;">الإجمالي: ${money(t.total)}</div>`;
    $('typeOv').classList.add('on');
  };
  window.pickType = (type) => {
    if (type === 'delivery' && !feat('captain')) { toast('⛔ خدمة الدلفري غير مفعّلة لهذا المطعم'); return; }
    if (!typeOk(type)) { toast('⛔ ما عندك صلاحية لهذا النوع من الطلبات'); return; }
    $('typeOv').classList.remove('on');
    if (type === 'salon') openPay({ kind: 'new', type: 'salon' });
    else if (type === 'quick') openPay({ kind: 'new', type: 'takeaway' });
    else if (type === 'takeaway') openHold();
    else if (type === 'delivery') openDelivModal();
  };
  // الأساس (كان بـ index.html) — نفس الكود
function openDelivModalCore(){
  selCapId=null;changingOrderId=null;
  delivCapMode(false);
  document.getElementById('dName').value='';
  document.getElementById('dPhone').value='';
  document.getElementById('dAddr').value='';
  document.getElementById('dFee').value='5000';
  renderCapList();
  document.getElementById('delivOv').classList.add('on');
}
  window.openDelivModal = function () {
    openDelivModalCore();
    $('dFee').value = settings.defaultFee ?? 5000;
    renderFeePresets();
    $('loyHint').innerHTML = '';
    $('custHint').innerHTML = '';
    if (curCust) {
      $('dPhone').value = curCust.phone;
      if (curCust.data) { $('dName').value = curCust.data.name || ''; $('dAddr').value = curCust.data.address || ''; }
      else if (curCust.label) $('dName').value = curCust.label;
      showCustHint(curCust.data);
    }
    renderLoyalty();
  };
  function renderFeePresets() {
    const el = $('feePresets'); if (!el) return;
    el.innerHTML = (settings.feePresets || []).slice(0, 10).map((f) => { const v = Number(f) || 0; return `<button class="fee-p${v ? '' : ' free'}" onclick="setFee(${v})">${v ? v.toLocaleString('en-US') : 'مجاني'}</button>`; }).join('');
  }

  // عناصر الطلب مع الملاحظات والتكلفة
  window.cartItemsForOrder = function () {
    return cart.map((c) => { const it = { name: c.name, variant: c.variant, price: c.price, qty: c.qty, cost: unitCost(c.name, c.variant) }; if (c.note) it.note = c.note; return it; });
  };

  const bagDay = (ms) => new Date((ms || Date.now()) + 3 * 3600000).toISOString().slice(0, 10);
  function baseOrder(type, t, items) {
    const now = nowT();
    const o = {
      restaurantId: restData.id, restaurantName: restData.name,
      orderType: type, items, notes: items.map((c) => `${c.name}(${c.variant})×${c.qty}${c.note ? ' [' + c.note + ']' : ''}`).join(', ').slice(0, 4900),
      subtotal: t.sub, discount: t.disc, service: t.service, tax: t.tax, value: t.total,
      inv: true, kitchen: 'new', createdAt: now, createdAtMs: Date.now(), shiftId: shift ? shift.id : null, device: deviceId,
      day: bagDay(),             // يوم الطلب بتوقيت بغداد (لشاشة «طلبك جاهز» بدون فهارس إضافية)
    };
    if (t.disc) { o.discountInfo = { type: disc.type, value: disc.value, reason: disc.reason || '' }; if (disc.loyalty) o.discountInfo.loyalty = true; }
    // طلب من المنيو الأونلاين أو الويتر
    if (webAttach) {
      o.webId = webAttach.id; o.source = webAttach.source === 'waiter' ? 'waiter' : 'qr';
      if (webAttach.waiter) o.waiter = String(webAttach.waiter).slice(0, 60);
      if (webAttach.note) o.note = String(webAttach.note).slice(0, 500);
    }
    applySections(o);
    return o;
  }

  // استبدال finalOrder: يحفظ فوراً (يعمل بدون إنترنت) ويطبع فاتورة كاملة
  window.finalOrder = async function (type, captain, custInfo, pay) {
    if (!restData || !cart.length) return;
    // خصم الزبون الدائم: للدلفري فقط، ولنفس الزبون، وما دام مفعّل من الإدارة
    if (disc.loyalty && (type !== 'delivery' || !loyaltyOn() || disc.loyalty.phone !== phoneKey(custInfo && custInfo.phone))) {
      disc = { type: 'amt', value: 0, reason: '' };
      if (type === 'delivery') toast('⚠️ أُزيل خصم الزبون الدائم (الخدمة موقوفة أو الرقم تغيّر)');
    }
    // السلة لحظة الضغط: إذا انتظرنا رقم الطلب، الأصناف اللي تنضاف بعدها تبقى للطلب الجاي
    const sold = cart.slice(), t = totals(type), items = cartItemsForOrder(), now = nowT(), discUsed = disc;
    await ensureTicket();
    const f = fb(), ref = f.doc(f.collection(f.db, 'orders'));
    const o = baseOrder(type, t, items);
    // دلفري «بعد التجهيز» (طلب أونلاين): يروح للمطبخ أول، والكاشير يحوّله لكابتن لما يجهز — الكباتن ما يشوفونه قبل
    const later = type === 'delivery' && captain && captain.later;
    let tableWait = false;
    if (type === 'delivery') {
      Object.assign(o, {
        status: later ? 'preparing' : 'pending', customer: custInfo.name, phone: custInfo.phone, address: custInfo.addr,
        fee: custInfo.fee ?? settings.defaultFee ?? 0, captainId: later ? null : captain.id, captainName: later ? '' : captain.name,
        commission: Math.round(t.total * .1), deliveryProof: null, rejectedBy: [], payment: { method: 'cod' },
        capSettled: false,           // الكابتن يستلم المبلغ من الزبون ويسدده للكاشير (تبويب «تسديد طلبات الكابتن»)
      });
      if (later) o.awaitCap = true;
      if (discUsed.loyalty && t.disc) o.loyalty = { n: discUsed.loyalty.n, amount: t.disc };
    } else {
      const tbl = pay && pay.table ? Number(pay.table) : 0;
      const salonNum = type === 'salon' ? (tbl || o.ticketNo) : null;      // نفس رقم الطلب بكل الشاشات
      // طلب طاولة من الويتر أو QR (بعد موافقة الكاشير): يبقى «قيد التحضير» بالكاشير لحد ما يستلم المبلغ
      tableWait = !!o.webId && type === 'salon' && !!(pay && pay.payment && pay.payment.method === 'later');
      if (tableWait) Object.assign(o, { status: 'preparing', held: true, payment: pay.payment });
      else Object.assign(o, { status: 'delivered', deliveredAt: Date.now(), payment: pay ? pay.payment : { method: 'cash', cash: t.total, card: 0 } });
      if (type === 'salon') { o.salonNum = salonNum; o.customer = tbl ? 'طاولة ' + tbl : 'صالة #' + salonNum; if (tbl) o.tableNo = tbl; }
      else o.customer = 'سفري';
    }
    if (type !== 'delivery' && pagerSel && feat('pager')) { o.pager = pagerSel; pagerSel = 0; }
    o.timeline = [{ status: o.status, time: now, text: later ? 'تم إنشاء الطلب — يتجهز بالمطبخ وبعدين يتحول لكابتن' : tableWait ? 'تم إنشاء الطلب — قيد التحضير، يتحاسب بالكاشير' : 'تم إنشاء الطلب' }];
    f.setDoc(ref, o).then(() => { if (type === 'delivery' && !later) notifyCaptain(ref.id); }).catch((e) => toast('❌ تعذّر حفظ الطلب: ' + (e.code || e.message)));
    if (o.webId) webLink(o, ref.id);
    if (type === 'delivery') { syncTracking(ref.id, { ...o, captainName: '' }); saveCustomer(o); }
    curCust = null;
    applySaleToStock(sold.map((c) => ({ name: c.name, variant: c.variant, qty: c.qty })), ref.id);
    if (o.webId && type === 'salon') webKitchenPrint({ id: ref.id, ...o }, items, t.total);
    else printOrderAll({ id: ref.id, ...o }, receiptHTML({ id: ref.id, ...o }, captain, pay, settings.printKitchen && !o.kSec));
    const names = { salon: '🪑 ' + o.customer, takeaway: '🛍️ سفري فوري', delivery: later ? '🏍️ دلفري قيد التحضير — لما يجهز حوّله للكابتن' : '🏍️ دلفري — ' + (captain ? captain.name : '') };
    toast('✅ تم — ' + names[type] + (o.pager ? ' • 📟 بيجر ' + toA(o.pager) : '') + (pay && pay.payment.change ? ' • الباقي ' + money(pay.payment.change) : ''));
    cart = cart.filter((c) => !sold.includes(c)); if (disc === discUsed) disc = { type: 'amt', value: 0, reason: '' }; renderCart();
    lastSaved = { id: ref.id, ...o };
    return ref.id;
  };

  // سفري قيد التحضير: نفس الحفظ لكن بدون دفع (يُدفع عند التسليم)
  window.holdOrder = async function (info) {
    if (!restData || !cart.length) return;
    const sold = cart.slice(), t = totals('takeaway'), items = cartItemsForOrder(), now = nowT();
    await ensureTicket();
    const f = fb(), ref = f.doc(f.collection(f.db, 'orders'));
    const o = baseOrder('takeaway', t, items);
    const num_ = o.ticketNo;          // نفس رقم الطلب اللي يطلع بشاشة المجهز و«طلبك جاهز» (مو عدّاد خاص بالجهاز)
    Object.assign(o, { held: true, holdNum: num_, customer: info.name || ('سفري #' + num_), phone: info.phone || '', note: info.note || '',
      status: 'preparing', timeline: [{ status: 'preparing', time: now, text: 'تم إنشاء الطلب — قيد التحضير' }] });
    if (pagerSel && feat('pager')) { o.pager = pagerSel; pagerSel = 0; }
    f.setDoc(ref, o).catch((e) => toast('❌ تعذر حفظ الطلب: ' + (e.code || e.message)));
    if (o.webId) webLink(o, ref.id);
    if (info.phone) saveCustomer({ ...o, customer: info.name || '' });
    curCust = null;
    applySaleToStock(sold.map((c) => ({ name: c.name, variant: c.variant, qty: c.qty })), ref.id);
    if (o.kSec) printOrderAll({ id: ref.id, ...o }, null);
    else printSlip('🍳 تذكرة مطبخ #' + num_, { customer: o.customer, phone: o.phone }, items.map((i) => ({ ...i, name: i.name + (i.note ? ' [' + i.note + ']' : '') })), t.total, 'المجموع', o.note);
    toast('🍳 حُفظ الطلب #' + num_ + ' — قيد التحضير' + (o.pager ? ' • 📟 بيجر ' + toA(o.pager) : ''));
    cart = cart.filter((c) => !sold.includes(c)); disc = { type: 'amt', value: 0, reason: '' }; renderCart();
  };

  // التسليم للزبون: يطلب الدفع إن لم يُدفع
  window.ordHandover = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    if (o.payment && o.payment.method !== 'later') {
      await orderUpdate(id, { status: 'delivered', deliveredAt: Date.now(), servedAtMs: Date.now(), kitchen: 'ready', ...(o.pager ? { pagerDone: true } : {}) }, 'سُلّم للزبون', 'delivered');
      printOrderReceipt(o, 'takeaway', null); toast('🤝 تم التسليم للزبون'); return;
    }
    openPay({ kind: 'collect', order: o, handover: true });
  };
  window.ordCollect = (id) => { const o = orders.find((x) => x.id === id); if (o) openPay({ kind: 'collect', order: o }); };
  // دلفري والزبون إجا استلمه بنفسه: يتحول لسفري، يتحرر الكابتن، تنلغي الأجرة — ويتحاسب هسه (حتى ينحسب بالدرج)
  window.ordSelfPickup = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    if (!(await askOk('الزبون استلم الطلب بنفسه؟\nيتحول من دلفري إلى سفري، يتحرر الكابتن، تنلغي أجور التوصيل، وتستلم المبلغ هسه.'))) return;
    const convert = { orderType: 'takeaway', fee: 0, prevFee: o.fee || 0, commission: 0, captainId: null, captainName: '', awaitCap: false, capSettled: null,
      releasedCaptain: { id: o.captainId || null, name: o.captainName || '' } };
    openPay({ kind: 'collect', order: { ...o, orderType: 'takeaway' }, handover: true, convert });
  };
  // «🤝 تم التسليم» للطلب المدفوع (سفري/صالة): الزبون استلم ← ينشال فوراً من شاشة «طلبك جاهز» ويتحرر البيجر
  window.ordServed = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    if (o.held && o.status !== 'delivered') { ordHandover(id); return; }   // سفري ما انطلب حسابه: يتحاسب أول
    const f = { servedAtMs: Date.now(), kitchen: 'ready' };
    if (!o.kitchenReadyAt) f.kitchenReadyAt = Date.now();
    if (o.pager) f.pagerDone = true;
    try { await fb().updateDoc(fb().doc(fb().db, 'orders', id), f); toast('🤝 تم التسليم — انشال من شاشة «طلبك جاهز»'); }
    catch (e) { toast('❌ تعذّر التحديث'); }
  };
  // طلب ينتظر الزبون (مدفوع وما تسلّم): يطلع على شاشة «طلبك جاهز» لحد «تم التسليم»
  window.ordWaiting = (o) => !!o && o.orderType !== 'delivery' && o.status !== 'cancelled' && !!o.kitchen && !o.servedAtMs && !o.pagerDone
    && !(o.held && o.status === 'delivered') && Date.now() - (o.createdAtMs || 0) < 12 * 3600000;

  // زر «تحصيل» للطلبات المؤجلة الدفع
  // الأساس (كان بـ index.html) — نفس الكود
function orderActionsCore(o){
  const t=getOrderType(o),s=o.status,b=[];
  if(s==='cancelled')return '';
  if(t==='takeaway'){
    if(s==='preparing')b.push(['✅ جاهز','ordReady']);
    if(s==='preparing'||s==='ready')b.push(['🤝 تسليم للزبون','ordHandover']);
  }
  // مدفوع وينتظر الزبون (يطلع على شاشة «طلبك جاهز»): «تم التسليم» يشيله من الشاشة
  if(window.ordWaiting&&ordWaiting(o)&&s==='delivered'&&(!window.posFeat||posFeat('screen')))b.push(['🤝 تم التسليم','ordServed']);
  // دلفري أونلاين ينتظر التجهيز: الكاشير يختار الكابتن (والأفضل لما يجهز من المطبخ)
  const waitCap=t==='delivery'&&o.awaitCap&&['preparing','ready'].includes(s);
  if(waitCap)b.push(['🛵 اختيار كابتن','openChangeCapForOrder']);
  if(t==='delivery'&&['pending','accepted'].includes(s))b.push(['🔄 تغيير الكابتن','openChangeCapForOrder']);
  if(t==='delivery'&&(waitCap||['pending','accepted','pickup'].includes(s)))b.push(['🥡 استلمه بنفسه','ordSelfPickup']);
  if(EDITABLE.includes(s))b.push(['✏️ تعديل / إضافة','ordEdit']);
  b.push([s==='delivered'?'↩️ إلغاء / مردود':'❌ إلغاء','ordCancel']);
  return `<div class="ac-btns">${b.map(([l,fn])=>`<button class="ac-b ${fn==='ordCancel'?'del':''}" onclick="${fn}('${esc(o.id)}')">${l}</button>`).join('')}</div>`;
}
  window.orderActions = function (o) {
    let h = orderActionsCore(o);
    if (h && !can('cancel')) h = h.replace(/<button class="ac-b del"[^>]*ordCancel[^<]*<\/button>/, '');
    if (h && o.payment && o.payment.method === 'later' && o.status !== 'cancelled') {
      h = h.replace('<div class="ac-btns">', `<div class="ac-btns"><button class="ac-b" style="border-color:#d97706;color:#b45309" onclick="ordCollect('${esc(o.id)}')">💵 تحصيل ${money(o.value)}</button>`);
    }
    return h;
  };

  // ══════════ نافذة الدفع ══════════
  let payCtx = null;
  function openPay(ctx) {
    const type = ctx.kind === 'new' ? ctx.type : (ctx.order.orderType || 'takeaway');
    const t = ctx.kind === 'new' ? totals(type) : { sub: ctx.order.value, disc: 0, service: 0, tax: 0, total: ctx.order.value || 0 };
    const op = ctx.order && ctx.order.phone ? ctx.order : null;
    payCtx = { ...ctx, typeName: type, due: t.total, method: 'cash', received: '', card: '', table: '', crName: op ? op.customer || '' : '', crPhone: op ? op.phone : '' };
    $('payTitle').textContent = ctx.kind === 'new' ? (type === 'salon' ? '🪑 دفع — صالة' : '🛍️ دفع — سفري فوري') : '💵 تحصيل الطلب #' + kNum(ctx.order);
    $('payDue').textContent = money(t.total);
    const br = [];
    if (t.disc) br.push(`<div><span>المجموع</span><span>${money(t.sub)}</span></div><div><span>الخصم</span><span>- ${money(t.disc)}</span></div>`);
    if (t.service) br.push(`<div><span>خدمة ${toA(settings.servicePct)}٪</span><span>${money(t.service)}</span></div>`);
    if (t.tax) br.push(`<div><span>ضريبة ${toA(settings.taxPct)}٪</span><span>${money(t.tax)}</span></div>`);
    $('payBreak').innerHTML = br.join('');
    $('payTable').innerHTML = ctx.kind === 'new' && type === 'salon' && settings.tables > 0
      ? `<select class="dinp" id="payTableSel"><option value="">🪑 بدون طاولة (رقم تلقائي)</option>${Array.from({ length: settings.tables }, (_, i) => `<option value="${i + 1}">طاولة ${toA(i + 1)}</option>`).join('')}</select>` : '';
    const methods = [['cash', '💵', 'نقداً'], ['card', '💳', 'بطاقة'], ['mixed', '🔀', 'مختلط']];
    if (ctx.kind === 'new' && type === 'salon') methods.push(['later', '⏳', 'لاحقاً']);
    methods.push(['credit', '🧾', 'دين']);
    $('payMethods').style.gridTemplateColumns = `repeat(${methods.length},1fr)`;
    $('payMethods').innerHTML = methods.map(([k, i, l]) => `<button type="button" data-m="${k}" class="${k === 'cash' ? 'on' : ''}"><span class="i">${i}</span>${l}</button>`).join('');
    renderPayBody();
    $('payOv').classList.add('on');
    setTimeout(() => { const r = $('payRecv'); if (r) r.focus(); }, 80);
  }
  window.payClose = () => { $('payOv').classList.remove('on'); payCtx = null; };
  $('payMethods').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]'); if (!b || !payCtx) return;
    payCtx.method = b.dataset.m;
    [...$('payMethods').children].forEach((x) => x.classList.toggle('on', x === b));
    renderPayBody();
  });
  function quickAmounts(due) {
    const out = new Set([due]);
    [1000, 5000, 10000, 25000, 50000].forEach((st) => { const v = Math.ceil(due / st) * st; if (v > due) out.add(v); });
    return [...out].sort((a, b) => a - b).slice(0, 5);
  }
  function renderPayBody() {
    const c = payCtx, el = $('payBody');
    if (c.method === 'card') { el.innerHTML = `<div class="pay-change ok"><span>💳 يُخصم من البطاقة</span><b>${money(c.due)}</b></div>`; return; }
    if (c.method === 'later') { el.innerHTML = `<div class="pay-change"><span>⏳ يُحصَّل لاحقاً من تبويب الطلبات</span><b>${money(c.due)}</b></div>`; return; }
    if (c.method === 'credit') {
      if (window.ledInit) ledInit();
      el.innerHTML = `<div class="dfield"><div class="dlbl">👤 اسم الزبون *</div><input class="dinp" id="payCrName" list="payCrList" maxlength="80" autocomplete="off" value="${esc(c.crName)}"></div>
        <div class="dfield"><div class="dlbl">📞 رقم الهاتف</div><input class="dinp" id="payCrPhone" inputmode="tel" maxlength="20" value="${esc(c.crPhone)}"></div>
        <datalist id="payCrList"></datalist><div class="pay-change" id="payCrBal"></div>`;
      $('payCrName').addEventListener('input', (e) => {
        c.crName = e.target.value;
        // اسم زبون عليه دين سابق: نكمّل رقمه حتى ينضاف على نفس الحساب
        const a = crAccounts().filter((x) => x.name === c.crName.trim()).sort((x, y) => y.last - x.last)[0];
        if (a && a.phone && !c.crPhone) { c.crPhone = a.phone; $('payCrPhone').value = a.phone; }
        payCredBal();
      });
      $('payCrPhone').addEventListener('input', (e) => { c.crPhone = e.target.value; payCredBal(); });
      window.payCredRefresh();
      return;
    }
    const cardPart = c.method === 'mixed' ? `<div class="dfield"><div class="dlbl">💳 مبلغ البطاقة</div><input class="dinp" id="payCard" inputmode="numeric" value="${esc(c.card)}"></div>` : '';
    el.innerHTML = `${cardPart}<div class="dfield"><div class="dlbl">💵 المبلغ المستلم نقداً</div><input class="dinp big-inp" id="payRecv" inputmode="numeric" placeholder="${fmt(cashDue())}" value="${esc(c.received)}"></div>
      <div class="pay-quick">${quickAmounts(cashDue()).map((v) => `<button type="button" data-v="${v}">${fmt(v)}</button>`).join('')}</div>
      <div class="pay-change" id="payChange"></div>`;
    el.querySelector('.pay-quick').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; c.received = b.dataset.v; $('payRecv').value = b.dataset.v; updChange(); });
    $('payRecv').addEventListener('input', (e) => { c.received = e.target.value; updChange(); });
    const pc = $('payCard'); if (pc) pc.addEventListener('input', (e) => { c.card = e.target.value; updChange(); el.querySelector('.pay-quick').innerHTML = quickAmounts(cashDue()).map((v) => `<button type="button" data-v="${v}">${fmt(v)}</button>`).join(''); });
    updChange();
  }
  const crAccounts = () => (window.custAccounts ? custAccounts() : []);
  function payCredBal() {
    const c = payCtx, el = $('payCrBal'); if (!c || !el) return;
    const a = c.crName.trim() ? crAccounts().find((x) => x.key === custKey(c.crName, c.crPhone)) : null;
    el.innerHTML = `<span>🧾 دين على الزبون${a && a.bal ? ' • رصيده السابق ' + money(a.bal) : ''}</span><b>${money(c.due)}</b>`;
  }
  // تنعاد لما يوصل دفتر الزبائن (ledger) — قائمة المدينين للاختيار السريع
  window.payCredRefresh = () => {
    const c = payCtx, dl = $('payCrList'); if (!c || c.method !== 'credit' || !dl) return;
    dl.innerHTML = crAccounts().sort((a, b) => b.last - a.last).slice(0, 300)
      .map((a) => `<option value="${esc(a.name)}">${esc((a.phone ? a.phone + ' • ' : '') + 'رصيده ' + fmt(Math.round(a.bal)))}</option>`).join('');
    payCredBal();
  };
  function cashDue() { const c = payCtx; return Math.max(0, c.due - (c.method === 'mixed' ? Math.min(num(c.card), c.due) : 0)); }
  function updChange() {
    const el = $('payChange'); if (!el) return;
    const due = cashDue(), recv = payCtx.received === '' ? due : num(payCtx.received), ch = recv - due;
    el.className = 'pay-change ' + (ch >= 0 ? 'ok' : 'bad');
    el.innerHTML = ch >= 0 ? `<span>الباقي للزبون</span><b>${money(ch)}</b>` : `<span>ناقص</span><b>${money(-ch)}</b>`;
  }
  function buildPayment() {
    const c = payCtx;
    if (c.method === 'card') return { method: 'card', cash: 0, card: c.due, received: c.due, change: 0 };
    if (c.method === 'later') return { method: 'later', cash: 0, card: 0, received: 0, change: 0 };
    if (c.method === 'credit') {
      const name = String(c.crName || '').trim().replace(/\s+/g, ' ').slice(0, 80), phone = String(c.crPhone || '').trim().slice(0, 20);
      if (!name) return null;
      return { method: 'credit', cash: 0, card: 0, received: 0, change: 0, cust: { key: custKey(name, phone), name, phone } };
    }
    const card = c.method === 'mixed' ? Math.min(num(c.card), c.due) : 0;
    const due = c.due - card, recv = c.received === '' ? due : num(c.received);
    if (recv < due) return null;
    return { method: c.method, cash: due, card, received: recv, change: recv - due };
  }
  $('payOk').addEventListener('click', confirmPay);
  async function confirmPay() {
    const c = payCtx; if (!c) return;
    const payment = buildPayment();
    if (!payment) { toast(c.method === 'credit' ? '⚠️ اكتب اسم الزبون (ورقمه أحسن) حتى ينسجل الدين على حسابه' : '⚠️ المبلغ المستلم أقل من المطلوب'); return; }
    payment.atMs = Date.now(); payment.shiftId = shift ? shift.id : null;
    const table = $('payTableSel') ? $('payTableSel').value : '';
    payClose();
    if (c.kind === 'new') {
      const id = await finalOrder(c.typeName, null, null, { payment, table });
      if (id && payment.method === 'credit' && window.creditCharge) creditCharge(id, payment, lastSaved && lastSaved.id === id ? lastSaved.value : c.due, 'طلب #' + kNum(lastSaved && lastSaved.id === id ? lastSaved : { id }));
      return;
    }
    const o = c.order;
    try {
      const fields = { payment };
      let text = 'تم تحصيل ' + money(o.value);
      if (c.handover) { Object.assign(fields, { status: 'delivered', deliveredAt: Date.now(), servedAtMs: Date.now(), kitchen: 'ready', ...(o.pager ? { pagerDone: true } : {}) }); text = 'سُلّم للزبون — ' + text; }
      if (c.convert) { Object.assign(fields, c.convert); text = 'الزبون استلم الطلب بنفسه (تحوّل من دلفري إلى سفري) — ' + text; }
      await orderUpdate(o.id, fields, text, c.handover ? 'delivered' : o.status);
      if (payment.method === 'credit' && window.creditCharge) creditCharge(o.id, payment, o.value || 0, 'طلب #' + kNum(o));
      if (c.convert) syncTracking(o.id, { status: 'delivered', value: o.value, fee: 0, captainId: '', captainName: '' });
      printHTML(receiptHTML({ ...o, ...fields }, null, { payment }, false));
      toast(c.handover ? '🤝 تم التسليم والتحصيل' : '💵 تم التحصيل' + (payment.change ? ' • الباقي ' + money(payment.change) : ''));
    } catch (e) { toast('❌ تعذّر الحفظ'); }
  }

  // ══════════ الفاتورة ══════════
  const PAY_AR = { cash: 'نقداً', card: 'بطاقة', mixed: 'مختلط', later: 'آجل — لم يُدفع', cod: 'عند الاستلام (الكابتن)', credit: 'دين — على حساب الزبون' };
  function receiptHTML(o, captain, pay, withKitchen) {
    const items = orderItemsFull(o).map((i, k) => ({ ...i, note: (o.items && o.items[k] && o.items[k].note) || i.note }));
    const title = settings.receiptTitle || restData.name || 'سرعة';
    const subL = settings.receiptSub || restData.area || '';
    const phone = settings.receiptPhone || restData.phone || '';
    const d = new Date(o.createdAtMs || Date.now());
    const type = o.orderType || 'delivery';
    // رقم الطلب الكبير = نفس الرقم بشاشة المجهز وشاشة «طلبك جاهز»
    const big = `<div class="num">#${esc(kNum(o))}</div>`;
    const head = type === 'salon' ? `${big}<div class="type">🪑 صالة${o.tableNo ? ' — طاولة ' + esc(o.tableNo) : ''}</div>`
      : type === 'takeaway' ? `${big}<div class="type">🥡 سفري</div>`
      : `${big}<div class="type">🏍️ دلفري${(o.captainName || (captain && captain.name)) ? ' — ' + esc(o.captainName || captain.name) : ''}</div>`;
    const pg = o.pager ? `<div class="type" style="font-size:18px">📟 بيجر رقم ${esc(o.pager)}</div>` : '';
    const sub_ = o.subtotal != null ? o.subtotal : items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
    const p = (pay && pay.payment) || o.payment || {};
    const W = settings.paper === 58 ? 210 : 300;
    const css = `@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
      *{margin:0;padding:0;}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:10px;width:${W}px;color:#000;}
      .logo{text-align:center;font-size:18px;font-weight:900;}.sub{text-align:center;font-size:11px;color:#333;}
      .div{border-top:1px dashed #000;margin:6px 0;}.num{text-align:center;font-size:28px;font-weight:900;}
      .type{text-align:center;background:#000;color:#fff;padding:3px;font-size:13px;font-weight:700;margin:4px 0;}
      .row{display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;gap:6px;}
      .item{font-size:12px;margin-bottom:4px;}.item .l{display:flex;justify-content:space-between;gap:6px;}.item .n{font-size:10.5px;}
      .total{display:flex;justify-content:space-between;font-size:16px;font-weight:900;margin-top:4px;padding-top:4px;border-top:2px solid #000;}
      .foot{text-align:center;font-size:11px;margin-top:8px;}.kt .item{font-size:16px;font-weight:900;}.pb{page-break-before:always;}`;
    const rcpt = `<div class="logo">${esc(title)}</div>${subL ? `<div class="sub">${esc(subL)}</div>` : ''}${phone ? `<div class="sub">📞 ${esc(phone)}</div>` : ''}
      <div class="div"></div>${head}${pg}<div class="div"></div>
      <div class="row"><span>رقم الطلب</span><span>${esc(String(o.id || '').substring(0, 6).toUpperCase())}</span></div>
      <div class="row"><span>التاريخ</span><span>${esc(d.toLocaleDateString('ar-IQ-u-nu-latn'))} ${esc(t12(o.createdAt))}</span></div>
      ${o.customer && type === 'delivery' ? `<div class="row"><span>الزبون</span><span>${esc(o.customer)}</span></div>` : ''}
      ${o.phone ? `<div class="row"><span>الهاتف</span><span>${esc(o.phone)}</span></div>` : ''}
      ${o.address && type === 'delivery' ? `<div class="row"><span>العنوان</span><span>${esc(o.address)}</span></div>` : ''}
      <div class="div"></div>
      ${items.map((i) => `<div class="item"><div class="l"><span>${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''} ×${i.qty}</span><span>${fmt((i.price || 0) * i.qty)}</span></div>${i.note ? `<div class="n">📝 ${esc(i.note)}</div>` : ''}</div>`).join('')}
      <div class="div"></div>
      ${o.discount ? `<div class="row"><span>المجموع</span><span>${fmt(sub_)}</span></div><div class="row"><span>خصم${o.discountInfo && o.discountInfo.reason ? ' (' + esc(o.discountInfo.reason) + ')' : ''}</span><span>-${fmt(o.discount)}</span></div>` : ''}
      ${o.service ? `<div class="row"><span>خدمة</span><span>${fmt(o.service)}</span></div>` : ''}
      ${o.tax ? `<div class="row"><span>ضريبة</span><span>${fmt(o.tax)}</span></div>` : ''}
      <div class="total"><span>الإجمالي</span><span>${fmt(o.value)} د.ع</span></div>
      ${type === 'delivery' && o.fee ? `<div class="row"><span>أجور التوصيل</span><span>${fmt(o.fee)}</span></div><div class="row" style="font-weight:900;font-size:13px"><span>المطلوب من الزبون</span><span>${fmt((o.value || 0) + (o.fee || 0))} د.ع</span></div>` : ''}
      ${type === 'delivery' && o.fee === 0 ? `<div class="row" style="font-weight:900"><span>🎁 التوصيل مجاني</span><span>0</span></div><div class="row" style="font-weight:900;font-size:13px"><span>المطلوب من الزبون</span><span>${fmt(o.value || 0)} د.ع</span></div>` : ''}
      ${p.method ? `<div class="div"></div><div class="row"><span>طريقة الدفع</span><span>${esc(PAY_AR[p.method] || p.method)}</span></div>` : ''}
      ${p.card && p.method === 'mixed' ? `<div class="row"><span>بطاقة</span><span>${fmt(p.card)}</span></div>` : ''}
      ${p.method === 'credit' && p.cust ? `<div class="row" style="font-weight:900"><span>على حساب</span><span>${esc(p.cust.name)}${p.cust.phone ? ' • ' + esc(p.cust.phone) : ''}</span></div>` : ''}
      ${p.received && (p.method === 'cash' || p.method === 'mixed') ? `<div class="row"><span>المستلم نقداً</span><span>${fmt(p.received)}</span></div><div class="row"><span>الباقي</span><span>${fmt(p.change || 0)}</span></div>` : ''}
      <div class="div"></div><div class="foot">${esc(settings.receiptFooter || 'شكراً لزيارتكم ❤️')}</div>`;
    const kt = withKitchen ? `<div class="pb kt"><div class="logo">🍳 تذكرة مطبخ</div><div class="div"></div>${head}${pg}
      <div class="row"><span>${esc(t12(o.createdAt))}</span><span>${esc(String(o.id || '').substring(0, 6).toUpperCase())}</span></div><div class="div"></div>
      ${items.map((i) => `<div class="item">${i.qty}× ${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${i.note ? `<div class="n">📝 ${esc(i.note)}</div>` : ''}</div>`).join('')}</div>` : '';
    return `<html><head><meta charset="UTF-8"><style>${css}</style></head><body>${rcpt}${kt}</body></html>`;
  }
  window.printOrderReceipt = function (o, type, captain) { printHTML(receiptHTML(o, captain, null, false)); };
  window.reprintOrder = (id) => { const o = orders.find((x) => x.id === id); if (o) printHTML(receiptHTML(o, null, null, false)); };

  // ══════════ الوردية ══════════
  // دلفري انسدد بالمطعم أصلاً (نقد/بطاقة) ← ما يمر على الكابتن. غيره: الكابتن يستلم من الزبون ويسدد للكاشير
  function capPaidHere(o) { return !!(o.payment && o.payment.method && !['cod', 'later'].includes(o.payment.method)); }
  const capOwes = (o) => !capPaidHere(o) && o.capSettled !== true;
  function listenShifts() {
    const f = fb();
    unsubs.push(f.onSnapshot(f.query(subCol('shifts'), f.where('status', '==', 'open')), (s) => {
      // كل كاشير ورديته: بمطعم بيه أكثر من كاشير (دلفري وصالة) بنفس الوقت، كل واحد يفتح ويسكّر درجه بروحه
      //  (نفس الحساب على أكثر من جهاز = نفس الوردية؛ والوردية القديمة بدون حساب تبقى لجهازها)
      const me = (window.posUser && window.posUser.uid) || '';
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => (me && x.uid === me) || (!x.uid && (!x.device || x.device === deviceId)))
        .sort((a, b) => b.openedAtMs - a.openedAtMs);
      shift = list[0] || null;
      if (shift) ensureShiftOrders(shift);
      $('shiftWarn').classList.toggle('on', !shift);
      if ($('shiftScreen').classList.contains('on')) renderShift();
    }, (e) => console.warn('shift', e.code)));
  }
  // آخر ١٠٠ وردية مسكّرة (لإعادة طباعة تقاريرها)
  const KEEP_REPORTS = 100;
  async function loadClosedShifts() {
    const f = fb();
    try {
      const s = f.orderBy && f.limit
        ? await f.getDocs(f.query(subCol('shifts'), f.orderBy('closedAtMs', 'desc'), f.limit(KEEP_REPORTS)))
        : await f.getDocs(f.query(subCol('shifts'), f.where('status', '==', 'closed')));
      closedShifts = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'closed')
        .sort((a, b) => b.closedAtMs - a.closedAtMs).slice(0, KEEP_REPORTS);
    } catch (e) { closedShifts = []; }
  }
  // وردية فتحت قبل الطلبات اللي ينزّلها الجهاز (من بداية أمس — نادر): نجيب طلباتها من السيرفر حتى التقرير يطلع كامل
  const shiftOld = {};
  function ensureShiftOrders(sh) {
    const since = window.posOrdersSince ? window.posOrdersSince() : 0;
    if (!sh || !since || !((sh.openedAtMs || 0) < since)) return Promise.resolve();
    if (shiftOld[sh.id]) return shiftOld[sh.id].p;
    const f = fb(), col = f.collection(f.db, 'orders'), map = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const e = shiftOld[sh.id] = { list: null };
    e.p = Promise.all([
      f.getDocs(f.query(col, f.where('restaurantId', '==', rid()), f.where('shiftId', '==', sh.id))).then(map),
      f.getDocs(f.query(col, f.where('restaurantId', '==', rid()), f.where('payment.shiftId', '==', sh.id))).then(map),
    ]).then(([a, b]) => { e.list = a.concat(b); if ($('shiftScreen').classList.contains('on')) renderShift(); })
      .catch((err) => { delete shiftOld[sh.id]; console.warn('shift orders', err && err.code); });
    return e.p;
  }
  function shiftOrders(sh) {
    const x = sh && shiftOld[sh.id];
    if (!x || !x.list) return orders;
    const m = new Map(x.list.map((o) => [o.id, o]));
    orders.forEach((o) => m.set(o.id, o));
    return [...m.values()];
  }
  function shiftCalc(sh) {
    const all = shiftOrders(sh);
    const mine = all.filter((o) => o.shiftId === sh.id);
    const live = mine.filter((o) => o.status !== 'cancelled'), canc = mine.filter((o) => o.status === 'cancelled');
    const paidHere = all.filter((o) => o.payment && o.payment.shiftId === sh.id);
    const r = { orders: live.length, sales: 0, sub: 0, disc: 0, service: 0, tax: 0, byType: { salon: { n: 0, v: 0 }, takeaway: { n: 0, v: 0 }, delivery: { n: 0, v: 0 } },
      cash: 0, card: 0, later: 0, cod: 0, credit: 0, refunds: 0, cancelled: canc.length, cancelledV: canc.reduce((s, o) => s + (o.value || 0), 0) };
    live.forEach((o) => {
      r.sales += o.value || 0; r.sub += o.subtotal != null ? o.subtotal : (o.value || 0); r.disc += o.discount || 0; r.service += o.service || 0; r.tax += o.tax || 0;
      const t = getOrderType(o); r.byType[t].n++; r.byType[t].v += o.value || 0;
      if (o.payment && o.payment.method === 'later') r.later += o.value || 0;
      if (t === 'delivery' && capOwes(o)) r.cod += o.value || 0;
    });
    paidHere.forEach((o) => {
      if (o.status === 'cancelled') { r.refunds += o.payment.cash || 0; return; }
      r.cash += o.payment.cash || 0; r.card += o.payment.card || 0;
      if (o.payment.method === 'credit') r.credit += o.value || 0;
    });
    const mv = sh.cashMoves || [];
    r.cashIn = mv.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    r.cashOut = mv.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);
    r.capIn = mv.filter((m) => m.type === 'cap').reduce((s, m) => s + m.amount, 0);      // تسديد الكباتن
    // الإيداع والسحب حسب النوع (للتقرير): مصرف، المالك، موردين، تحصيل ديون…
    r.mvCat = {};
    mv.filter((m) => m.type !== 'cap').forEach((m) => { const k = m.type + ':' + (m.cat || 'other'); r.mvCat[k] = (r.mvCat[k] || 0) + m.amount; });
    r.expected = (sh.openingCash || 0) + r.cash - r.refunds + r.cashIn + r.capIn - r.cashOut;
    return r;
  }
  const MOVE_CAT = { 'in:other': '(+) إيداعات', 'in:owner': '(+) من المالك', 'in:customer': '(+) تحصيل ديون زبائن',
    'out:other': '(−) مسحوبات', 'out:bank': '(−) إيداع بالمصرف', 'out:owner': '(−) سحب المالك', 'out:supplier': '(−) تسديد موردين', 'out:purchase': '(−) مشتريات مواد' };
  const MOVE_ICON = { bank: '🏦 ', owner: '👤 ', supplier: '🏭 ', customer: '🧾 ', purchase: '📦 ' };
  // تقرير قديم (قبل التصنيف) ما بيه mvCat ← سطر واحد للإيداعات وواحد للمسحوبات
  const moveLines = (r) => {
    const m = r.mvCat || { 'in:other': r.cashIn || 0, 'out:other': r.cashOut || 0 };
    return Object.keys(MOVE_CAT).filter((k) => m[k]).map((k) => [MOVE_CAT[k], m[k], k.startsWith('out')]);
  };
  function renderShift() {
    const el = $('shiftBody');
    // نحافظ على ما يكتبه الكاشير إذا أُعيد الرسم أثناء الكتابة
    const keep = {}; ['shOpenCash', 'shCashier', 'shDay'].forEach((id) => { const i = $(id); if (i) keep[id] = i.value; });
    const restore = () => Object.entries(keep).forEach(([id, v]) => { const i = $(id); if (i) i.value = v; });
    if (!shift) {
      // النموذج موجود: نحدّث قائمة الورديات السابقة فقط ولا نلمس ما يكتبه الكاشير
      if ($('shOpenCash') && $('shClosedWrap')) { $('shClosedWrap').innerHTML = closedHTML(); return; }
      el.innerHTML = `<div class="sh-card"><div class="sh-title">🧮 فتح وردية جديدة</div>
        <div class="ac-sub" style="margin-bottom:10px">الوردية تجمع مبيعات الكاشير والنقد بالدرج من الفتح للإغلاق، وتطلع لك تقرير نهاية الوردية.</div>
        <div class="dfield"><div class="dlbl">💵 النقد الموجود بالدرج عند الفتح</div><input class="dinp big-inp" id="shOpenCash" inputmode="numeric" placeholder="0"></div>
        <div class="dfield"><div class="dlbl">👤 اسم الكاشير (اختياري)</div><input class="dinp" id="shCashier" maxlength="40" value="${esc(lsGet('pos_cashier_name', ''))}"></div>
        <button class="btn-main" style="width:100%" onclick="shiftOpen()">🔓 فتح الوردية</button>
        <button class="btn-soft" style="width:100%;margin-top:8px" onclick="printDaily()">🧾 طباعة تقرير اليوم</button></div><div id="shClosedWrap">${closedHTML()}</div>`;
      restore();
      return;
    }
    const r = shiftCalc(shift);
    const mins = Math.floor((Date.now() - shift.openedAtMs) / 60000);
    const ln = (a, b, c) => `<div class="sh-line"><span>${a}</span><b class="${c || ''}">${b}</b></div>`;
    el.innerHTML = `<div class="sh-card">
      <div class="sh-title">🧮 الوردية الحالية <span class="sh-status open">● مفتوحة</span></div>
      <div class="ac-sub" style="margin-bottom:10px">منذ ${esc(new Date(shift.openedAtMs).toLocaleString('ar-IQ-u-nu-latn'))} (${toA(Math.floor(mins / 60))} س ${toA(mins % 60)} د)${shift.cashier ? ' • 👤 ' + esc(shift.cashier) : ''}</div>
      <div class="sh-grid">
        <div class="sh-stat"><b>${fmt(r.sales)}</b><span>صافي المبيعات</span></div>
        <div class="sh-stat"><b>${toA(r.orders)}</b><span>طلب</span></div>
        <div class="sh-stat"><b>${fmt(r.expected)}</b><span>النقد المتوقع بالدرج</span></div>
        <div class="sh-stat"><b>${fmt(r.card)}</b><span>مبيعات البطاقة</span></div>
      </div>
      ${ln('💵 رصيد افتتاحي', money(shift.openingCash))}
      ${ln('(+) مبيعات نقدية', money(r.cash), 'pos')}
      ${r.refunds ? ln('(−) مرتجع نقدي (طلبات ملغية)', '- ' + money(r.refunds), 'neg') : ''}
      ${moveLines(r).filter((x) => !x[2]).map((x) => ln(x[0], money(x[1]), 'pos')).join('')}
      ${r.capIn ? ln('(+) تسديد الكباتن', money(r.capIn), 'pos') : ''}
      ${moveLines(r).filter((x) => x[2]).map((x) => ln(x[0], '- ' + money(x[1]), 'neg')).join('')}
      ${ln('= المتوقع بالدرج', money(r.expected))}
      ${r.later ? ln('⏳ غير محصّل (آجل)', money(r.later), 'neg') : ''}
      ${r.credit ? ln('🧾 دين على زبائن', money(r.credit), 'neg') : ''}
      ${r.cod ? ln('🏍️ عند الكباتن (ما مسدد)', money(r.cod)) : ''}
      ${r.disc ? ln('٪ الخصومات', money(r.disc)) : ''}
      <div class="sh-btns">
        <button class="btn-soft" onclick="shiftMove('in')">➕ إيداع نقدي</button>
        <button class="btn-soft" onclick="shiftMove('out')">➖ سحب نقدي</button>
        <button class="btn-soft" onclick="shiftPrint('x')">🖨️ تقرير مؤقت (X)</button>
        <button class="btn-soft" onclick="printDaily()">🧾 تقرير اليوم</button>
        <button class="btn-danger" onclick="shiftClose()">🔒 إغلاق الوردية</button>
      </div></div>` + closedHTML();
  }
  // تقارير يوم سابق (لحد ١٠٠ يوم) + تقارير الورديات المسكّرة (لحد ١٠٠) — الكاشير يشوف ورديّاته بس
  function dayPickHTML() {
    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const t = new Date(), min = new Date(t.getTime() - (KEEP_REPORTS - 1) * 86400000);
    return `<div class="sh-card"><div class="sh-title">🧾 تقرير مبيعات يوم سابق</div>
      <div class="sh-day"><input type="date" class="dinp" id="shDay" value="${ymd(t)}" min="${ymd(min)}" max="${ymd(t)}">
      <button class="btn-soft" onclick="printDayPicked()">🖨️ طباعة</button></div>
      <div class="ac-sub">تكدر تطبع تقرير أي يوم من آخر ${toA(KEEP_REPORTS)} يوم</div></div>`;
  }
  window.printDayPicked = () => {
    const v = ($('shDay') || {}).value; if (!v) return;
    const d = new Date(v + 'T00:00:00').getTime();
    if (isNaN(d) || d > Date.now() || Date.now() - d > KEEP_REPORTS * 86400000) { toast('⚠️ اختار يوم من آخر ' + KEEP_REPORTS + ' يوم'); return; }
    printDaily(d);
  };
  function closedHTML() {
    const me = window.posUser && window.posUser.uid;
    const list = isCashierRole() ? closedShifts.filter((x) => (me && x.uid === me) || x.device === deviceId) : closedShifts;
    if (!list.length) return dayPickHTML();
    const row = (s) => `
      <div class="sh-line"><span>${esc(new Date(s.closedAtMs).toLocaleString('ar-IQ-u-nu-latn'))}${s.cashier ? ' • ' + esc(s.cashier) : ''}<div class="ac-sub">مبيعات ${money(s.report && s.report.sales)} • فرق ${money(s.diff)}</div></span>
      <button class="ac-b" style="flex:0 0 auto" onclick="shiftReprint('${esc(s.id)}')">🖨️</button></div>`;
    return dayPickHTML() + `<div class="sh-card"><div class="sh-title">📜 ${isCashierRole() ? 'تقارير ورديّاتي' : 'تقارير الورديات'} <small>(آخر ${toA(list.length)})</small></div>
      ${list.slice(0, 5).map(row).join('')}
      ${list.length > 5 ? `<details class="sh-more"><summary>عرض الكل (${toA(list.length)})</summary>${list.slice(5).map(row).join('')}</details>` : ''}</div>`;
  }
  window.shiftOpen = async () => {
    const cash = num($('shOpenCash').value), cashier = ($('shCashier').value || '').trim().slice(0, 40);
    lsSet('pos_cashier_name', cashier);
    const f = fb();
    try {
      const ref = f.doc(subCol('shifts'));
      shift = { id: ref.id, status: 'open', openedAtMs: Date.now(), openingCash: cash, cashier, cashMoves: [], device: deviceId, uid: (window.posUser && window.posUser.uid) || '' };
      const { id, ...data } = shift;
      f.setDoc(ref, data).catch((e) => toast('❌ ' + (e.code || e.message)));
      $('shiftWarn').classList.remove('on');
      toast('🔓 تم فتح الوردية'); renderShift();
    } catch (e) { toast('❌ تعذّر فتح الوردية'); }
  };
  // الصندوق اليومي: كل إيداع وسحب بنوعه (إيداع بالمصرف، سحب المالك…) حتى تطلع بالحسابات صح
  const MOVE_OPTS = { in: [{ v: 'other', t: '💵 فكّة / إيداع عادي' }, { v: 'owner', t: '👤 من المالك' }],
    out: [{ v: 'other', t: '➖ سحب عادي' }, { v: 'bank', t: '🏦 إيداع بالمصرف' }, { v: 'owner', t: '👤 سحب المالك' }] };
  function drawerMove(mv) {
    if (!shift) return false;
    shift.cashMoves = [...(shift.cashMoves || []), mv];
    fb().updateDoc(sub('shifts', shift.id), { cashMoves: shift.cashMoves }).catch(() => toast('❌ تعذّر الحفظ'));
    if ($('shiftScreen').classList.contains('on')) renderShift();
    return true;
  }
  window.posDrawerMove = (mv) => drawerMove({ type: mv.type, cat: mv.cat || 'other', amount: Number(mv.amount) || 0, note: String(mv.note || '').slice(0, 80), ts: mv.ts || Date.now(), ...(mv.ref ? { ref: mv.ref } : {}) });
  window.posShiftOpen = () => !!shift;
  window.posShiftId = () => (shift ? shift.id : '');
  window.posPaperW = () => (settings.paper === 58 ? 210 : 300);
  window.shiftMove = (type) => {
    acDialog(type === 'in' ? '➕ إيداع نقدي بالدرج' : '➖ سحب نقدي من الدرج', type === 'in' ? 'مثلاً: فكّة إضافية' : 'للمشتريات وتسديد الموردين استخدم «المخزون ← وارد» أو «الموردين» حتى تنحسب تلقائياً', [
      { id: 'c', label: 'النوع', type: 'select', options: MOVE_OPTS[type], value: 'other' },
      { id: 'a', label: 'المبلغ', type: 'number' }, { id: 'n', label: 'السبب' }], (v) => {
      const amount = num(v.a); if (!(amount > 0)) { toast('⚠️ أدخل المبلغ'); return false; }
      if (!shift) { toast('⚠️ الوردية مسكّرة'); return false; }
      const lbl = (MOVE_OPTS[type].find((x) => x.v === v.c) || {}).t || '';
      drawerMove({ type, cat: v.c || 'other', amount, note: (v.n.trim() || (v.c !== 'other' ? lbl.replace(/^\S+\s/, '') : '')).slice(0, 80), ts: Date.now() });
      renderShift(); toast('✅ تم التسجيل');
    });
  };
  window.shiftClose = async () => {
    await ensureShiftOrders(shift);
    if (!shift) return;
    const r = shiftCalc(shift);
    acDialog('🔒 إغلاق الوردية', 'المتوقع بالدرج: ' + money(r.expected) + ' — عُدّ النقد وأدخل المبلغ الفعلي', [
      { id: 'c', label: '💵 النقد الفعلي بالدرج', type: 'number' }, { id: 'n', label: 'ملاحظة (اختياري)' }], (v) => {
      if (v.c === '') { toast('⚠️ أدخل النقد الفعلي'); return false; }
      const counted = num(v.c), report = shiftCalc(shift);
      const done = { status: 'closed', closedAtMs: Date.now(), countedCash: counted, expectedCash: report.expected, diff: counted - report.expected, note: v.n.trim().slice(0, 120), report };
      const closed = { ...shift, ...done };
      fb().updateDoc(sub('shifts', shift.id), done).catch(() => toast('❌ تعذّر الحفظ'));
      printShift(closed, 'z');
      closedShifts = [closed, ...closedShifts].slice(0, KEEP_REPORTS);
      shift = null; $('shiftWarn').classList.add('on'); renderShift();
      toast(done.diff === 0 ? '✅ أُغلقت الوردية — الدرج مطابق' : (done.diff > 0 ? '⚠️ زيادة ' : '⚠️ عجز ') + money(Math.abs(done.diff)));
    }, '🔒 إغلاق وطباعة التقرير');
  };
  window.shiftPrint = () => { if (shift) printShift({ ...shift, report: shiftCalc(shift) }, 'x'); };
  window.shiftReprint = (id) => { const s = closedShifts.find((x) => x.id === id); if (s) printShift(s, 'z'); };
  // ── التقرير اليومي: وصل بالأرقام فقط (بدون أسماء زبائن) — اليوم الحالي فقط من الكاشير
  function dailyCalc(from, to, list) {
    const os = (list || orders).filter((o) => (o.createdAtMs || 0) >= from && (o.createdAtMs || 0) < to);
    const live = os.filter((o) => o.status !== 'cancelled'), canc = os.filter((o) => o.status === 'cancelled');
    const r = { n: live.length, sales: 0, disc: 0, fees: 0, byType: { salon: { n: 0, v: 0 }, takeaway: { n: 0, v: 0 }, delivery: { n: 0, v: 0 } },
      cash: 0, card: 0, later: 0, cod: 0, credit: 0, cancN: canc.length, cancV: canc.reduce((s, o) => s + (o.value || 0), 0), items: 0 };
    live.forEach((o) => {
      const t = getOrderType(o), v = o.value || 0;
      r.sales += v; r.disc += o.discount || 0; r.byType[t].n++; r.byType[t].v += v;
      (o.items || []).forEach((i) => { r.items += i.qty || 1; });
      if (t === 'delivery' && !capPaidHere(o)) { r.fees += o.fee || 0; if (o.capSettled === true) r.cash += v; else r.cod += v; return; }
      const p = o.payment || {};
      if (p.method === 'later') r.later += v; else if (p.method === 'credit') r.credit += v; else { r.cash += p.cash != null ? p.cash : (p.method === 'card' ? 0 : v); r.card += p.card || 0; }
    });
    r.exp = (typeof allExp === 'function' ? allExp() : []).filter((e) => (e.ts || 0) >= from && (e.ts || 0) < to).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return r;
  }
  function dailyReceipt(r, title, sub) {
    const row = (a, b, bold) => `<div class="row" style="${bold ? 'font-weight:900;font-size:13px' : ''}"><span>${a}</span><span>${b}</span></div>`;
    return `<html><head><meta charset="UTF-8"><style>body{font-family:Tajawal,Arial,sans-serif;direction:rtl;padding:12px;width:${settings.paper === 58 ? 210 : 300}px;color:#000}
      h2{text-align:center;font-size:16px;margin:0 0 4px}.sub{text-align:center;font-size:11px;margin-bottom:6px}.row{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}.div{border-top:1px dashed #000;margin:6px 0}</style></head><body>
      <h2>${esc(title)}</h2><div class="sub">${esc(settings.receiptTitle || restData.name || '')}<br>${sub}</div><div class="div"></div>
      ${row('عدد الطلبات', r.n)}${row('عدد الأصناف المباعة', r.items)}<div class="div"></div>
      ${row('🪑 صالة (' + r.byType.salon.n + ')', fmt(r.byType.salon.v))}${row('🥡 سفري (' + r.byType.takeaway.n + ')', fmt(r.byType.takeaway.v))}${row('🏍️ دلفري (' + r.byType.delivery.n + ')', fmt(r.byType.delivery.v))}
      ${r.fees ? row('أجور التوصيل (للكباتن)', fmt(r.fees)) : ''}<div class="div"></div>
      ${row('💵 نقداً', fmt(r.cash))}${row('💳 بطاقة', fmt(r.card))}${r.later ? row('⏳ آجل غير محصّل', fmt(r.later)) : ''}${r.credit ? row('🧾 دين على زبائن', fmt(r.credit)) : ''}${r.cod ? row('🏍️ عند الكباتن (ما مسدد)', fmt(r.cod)) : ''}
      ${r.disc ? row('٪ الخصومات', '-' + fmt(r.disc)) : ''}${r.cancN ? row('❌ ملغي (' + r.cancN + ')', fmt(r.cancV)) : ''}<div class="div"></div>
      ${row('مجموع المبيعات', fmt(r.sales) + ' د.ع', true)}${r.exp ? row('💸 المصروفات', '-' + fmt(r.exp)) : ''}
      <div class="div"></div><div style="text-align:center;font-size:10px">طُبع ${esc(new Date().toLocaleString('ar-IQ-u-nu-latn'))}${window.posUser && window.posUser.name ? ' • ' + esc(window.posUser.name) : ''}</div></body></html>`;
  }
  // تقرير مبيعات يوم (اليوم، أو يوم سابق — طلباته القديمة تنجاب من السيرفر وقت الطلب)
  window.printDaily = (dayMs) => {
    const d0 = new Date(dayMs || Date.now()); d0.setHours(0, 0, 0, 0);
    const from = d0.getTime(), to = from + 86400000, today = from === new Date().setHours(0, 0, 0, 0);
    const go = (list) => {
      printHTML(dailyReceipt(dailyCalc(from, to, list), '🧾 التقرير اليومي', esc(d0.toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' }))));
      toast('🖨️ طباعة تقرير ' + (today ? 'اليوم' : 'يوم ' + d0.toLocaleDateString('ar-IQ-u-nu-latn')));
    };
    if (!window.posOrdersIn) { go(); return; }
    let done = false;
    const r = window.posOrdersIn(from, to, () => { if (!done) { done = true; go(window.posOrdersIn(from, to).list); } });
    if (!r.loading) { done = true; go(r.list); } else toast('⏳ دا ينجاب طلبات ذاك اليوم…');
  };
  window.dailyCalc = dailyCalc;
  function printShift(sh, kind) {
    const r = sh.report || shiftCalc(sh);
    const row = (a, b, bold) => `<div class="row" style="${bold ? 'font-weight:900;font-size:13px' : ''}"><span>${a}</span><span>${b}</span></div>`;
    printHTML(`<html><head><meta charset="UTF-8"><style>body{font-family:Tajawal,Arial,sans-serif;direction:rtl;padding:12px;width:${settings.paper === 58 ? 210 : 300}px}
      h2{text-align:center;font-size:16px}.sub{text-align:center;font-size:11px;margin-bottom:6px}.row{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}.div{border-top:1px dashed #000;margin:6px 0}</style></head><body>
      <h2>${kind === 'z' ? '🔒 تقرير إغلاق الوردية (Z)' : '🧾 تقرير مؤقت (X)'}</h2>
      <div class="sub">${esc(settings.receiptTitle || restData.name || '')}<br>${esc(new Date(sh.openedAtMs).toLocaleString('ar-IQ-u-nu-latn'))} ← ${esc(new Date(sh.closedAtMs || Date.now()).toLocaleString('ar-IQ-u-nu-latn'))}${sh.cashier ? '<br>👤 ' + esc(sh.cashier) : ''}</div><div class="div"></div>
      ${row('عدد الطلبات', r.orders)}${row('المجموع قبل الخصم', fmt(r.sub))}${r.disc ? row('الخصومات', '-' + fmt(r.disc)) : ''}${r.service ? row('الخدمة', fmt(r.service)) : ''}${r.tax ? row('الضريبة', fmt(r.tax)) : ''}
      ${row('صافي المبيعات', fmt(r.sales), true)}<div class="div"></div>
      ${row('🪑 صالة (' + r.byType.salon.n + ')', fmt(r.byType.salon.v))}${row('🥡 سفري (' + r.byType.takeaway.n + ')', fmt(r.byType.takeaway.v))}${row('🏍️ دلفري (' + r.byType.delivery.n + ')', fmt(r.byType.delivery.v))}
      <div class="div"></div>${row('💵 نقداً', fmt(r.cash))}${row('💳 بطاقة', fmt(r.card))}${r.later ? row('⏳ آجل غير محصّل', fmt(r.later)) : ''}${r.credit ? row('🧾 دين على زبائن', fmt(r.credit)) : ''}${r.cod ? row('🏍️ عند الكباتن (ما مسدد)', fmt(r.cod)) : ''}
      ${r.cancelled ? row('❌ ملغي (' + r.cancelled + ')', fmt(r.cancelledV)) : ''}<div class="div"></div>
      ${row('رصيد افتتاحي', fmt(sh.openingCash || 0))}${row('(+) مبيعات نقدية', fmt(r.cash))}${r.refunds ? row('(−) مرتجع نقدي', '-' + fmt(r.refunds)) : ''}${moveLines(r).filter((x) => !x[2]).map((x) => row(x[0], fmt(x[1]))).join('')}${r.capIn ? row('(+) تسديد الكباتن', fmt(r.capIn)) : ''}${moveLines(r).filter((x) => x[2]).map((x) => row(x[0], '-' + fmt(x[1]))).join('')}
      ${row('= المتوقع بالدرج', fmt(r.expected), true)}
      ${sh.countedCash != null ? row('النقد الفعلي', fmt(sh.countedCash), true) + row(sh.diff >= 0 ? 'زيادة' : 'عجز', fmt(Math.abs(sh.diff)), true) : ''}
      ${(sh.cashMoves || []).length ? '<div class="div"></div>' + sh.cashMoves.map((m) => row((m.type === 'cap' ? '🛵 ' : m.type === 'in' ? '➕ ' : '➖ ') + (MOVE_ICON[m.cat] || '') + esc(m.note || ''), fmt(m.amount))).join('') : ''}
      ${sh.note ? '<div class="div"></div><div style="font-size:11px">📝 ' + esc(sh.note) + '</div>' : ''}
      </body></html>`);
  }

  // ══════════ شاشة المطبخ ══════════
  let kdsSec = lsGet('pos_kds_sec', '');
  const kdsList = () => orders.filter((o) => o.kitchen === 'new' && o.status !== 'cancelled' && (Date.now() - (o.createdAtMs || 0)) < 86400000
      && (!kdsSec || (o.kSec && o.kSec[kdsSec] && !o.kSec[kdsSec].readyAt)))
    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  function kdsBeep() {
    if (!kdsSound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .22].forEach((d) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'triangle'; o.frequency.value = d ? 1320 : 990;
        g.gain.setValueAtTime(.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.35, ctx.currentTime + d + .03); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d + .2); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .22); });
    } catch (e) {}
  }
  function renderKds() {
    const list = kdsList();
    // تنبيه عند وصول طلب جديد للمطبخ
    let fresh = false;
    list.forEach((o) => { if (!kdsSeen.has(o.id)) { kdsSeen.add(o.id); if (kdsReady) fresh = true; } });
    kdsReady = true;
    if (fresh && $('kitchenScreen').classList.contains('on')) kdsBeep();
    ['kdsPillD', 'kdsPillM'].forEach((id) => { const p = $(id); if (p) { p.textContent = list.length; p.classList.toggle('on', list.length > 0); } });
    if (!$('kitchenScreen').classList.contains('on')) return;
    $('kdsSub').textContent = list.length ? toA(list.length) + ' طلب قيد التحضير' : '';
    // الجاهز اللي ينتظر الزبون (هو اللي يطلع بـ«جاهز» على التلفزيون): «تم التسليم» يشيله من الشاشة
    const rdy = orders.filter((o) => ordWaiting(o) && (o.kitchen === 'ready' || o.status === 'ready') && Date.now() - (o.kitchenReadyAt || o.readyAt || Date.now()) < 20 * 60000)
      .sort((a, b) => (a.kitchenReadyAt || a.readyAt || 0) - (b.kitchenReadyAt || b.readyAt || 0));
    const kr = $('kdsReady');
    if (kr) {
      kr.hidden = !rdy.length;
      kr.innerHTML = rdy.length ? `<div class="kr-t">🔔 جاهز — ينتظر الزبون <small>اضغط «تم التسليم» أول ما يستلم، وينشال من الشاشة</small></div>
        <div class="kr-row">${rdy.map((o) => { const t = getOrderType(o);
          return `<button type="button" class="kr-b" onclick="ordServed('${esc(o.id)}')"><b>#${esc(kNum(o))}</b><span>${t === 'salon' ? '🪑 صالة' : '🥡 سفري'}${o.pager ? ' • 📟 ' + toA(o.pager) : ''}</span><em>🤝 تم التسليم</em></button>`; }).join('')}</div>` : '';
    }
    renderKdsFilter();
    $('kdsGrid').innerHTML = list.length ? list.map((o) => {
      const m = Math.floor((Date.now() - (o.createdAtMs || Date.now())) / 60000), t = getOrderType(o);
      const cls = m >= 20 ? 'late' : m >= 10 ? 'warn' : '';
      const label = t === 'salon' ? '🪑 ' + (o.tableNo ? 'طاولة ' + o.tableNo : 'صالة') : t === 'takeaway' ? '🥡 سفري' : '🏍️ دلفري';
      // شرائح الأقسام: الضغط يعلّم القسم جاهزاً، واكتمال كل الأقسام = الطلب جاهز
      const chips = o.kSec ? `<div class="kds-secs">${Object.entries(o.kSec).map(([sid, v]) => { const sc = secById(sid) || { name: sid, emoji: '🍽️' };
        return `<button type="button" class="kds-sec ${v.readyAt ? 'done' : ''}" onclick="kSecDone('${esc(o.id)}','${esc(sid)}')">${v.readyAt ? '✅' : '⏳'} ${esc(sc.emoji || '')} ${esc(sc.name)} <small>${toA(v.n || 0)}</small></button>`; }).join('')}</div>` : '';
      const items = (o.items || []).map((it, k) => ({ ...orderItemsFull(o)[k], note: it.note, sec: it.sec })).filter((i) => !kdsSec || i.sec === kdsSec);
      return `<div class="kds-card ${cls}"><div class="kds-top"><div><div class="kds-num">#${esc(kNum(o))} <span class="kds-lbl">${esc(label)}</span></div><div class="kds-type">${esc(t12(o.createdAt))}${o.pager ? ` • <b class="kds-pager">📟 ${toA(o.pager)}</b>` : ''}</div></div>
        <div class="kds-time">⏱ ${toA(m)} د</div></div>${kdsSec ? '' : chips}
        <div class="kds-items">${items.map((i) => `<div class="kds-it"><span class="q">${toA(i.qty)}×</span><span>${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${!kdsSec && i.sec && secById(i.sec) ? ` <small class="kds-isec">${esc(secById(i.sec).emoji || '')}</small>` : ''}${i.note ? `<span class="n">📝 ${esc(i.note)}</span>` : ''}</span></div>`).join('')}</div>
        ${o.note ? `<div class="kds-note">📝 ${esc(o.note)}</div>` : ''}
        ${kdsSec ? `<button class="kds-done" onclick="kSecDone('${esc(o.id)}','${esc(kdsSec)}')">✅ ${esc((secById(kdsSec) || {}).name || '')} جاهز</button>`
          : `<button class="kds-done" onclick="kdsDone('${esc(o.id)}')">✅ اكتمل الطلب — نادِ الزبون</button>`}</div>`;
    }).join('') : '<div class="kds-empty"><div class="i">👨‍🍳</div><b>لا توجد طلبات قيد التحضير</b><br><small>الطلبات الجديدة تظهر هنا تلقائياً</small></div>';
  }
  window.kdsDone = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    const fields = { kitchen: 'ready', kitchenReadyAt: Date.now() };
    if (o.kSec) fields.kSec = Object.fromEntries(Object.entries(o.kSec).map(([k, v]) => [k, { ...v, readyAt: v.readyAt || Date.now() }]));
    try {
      if (o.status === 'preparing') await orderUpdate(id, { ...fields, status: 'ready', readyAt: Date.now() }, 'الطلب جاهز للاستلام', 'ready');
      else await fb().updateDoc(fb().doc(fb().db, 'orders', id), fields);
      toast('✅ جاهز');
    } catch (e) { toast('❌ تعذّر التحديث'); }
  };
  window.kdsToggleSound = () => { kdsSound = !kdsSound; lsSet('pos_kds_sound', kdsSound); $('kdsSoundBtn').textContent = kdsSound ? '🔔 الصوت: يعمل' : '🔕 الصوت: مطفأ'; if (kdsSound) kdsBeep(); };
  setInterval(() => { if (restData && $('kitchenScreen').classList.contains('on')) renderKds(); }, 30000);

  // تحديث الشاشات عند وصول الطلبات
  // الأساس (كان بـ index.html) — نفس الكود
function renderOrdersCore(){
  const salon=orders.filter(o=>getOrderType(o)==='salon');
  const take=orders.filter(o=>getOrderType(o)==='takeaway');
  const deliv=orders.filter(o=>getOrderType(o)==='delivery');
  const active=orders.filter(o=>['pending','accepted','pickup','delivering','preparing','ready'].includes(o.status));
  const done=orders.filter(o=>o.status==='delivered');
  document.getElementById('sAll').textContent=orders.length;
  document.getElementById('sActive').textContent=active.length;
  document.getElementById('sDone').textContent=done.length;
  document.getElementById('sSalon').textContent=salon.length;
  document.getElementById('sTake').textContent=take.length;
  document.getElementById('sDeliv').textContent=deliv.length;
  renderOrdSum();
  let fil=orders;
  if(currentFilter==='delivery')fil=deliv;
  else if(currentFilter==='salon')fil=salon;
  else if(currentFilter==='takeaway')fil=take;
  else if(currentFilter==='wait')fil=take.filter(o=>['preparing','ready'].includes(o.status));
  else if(currentFilter==='cancelled')fil=orders.filter(o=>o.status==='cancelled');
  const typeBadge=o=>{
    const t=getOrderType(o);
    if(t==='salon')return`<span class="bdg bsal">🪑 صالة</span>`;
    if(t==='takeaway')return`<span class="bdg bsfr">🥡 سفري</span>`;
    return`<span class="bdg bdlv">🏍️ دلفري</span>`;
  };
  const stBadge={pending:'bp',accepted:'ba',pickup:'br',delivering:'br',delivered:'bd',cancelled:'bc',preparing:'ba',ready:'bd'};
  const stLabel={pending:'🟡 ينتظر',accepted:'🔵 مقبول',pickup:'🟠 في المطعم',delivering:'🛵 يتوصل',delivered:'✅ مسلّم',cancelled:'❌ ملغي',preparing:'🍳 قيد التحضير',ready:'✅ جاهز للاستلام'};
  document.getElementById('ordersList').innerHTML=fil.length?fil.map(o=>{
    const items=orderItemsFull(o);
    return `
    <div class="ocard">
      <div class="orow"><span class="oid">${esc(o.id.substring(0,6).toUpperCase())}</span><span class="otime">${esc(t12(o.createdAt))}</span></div>
      <div style="margin-bottom:4px;">${typeBadge(o)}</div>
      ${o.customer?`<div class="oinfo">👤 ${esc(o.customer)}${o.phone?' • 📞 '+esc(o.phone):''}</div>`:''}
      ${o.address?`<div class="oinfo">📍 ${esc(o.address)}</div>`:''}
      ${items.length?`<div class="ac-sub" style="margin:4px 0">${items.map(i=>'• '+esc(i.name)+(i.variant&&i.variant!=='وحدة'?' ('+esc(i.variant)+')':'')+' ×'+toA(i.qty)).join('<br>')}</div>`:''}
      <div class="oinfo">💰 ${fmt(o.value)} د.ع${o.fee?` + ${fmt(o.fee)} توصيل`:''}</div>
      <div class="orow" style="margin-top:5px">
        ${window.ordWaiting&&ordWaiting(o)&&o.status==='delivered'&&o.kitchen==='ready'?'<span class="bdg bd">🔔 جاهز — ينتظر الزبون</span>':`<span class="bdg ${stBadge[o.status]||'bp'}">${stLabel[o.status]||esc(o.status)}</span>`}
        <span style="font-size:11px;color:var(--muted)">${esc(o.captainName||'')}</span>
      </div>
      ${o.status==='cancelled'?`<div class="oinfo" style="color:#e11d48">❌ ${esc(o.cancelReason||'')}${o.cancelNote?' — '+esc(o.cancelNote):''}</div>`:''}
      ${o.modifiedAt&&o.status!=='cancelled'?`<div class="ac-sub">✏️ عُدّل الطلب بعد إنشائه</div>`:''}
      ${orderActions(o)}
    </div>`;}).join(''):'<div style="text-align:center;color:var(--muted);padding:24px">لا توجد طلبات</div>';
}
  window.renderOrders = function () {
    renderOrdersCore();
    renderKds();
    renderPagers();
    syncWebStages();
    renderCapWait();
    // الشاشات المفتوحة تتحدث مباشرة مع كل طلب (بدون ما نلمس خانة يكتب بيها المستخدم)
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if (!typing && $('reportsScreen') && $('reportsScreen').classList.contains('on') && typeof renderRep === 'function') renderRep();
    if (!typing && $('accScreen') && $('accScreen').classList.contains('on') && typeof acCur !== 'undefined' && acCur === 'fin' && !$('acOv').classList.contains('on')) renderAcc();
    if (shift && $('shiftScreen').classList.contains('on')) renderShift();
  };

  // ══════════ الإعدادات (واجهة) ══════════
  // الأساس (كان بـ index.html) — نفس الكود
const showMTabCore = tab=>{
  document.getElementById('mAddSec').style.display=tab==='add'?'block':'none';
  document.getElementById('mListSec').style.display=tab==='list'?'block':'none';
  document.getElementById('mCatsSec').style.display=tab==='cats'?'block':'none';
  ['mt1','mt2','mt3'].forEach((id,i)=>document.getElementById(id)?.classList.toggle('on',['add','list','cats'][i]===tab));
  if(tab==='list')renderMList();
  if(tab==='cats')renderCatsList();
};
  window.showMTab = (tab) => {
    if (tab !== 'settings') { menuMoved(); tab = 'settings'; }
    if (!can('settings')) { deny(); return; }
    ['mAddSec', 'mListSec', 'mCatsSec'].forEach((id) => { $(id).style.display = 'none'; });
    ['mt1', 'mt2', 'mt3'].forEach((id) => $(id).classList.remove('on'));
    $('mt4').classList.add('on');
    $('mSetSec').style.display = 'block';
    try { renderSettings(); }
    catch (e) {
      console.warn('settings', e);
      $('mSetSec').innerHTML = `<div class="sh-card"><div class="sh-title">⚠️ الإعدادات ما انفتحت</div><div class="ac-sub" style="line-height:1.8">صوّر هذي الرسالة ودزها للدعم: <b dir="ltr">${esc(String((e && e.message) || e)).slice(0, 200)}</b></div>
        <button type="button" class="btn-soft" style="width:100%;margin-top:8px" onclick="showMTab('settings')">🔄 إعادة المحاولة</button></div>`;
    }
  };
  // أقسام المطبخ دائماً قائمة (حتى لو انحفظت بيها خانة فارغة أو بشكل ثاني) — نفس الترتيب حتى يبقى الحفظ صحيح
  const secArr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : DEFAULTS.sections).map((x) => (x && typeof x === 'object' ? x : {}));
  const notesArr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,،]/) : []).map((x) => String(x).trim()).filter(Boolean);
  // جزء من الإعدادات إذا خرب ما يخفي الباقي — يطلع سطر يوضح شنو الغلط
  const part = (f) => { try { return f(); } catch (e) { console.warn('settings', e); return `<div class="sh-card"><div class="ac-sub" style="color:#ef4444;line-height:1.8">⚠️ جزء من الإعدادات ما انعرض: ${esc(String((e && e.message) || e)).slice(0, 160)}</div></div>`; } };
  function renderSettings() {
    const s = settings;
    const notifState = !('Notification' in window) ? 'غير مدعوم بهذا المتصفح' : Notification.permission === 'granted' ? '✅ مفعّلة' : Notification.permission === 'denied' ? '🔕 محظورة من المتصفح' : 'غير مفعّلة';
    $('mSetSec').innerHTML = `
      <div class="sh-card"><div class="sh-title">🧾 الفاتورة</div>
        <div class="flbl">اسم المطعم على الفاتورة</div><input class="finp" id="stTitle" maxlength="60" value="${esc(s.receiptTitle)}" placeholder="${esc(restData.name || '')}">
        <div class="flbl">السطر الثاني (العنوان)</div><input class="finp" id="stSub" maxlength="80" value="${esc(s.receiptSub)}" placeholder="${esc(restData.area || '')}">
        <div class="set-row"><div><div class="flbl">رقم الهاتف</div><input class="finp" id="stPhone" maxlength="30" value="${esc(s.receiptPhone)}" placeholder="${esc(restData.phone || '')}"></div>
          <div><div class="flbl">عرض ورق الطابعة</div><select class="fsel" id="stPaper"><option value="80" ${s.paper !== 58 ? 'selected' : ''}>80 ملم</option><option value="58" ${s.paper === 58 ? 'selected' : ''}>58 ملم</option></select></div></div>
        <div class="flbl">نص أسفل الفاتورة</div><input class="finp" id="stFooter" maxlength="120" value="${esc(s.receiptFooter)}">
        <label class="set-check"><input type="checkbox" id="stKitchen" ${s.printKitchen ? 'checked' : ''}> طباعة تذكرة مطبخ مع كل فاتورة</label>
        <label class="set-check"><input type="checkbox" id="stDrawer" ${s.drawer ? 'checked' : ''}> 💵 درج الفلوس ينفتح وحده مع كل فاتورة</label>
        <div class="ac-sub" style="line-height:1.8">إذا عندك درج فلوس موصول بطابعة الفواتير بالكيبل: شغّلها، وكل ما تطبع فاتورة الدرج ينفتح وحده. ما عندك درج؟ خليها مطفية.</div>
      </div>
      <div class="sh-card"><div class="sh-title">👨‍🍳 أقسام المطبخ والطابعات</div>
        <label class="set-check"><input type="checkbox" id="stSecOn" ${s.kSecOn ? 'checked' : ''}> تقسيم الطلب على أقسام المطبخ — كل قسم يطبع أصنافه فقط، ورقم الطلب يوحّدها</label>
        <div class="flbl">الأقسام (اترك الاسم فارغاً لإلغاء القسم)</div>
        ${part(() => secArr(s.sections).map((x, i) => `<div class="set-row sec-row"><div><input class="finp" id="stSecE${i}" maxlength="4" value="${esc(x.emoji || '')}" style="text-align:center"></div><div><input class="finp" id="stSecN${i}" maxlength="20" value="${esc(x.name || '')}" placeholder="اسم القسم"></div></div>`).join(''))}
        <div class="flbl" style="margin-top:10px">كل فئة بالمنيو تابعة لأي قسم؟</div>
        ${part(() => (Array.isArray(menu) ? menu : []).filter((c) => c && c.cat).map((c, i) => `<div class="set-row"><div class="sec-cat">${esc(c.emoji || '')} ${esc(c.cat)}</div><div><select class="fsel" id="stCat${i}" data-cat="${esc(c.cat)}"><option value="">— بدون قسم (لا تُطبع بالمطبخ) —</option>${secArr(s.sections || []).filter((x) => x.name).map((x) => `<option value="${esc(x.id)}" ${(s.catSection || {})[c.cat] === x.id ? 'selected' : ''}>${esc(x.emoji || '')} ${esc(x.name)}</option>`).join('')}</select></div></div>`).join('') || '<div class="ac-sub">أضف فئات للمنيو أولاً</div>')}
        <div id="secHealth" class="sec-health"></div>
        ${part(() => window.SoraDesktop ? dpSettingsHtml(s) : `${appOffer() ? `<div class="dp-promo"><b>${appOffer().label}</b> — ${appOffer().text} <a href="${appOffer().url}">⬇️ تنزيل</a></div>` : ''}
        ${qzCfgGet().on ? '' : `<div class="ac-sub" style="margin-top:10px;line-height:1.8">🖨️ من المتصفح: كل قسم ينطبع بورقة منفصلة على نفس الطابعة. حتى كل قسم يطلع على طابعته، شغّل الكاشير من تطبيق سرعة (ويندوز، ماك، لينكس، أندرويد).</div>`}
        ${!qzCfgGet().on ? '' : `<div class="flbl" style="margin-top:12px">🖨️ الطباعة على هذا الجهاز (QZ Tray — ننصح بتطبيق الكاشير بدله)</div>
        <select class="fsel" id="stQzOn"><option value="0" ${qzCfgGet().on ? '' : 'selected'}>طابعة واحدة — كل قسم تذكرته بورقة منفصلة</option><option value="1" ${qzCfgGet().on ? 'selected' : ''}>طابعة لكل قسم — عبر برنامج QZ Tray</option></select>
        <div id="qzBox" style="display:${qzCfgGet().on ? 'block' : 'none'}">
          <div class="ac-sub" style="margin:8px 0;line-height:1.8">1) نزّل وثبّت <a href="https://qz.io/download/" target="_blank" rel="noopener">QZ Tray</a> على هذه الحاسبة وشغّله. 2) اضغط «جلب الطابعات» واختر طابعة كل قسم. 3) جرّب كل طابعة.</div>
          <button type="button" class="btn-soft" style="width:100%" onclick="qzFind()">🔍 جلب الطابعات من الحاسبة</button>
          ${secArr(s.sections || []).filter((x) => x.name).map((x) => `<div class="set-row" style="margin-top:8px"><div class="sec-cat">${esc(x.emoji || '')} ${esc(x.name)}</div><div style="display:flex;gap:6px"><select class="fsel" id="qzP_${esc(x.id)}" style="flex:1"><option value="">— نفس الطابعة الافتراضية —</option>${(qzCfgGet().printers || {})[x.id] ? `<option selected>${esc(qzCfgGet().printers[x.id])}</option>` : ''}</select><button type="button" class="btn-soft" style="padding:8px 10px" onclick="qzTest('${esc(x.id)}')">🧪</button></div></div>`).join('')}
          <details style="margin-top:10px"><summary class="ac-sub" style="cursor:pointer">⚙️ متقدم: شهادة الطباعة الصامتة (حتى لا يسأل البرنامج كل مرة)</summary>
            <div class="ac-sub" style="margin:6px 0;line-height:1.8">من QZ Tray: Advanced ← Site Manager ← + ← Create New، ثم الصق الشهادة والمفتاح هنا. يُحفظان على هذا الجهاز فقط.</div>
            <textarea class="finp" id="qzCert" rows="3" dir="ltr" placeholder="-----BEGIN CERTIFICATE-----">${esc(qzCfgGet().cert || '')}</textarea>
            <textarea class="finp" id="qzKey" rows="3" dir="ltr" placeholder="-----BEGIN PRIVATE KEY-----" style="margin-top:6px">${esc(qzCfgGet().key || '')}</textarea>
          </details>
        </div>`}`)}
      </div>
      ${part(screenCardHtml)}
      ${part(lanCardHtml)}
      <div class="sh-card"><div class="sh-title">🪑 الطاولات والبيجر</div>
        <div class="set-row"><div><div class="flbl">عدد الطاولات (0 = بدون)</div><input class="finp" id="stTables" type="number" min="0" max="200" value="${s.tables || 0}"></div>
          <div><div class="flbl">📟 عدد أجهزة البيجر (0 = بدون)</div><input class="finp" id="stPagers" type="number" min="0" max="30" value="${s.pagers != null ? s.pagers : 10}"></div></div>
      </div>
      <div class="sh-card"><div class="sh-title">⚡ السرعة</div>
        <label class="set-check"><input type="checkbox" id="stQuick" ${s.quickAdd ? 'checked' : ''}> إضافة سريعة: الصنف ذو السعر الواحد ينضاف بضغطة واحدة</label>
        <div class="flbl">ملاحظات سريعة للمطبخ (مفصولة بفاصلة)</div><input class="finp" id="stNotes" value="${esc(notesArr(s.quickNotes).join('، '))}">
      </div>
      ${part(onlineCardHtml)}
      <button class="sivbtn" onclick="saveSettings()">✅ حفظ الإعدادات</button>
      <div class="sh-card" style="margin-top:10px"><div class="sh-title">🔔 إشعارات المطعم</div>
        <div class="ac-sub" style="margin-bottom:8px">إشعار عند رفض الكابتن لطلب أو عند تسليمه — حتى لو كان التطبيق مغلقاً. الحالة: <b>${notifState}</b></div>
        <button class="btn-soft" style="width:100%" onclick="enableRestPush()">🔔 تفعيل الإشعارات على هذا الجهاز</button></div>
      <div class="sh-card"><div class="sh-title">⌨️ اختصارات لوحة المفاتيح</div>
        <div class="ac-sub" style="line-height:2"><kbd>/</kbd> بحث عن صنف • <kbd>F9</kbd> ترحيل الطلب • <kbd>1</kbd>-<kbd>4</kbd> نوع الطلب • <kbd>Enter</kbd> تأكيد الدفع • <kbd>Esc</kbd> إغلاق</div></div>`;
    try { renderSecHealth(); if (window.SoraDesktop) dpAfterRender(); } catch (e) { console.warn('settings', e); }
  }
  window.saveSettings = async () => {
    const list = (v) => String(v || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v)));
    const next = {
      receiptTitle: $('stTitle').value.trim(), receiptSub: $('stSub').value.trim(), receiptPhone: $('stPhone').value.trim(), receiptFooter: $('stFooter').value.trim(),
      paper: $('stPaper').value === '58' ? 58 : 80, printKitchen: $('stKitchen').checked, drawer: $('stDrawer').checked,
      // ما إلها خانات بالإعدادات بعد: تبقى مثل ما هي (أجرة التوصيل الافتراضية تنحط بالطلب وبالمنيو الأونلاين)
      defaultFee: settings.defaultFee ?? DEFAULTS.defaultFee, feePresets: settings.feePresets || DEFAULTS.feePresets, taxPct: settings.taxPct || 0, servicePct: settings.servicePct || 0,
      tables: Math.round(clamp($('stTables').value, 0, 200)), pagers: Math.round(clamp($('stPagers').value, 0, 30)),
      kSecOn: $('stSecOn').checked,
      sections: secArr(settings.sections).map((x, i) => ({ id: x.id || 'sec' + (i + 1), emoji: (($('stSecE' + i) || {}).value || '').trim().slice(0, 4), name: (($('stSecN' + i) || {}).value || '').trim().slice(0, 20) })),
      catSection: Object.fromEntries([...document.querySelectorAll('[id^="stCat"]')].filter((el) => el.value).map((el) => [el.dataset.cat, el.value])),
      quickAdd: $('stQuick').checked, quickNotes: list($('stNotes').value).slice(0, 10).map((x) => x.slice(0, 30)),
    };
    const onBefore = JSON.stringify(onlineCfg()), online = readOnlineForm();
    if (online) next.online = online;
    next.screen = $('stScrSalon') ? { salon: $('stScrSalon').checked, delivery: $('stScrDel').checked, qr: $('stScrQr').checked } : scrCfg();
    if (online && online.on && !online.viewOnly && !online.table && !online.pickup && !online.delivery) { toast('⚠️ اختار طريقة طلب وحدة على الأقل، أو «عرض المنيو بس»'); return; }
    settings = { ...DEFAULTS, ...next };
    lsSet(setKey(), settings);
    // إعدادات الطابعات خاصة بهذا الجهاز (لا تُرفع للسحابة)
    if (window.SoraDesktop) dpSave();
    const qc = qzCfgGet();
    if ($('stQzOn')) qzCfgSet({ on: $('stQzOn').value === '1',
      printers: Object.fromEntries(secList().map((x) => [x.id, ($('qzP_' + x.id) || {}).value || (qc.printers || {})[x.id] || '']).filter(([, v]) => v)),
      cert: (($('qzCert') || {}).value || '').trim(), key: (($('qzKey') || {}).value || '').trim() });
    try { await fb().setDoc(sub('settings', 'main'), { ...settings, updatedAtMs: Date.now() }); toast('✅ تم حفظ الإعدادات لكل أجهزة المطعم'); }
    catch (e) { toast('⚠️ حُفظت على هذا الجهاز فقط — تحقق من الإنترنت'); }
    publishMenu(onBefore !== JSON.stringify(onlineCfg()));
    renderCart();
  };
  function listenSettings() {
    settings = { ...DEFAULTS, ...lsGet(setKey(), {}) };
    unsubs.push(fb().onSnapshot(sub('settings', 'main'), (s) => {
      if (!s.exists()) return;
      const { updatedAtMs, ...d } = s.data();
      settings = { ...DEFAULTS, ...d };
      // أزرار الأجرة القديمة الافتراضية ← القائمة الجديدة (مجاني لحد 4000)
      if (JSON.stringify(settings.feePresets) === '[3000,5000,7000]') settings.feePresets = DEFAULTS.feePresets;
      lsSet(setKey(), settings);
      renderCart();
      lanSettingsPush();
    }, () => {}));
  }

  // ══════════ إشعارات المطعم (FCM) ══════════
  window.enableRestPush = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('هذا المتصفح لا يدعم الإشعارات'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('🔕 لم يُسمح بالإشعارات — فعّلها من إعدادات المتصفح'); renderSettings(); return; }
    await registerRestPush(true);
    renderSettings();
  };
  async function registerRestPush(loud) {
    try {
      const m = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');
      if (!(await m.isSupported())) { if (loud) toast('هذا المتصفح لا يدعم الإشعارات'); return; }
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const token = await m.getToken(m.getMessaging(fb().app), { serviceWorkerRegistration: reg });
      if (!token) return;
      const f = fb(), uidNow = f.auth.currentUser && f.auth.currentUser.uid; if (!uidNow) return;
      const ref = f.doc(f.db, 'pushTokens', uidNow);
      let tokens = [];
      try { const s = await f.getDoc(ref); tokens = s.exists() ? (s.data().tokens || []) : []; } catch (e) {}
      tokens = [token, ...tokens.filter((t) => t !== token)].slice(0, 5);
      await f.setDoc(ref, { tokens, role: window.posUser && window.posUser.role === 'cashier' ? 'cashier' : 'restaurant', captainId: '', restaurantId: rid(), updatedAtMs: Date.now() });
      if (loud) toast('🔔 تم تفعيل الإشعارات');
    } catch (e) { console.warn('push', e); if (loud) toast('❌ تعذّر تفعيل الإشعارات'); }
  }

  // ══════════ التنقل ══════════
  const TABS = ['cashier', 'orders', 'capPay', 'kitchen', 'shift', 'reports', 'menu', 'acc'];
  const TAB_PERM = { reports: 'reports', acc: 'inventory' };
  const isCashierRole = () => !!(window.posUser && window.posUser.role === 'cashier');
  // التقارير والأرباح والمبيعات الشهرية: للمالك فقط (الكاشير يطبع تقرير اليوم من الوردية)
  const tabAllowed = (t) => t === 'reports' ? !isCashierRole() : t === 'kitchen' ? !featOn('kitchen') : t === 'capPay' ? feat('captain') && myPerm('oDeliv') : t === 'menu' ? can('settings') : (!TAB_PERM[t] || can(TAB_PERM[t]));
  // التحديث التلقائي ينتظر لحد ما الكاشير يكون فاضي: سلة فارغة، لا نافذة مفتوحة، لا مكالمة
  window.auIdle = () => !restData || (!cart.length && !document.querySelector('[id$="Ov"].on, .duty-lock.on, .call-card'));
  window.auSave = () => ({ tab: TABS.find((t) => { const e = $(t + 'Screen'); return e && e.classList.contains('on'); }) || 'cashier' });
  // التقارير والأرباح صارت بلوحة الإدارة بس (بدون تكرار) — الكاشير يبقى بيه تقرير اليوم والوردية
  const ADMIN_URL = /^https?:$/.test(location.protocol) ? new URL('../sora3a-admin/', location.href.split(/[?#]/)[0]).href : 'https://qaesartools-web.github.io/sora3a-admin/';
  window.openAdminPanel = (what) => {
    toast(what === 'menu' ? '🍔 المنيو يتعدل من لوحة الإدارة — ادخل بنفس حسابك' : '📊 التقارير والأرباح بلوحة الإدارة — ادخل بنفس حسابك');
    window.open(ADMIN_URL, '_blank', 'noopener');
  };
  window.goTab = (tab) => {
    if (tab === 'reports') { if (tabAllowed('reports')) openAdminPanel(); else deny(); return; }
    if (!TABS.includes(tab)) tab = 'cashier';
    if (!tabAllowed(tab)) { deny(); return; }
    TABS.forEach((t) => { const e = $(t + 'Screen'); if (e) e.classList.toggle('on', t === tab); });
    if (tab === 'capPay') renderCapPay();
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'reports') renderRep();
    if (tab === 'orders') renderOrders();
    if (tab === 'menu') showMTab('settings');
    if (tab === 'acc') renderAcc();
    if (tab === 'kitchen') renderKds();
    if (tab === 'shift') { renderShift(); loadClosedShifts().then(() => { if ($('shiftScreen').classList.contains('on')) renderShift(); }); }
  };
  window.updateAccBadge = function () {
    const n = lowCount();
    const b = $('nb5'); if (b) { const ni = b.querySelector('.ni'); if (ni) ni.textContent = n ? '📦❗' : '📦'; }
    const d = document.querySelector('.dnb[data-tab="acc"]'); if (d) d.textContent = '📦 المخزون والحسابات' + (n ? ' (' + toA(n) + ')' : '');
  };

  // الأساس (كان بـ index.html) — نفس الكود
const ordEditCore = id=>{
  const o=orders.find(x=>x.id===id);if(!o)return;
  if(!EDITABLE.includes(o.status)){toast(o.status==='delivering'?'🛵 الكابتن بالطريق — ما يمكن تعديل الأصناف':'⚠️ ما يمكن تعديل هذا الطلب');return;}
  const base=orderItemsFull(o);
  if(!base.length){toast('⚠️ أصناف هذا الطلب غير محفوظة (طلب قديم)');return;}
  edState={id,o,base:base.map(x=>({...x})),work:base.map(x=>({...x})),restock:['pending','accepted'].includes(o.status)?'return':'waste',pick:{ci:0,pi:0,vi:0},addQty:1};
  renderEd();
};
  window.ordEdit = (id) => {
    const o = orders.find((x) => x.id === id);
    if (o && capPaidHere(o)) { toast('💵 الطلب مدفوع — أي إضافة سوّيها طلب جديد'); return; }
    ordEditCore(id);
  };
  // الأساس (كان بـ index.html) — نفس الكود
const ordCancelCore = id=>{
  const o=orders.find(x=>x.id===id);if(!o||o.status==='cancelled')return;
  const prepared=!['pending','accepted'].includes(o.status);
  const fields=[{id:'why',label:'سبب الإلغاء *',type:'select',options:CANCEL_REASONS.map(x=>({v:x,t:x}))}];
  if(o.inv)fields.push({id:'stock',label:'وضع الطلب',type:'select',options:[{v:'return',t:'لم يُحضَّر — رجّع المواد للمخزن'},{v:'waste',t:'اتحضّر — سجّله تالف'}],value:prepared?'waste':'return'});
  fields.push({id:'note',label:'ملاحظة (اختياري)'});
  acDialog('❌ إلغاء الطلب #'+o.id.substring(0,6).toUpperCase(),o.status==='delivered'?'⚠️ الطلب مُسلَّم — يُسجَّل كمردود مبيعات':(o.status==='delivering'?'⚠️ الكابتن بالطريق':'المبلغ '+fmt(o.value)+' د.ع'),fields,v=>{
    const items=orderItemsFull(o);
    orderUpdate(id,{status:'cancelled',cancelReason:v.why,cancelNote:(v.note||'').trim(),cancelledBy:'المطعم',cancelledAt:Date.now(),cancelledFrom:o.status,cancelStock:o.inv?v.stock:'none',...(o.capSettled===false?{capSettled:null}:{}),
      cancelNotice:{by:'المطعم',time:nowT(),timestamp:Date.now(),seen:true}},'أُلغي الطلب — '+v.why,'cancelled').then(()=>{
        if(getOrderType(o)==='delivery')syncTracking(id,{status:'cancelled',value:o.value,fee:o.fee});
        if(o.payment&&o.payment.method==='credit'&&window.creditVoid)creditVoid(o,v.why);
        if(o.inv){if(v.stock==='return')consumeItems(items,'sale_return',id,'إلغاء طلب');else wasteItems(items,id,'إلغاء بعد التحضير');saveAcc();saveMenu();renderMenu();}
        toast('❌ تم إلغاء الطلب');
      }).catch(e=>toast('❌ '+e.message));
  },'❌ تأكيد الإلغاء');
};
  window.ordCancel = (id) => { if (!can('cancel')) { deny(); return; } ordCancelCore(id); };

  // ══════════ الصلاحيات (واجهة) ══════════
  function applyPerms() {
    const u = window.posUser || {};
    document.querySelectorAll('[data-tab]').forEach((b) => { b.style.display = tabAllowed(b.dataset.tab) ? '' : 'none'; });
    $('mt1').style.display = $('mt2').style.display = $('mt3').style.display = 'none';
    $('mt4').style.display = can('settings') ? '' : 'none';
    const os = $('ordSum'); if (os) os.style.display = isCashierRole() ? 'none' : '';
    syncTypeBtns(); renderPagers(); if (window.callsPermSync) callsPermSync();
    if (window.renderHold) renderHold();
    if (restData) { renderCapWait(); renderWeb(); }
    const rn = $('restName');
    if (rn) rn.textContent = (restData.name || 'المطعم') + (u.role === 'cashier' ? ' • 👤 ' + (u.name || 'كاشير') : '');
    const bb = $('branchBtn'); if (bb) bb.hidden = !u.branches;
    // لون التطبيق (🎨) لكل الموظفين — ينحفظ على نفس الجهاز بس، فما يأثر على غيره
    const ts = $('themeSwitcher'); if (ts) ts.style.display = 'block';
    // إذا كان على شاشة لم يعد مسموحاً بها
    const cur = TABS.find((t) => $(t + 'Screen').classList.contains('on'));
    if (cur && !tabAllowed(cur)) goTab('cashier');
    renderCart();
  }
  // الصلاحيات تتحدّث فوراً عند تغييرها من تطبيق الإدارة
  function listenMe() {
    const u = window.posUser; if (!u || u.role !== 'cashier') return;
    unsubs.push(fb().onSnapshot(fb().doc(fb().db, 'users', u.uid), (s) => {
      if (!s.exists() && s.metadata.fromCache) return;   // بدون إنترنت والكاش فارغ: لا نخرج الكاشير
      const d = s.exists() ? s.data() : null;
      if (!d || d.disabled || d.role !== 'cashier') { toast('⛔ تم إيقاف حسابك'); setTimeout(() => fb().signOut(fb().auth), 1500); return; }
      const before = JSON.stringify(u.perms || {});
      u.perms = d.perms || {}; u.name = d.name || u.name;
      u.hours = d.hours && typeof d.hours.from === 'number' ? d.hours : null;
      u.hoursExt = d.hoursExt && typeof d.hoursExt.untilMs === 'number' ? d.hoursExt : null;   // تمديد (من هذا الجهاز أو جهاز ثاني، أو صاحب المطعم لغاه)
      dutyCheck();
      if (before !== JSON.stringify(u.perms)) { applyPerms(); toast('🔄 تم تحديث صلاحياتك'); }
    }, () => {}));
  }

  // ══════════ أقسام المطبخ (شاورما، كنتاكي، برغر، بيتزا...) ══════════
  // كل صنف يتبع قسم فئته بالمنيو. الطلب يتقسم: كل قسم يطبع أصنافه فقط، ورقم الطلب يوحّد الكل.
  const secList = () => secArr(settings.sections || []).filter((x) => x.name);
  function secById(id) { return secList().find((x) => x.id === id); }
  const secOn = () => !!settings.kSecOn && secList().length > 0;
  function secOfItem(name) {
    const c = menu.find((c) => (c.items || []).some((i) => i.name === name));
    const sid = c ? (settings.catSection || {})[c.cat] : '';
    return sid && secById(sid) ? sid : '';
  }
  // رقم يومي يتسلسل لكل الطلبات (يظهر كبيراً على تذاكر الأقسام والبيجر و«طلبك جاهز»)
  // رقم واحد لكل المطعم حتى لو أكثر من كاشير يشتغلون سوا: كل جهاز يحجز من السيرفر دفعة صغيرة أرقام مقدماً
  // (restaurants/{rid}/counters/tickets) فالطلب ينطبع فوراً بدون انتظار؛ وبدون إنترنت نرجع للعدّ المحلي.
  //  نحجز رقم واحد مقدماً بس: إذا الصفحة انسدت، أقصى شي يتخطى رقم واحد
  //  وإذا النت بطيء (الحجز ياخذ أكثر من ثانية) نحجز 3 مقدماً حتى ما يخلص المحجوز ونرجع للعدّ المحلي اللي يكرر الأرقام
  let TK_BLOCK = 1;
  let tkPool = { day: '', nums: [] }, tkBusy = null, tkBusyAt = 0, tkSeen = { day: '', n: 0 };   // آخر رقم شفناه بالعدّاد
  function localTicketMax() {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    let m = 0;
    orders.forEach((o) => { if ((o.createdAtMs || 0) >= d0.getTime() && (o.ticketNo || 0) > m) m = o.ticketNo; });
    const last = lsGet('pos_ticket_' + rid(), { d: 0, n: 0 });
    if (last.d === d0.getTime() && last.n > m) m = last.n;
    return tkSeen.day === bagDay() && tkSeen.n > m ? tkSeen.n : m;
  }
  function tkRefill(tries = 0) {
    const f = fb();
    // حجز معلّق أكثر من 8 ثواني (النت انقطع بنصه) ما يوقف الحجوزات الجاية — وإذا وصل بعدين أرقامه تنضاف عادي
    if ((tkBusy && Date.now() - tkBusyAt < 8000) || !rid() || !f || !f.runTransaction || navigator.onLine === false) return;
    const day = bagDay(), t0 = Date.now(), block = TK_BLOCK;
    tkBusyAt = t0;
    const job = tkBusy = f.runTransaction(f.db, async (tx) => {
      const ref = sub('counters', 'tickets'), s = await tx.get(ref), d = s.exists() ? s.data() : {};
      // ما نرجع ورا أي رقم انطبع (حتى لو انطبع بدون إنترنت أو من جهاز بنسخة قديمة)
      const n = Math.max(d.day === day ? Number(d.n) || 0 : 0, localTicketMax());
      tx.set(ref, { day, n: n + block, updatedAtMs: Date.now() });
      return Array.from({ length: block }, (_, i) => n + 1 + i);
    }).then((nums) => { TK_BLOCK = Date.now() - t0 > 1000 ? 3 : 1; tkSeen = { day, n: Math.max(tkSeen.day === day ? tkSeen.n : 0, nums[nums.length - 1]) }; if (bagDay() !== day) return; if (tkPool.day !== day) tkPool = { day, nums: [] }; tkPool.nums.push(...nums); })
      .catch((e) => { TK_BLOCK = 3; console.warn('tickets', e.code || e.message); return e; })
      .then((e) => {
        if (tkBusy !== job) return;
        tkBusy = null;
        // الحجز فشل (كاشيرين حجزوا بنفس اللحظة، أو النت تقطّع): نعيد بعد لحظة بدل ما نرجع للعدّ المحلي اللي يكرر الأرقام
        if (e instanceof Error && tries < 3 && navigator.onLine !== false && !tkPool.nums.length) {
          tkBusyAt = Date.now();
          tkBusy = new Promise((r) => setTimeout(r, 200 + Math.random() * 600)).then(() => { tkBusy = null; tkRefill(tries + 1); return tkBusy; });
        }
      });
  }
  window.posTicketRefill = tkRefill;
  // قبل كل طلب: إذا خلصت الأرقام المحجوزة ننتظر الحجز الجاي (عادةً أقل من ثانية) بدل العدّ المحلي
  //  (العدّ المحلي يكرر رقم كاشير ثاني) — بدون إنترنت أو إذا السيرفر تأخر أكثر من 4 ثواني نكمل محلياً
  async function ensureTicket() {
    if (tkPool.day === bagDay() && tkPool.nums.length) return;
    if (navigator.onLine === false) return;
    tkRefill();
    const until = Date.now() + 4000;
    // ننتظر الحجز (ومحاولاته الثانية إذا فشل) لحد 4 ثواني
    while (tkBusy && !(tkPool.day === bagDay() && tkPool.nums.length) && Date.now() < until) await Promise.race([tkBusy, new Promise((r) => setTimeout(r, until - Date.now()))]);
  }
  window.addEventListener('online', () => tkRefill());
  // رقم العدّ المحلي (بدون إنترنت) ياخذ حرف الجهاز: «#12ب» — حتى لو كاشير ثاني عدّ هو هم بدون إنترنت ما يتكرر نفس الرقم
  const TK_TAGS = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';
  const tkTag = () => { let h = 0; for (const c of String(deviceId || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TK_TAGS[h % TK_TAGS.length]; };
  function nextTicket() {
    const d0 = new Date(), day = bagDay(); d0.setHours(0, 0, 0, 0);
    if (tkPool.day !== day) tkPool = { day, nums: [] };
    let n = tkPool.nums.shift(), local = false;
    if (n == null) { n = localTicketMax() + 1; local = true; window.__tkLocal = (window.__tkLocal || 0) + 1; }   // ما عندنا رقم محجوز (أول طلب قبل ما يوصل الحجز، أو بدون إنترنت)
    lsSet('pos_ticket_' + rid(), { d: d0.getTime(), n: Math.max(n, localTicketMax()) });
    if (tkPool.nums.length < (TK_BLOCK > 1 ? 2 : 1)) tkRefill();
    return local ? n + tkTag() : n;
  }
  const kNum = (o) => o.ticketNo || o.salonNum || o.holdNum || String(o.id || '').slice(0, 4).toUpperCase();
  window.kNum = kNum;
  function applySections(o) {
    o.ticketNo = nextTicket();
    if (!secOn()) return;
    const ks = {};
    (o.items || []).forEach((it) => { const sid = secOfItem(it.name); if (sid) { it.sec = sid; (ks[sid] = ks[sid] || { n: 0, readyAt: 0 }).n += it.qty; } });
    if (Object.keys(ks).length) o.kSec = ks;
  }
  window.kSecDone = async (id, sid) => {
    const o = orders.find((x) => x.id === id); if (!o || !o.kSec || !o.kSec[sid]) return;
    const ks = { ...o.kSec, [sid]: { ...o.kSec[sid], readyAt: o.kSec[sid].readyAt ? 0 : Date.now() } };
    try {
      const all = Object.values(ks).every((v) => v.readyAt);
      if (all && !featOn('kitchen')) { o.kSec = ks; await kdsDone(id); return; }   // ماكو شاشة مجهز ← خلص المطبخ = جاهز
      await fb().updateDoc(fb().doc(fb().db, 'orders', id), all ? { kSec: ks, kitchenSecDoneAt: Date.now() } : { kSec: ks });
      if (all) { toast('✅ خلص المطبخ — راح لشاشة المجهز'); return; }
      const sc = secById(sid); toast((ks[sid].readyAt ? '✅ ' : '↩️ ') + (sc ? sc.name : '') + (ks[sid].readyAt ? ' جاهز' : ' رجع قيد التحضير'));
    } catch (e) { toast('❌ تعذّر التحديث'); }
  };
  function renderKdsFilter() {
    const head = document.querySelector('#kitchenScreen .kds-head'); if (!head) return;
    let sel = $('kdsSecSel');
    if (!secOn()) { if (sel) sel.remove(); if (kdsSec) { kdsSec = ''; lsSet('pos_kds_sec', ''); } return; }
    if (!sel) { sel = document.createElement('select'); sel.id = 'kdsSecSel'; sel.className = 'kds-secsel'; head.insertBefore(sel, head.lastElementChild);
      sel.addEventListener('change', () => { kdsSec = sel.value; lsSet('pos_kds_sec', kdsSec); renderKds(); }); }
    const html = `<option value="">👨‍🍳 كل الأقسام</option>` + secList().map((x) => `<option value="${esc(x.id)}">${esc(x.emoji || '')} قسم ${esc(x.name)} فقط</option>`).join('');
    if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; }
    sel.value = kdsSec;
  }

  // ── تذكرة القسم: رقم الطلب كبير + أصناف القسم فقط
  function secTicketBody(o, sid) {
    const sc = secById(sid) || { name: sid, emoji: '' };
    const t = getOrderType(o), W = settings.paper === 58 ? 210 : 300;
    const label = t === 'salon' ? '🪑 صالة' + (o.tableNo ? ' — طاولة ' + o.tableNo : '') : t === 'takeaway' ? '🥡 سفري' : '🏍️ دلفري';
    const items = (o.items || []).filter((i) => i.sec === sid);
    const others = Object.keys(o.kSec || {}).filter((x) => x !== sid).map((x) => (secById(x) || {}).name).filter(Boolean);
    return `<div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;width:${W}px;padding:8px;color:#000">
      <div style="text-align:center;font-size:20px;font-weight:900;background:#000;color:#fff;padding:4px">${esc(sc.emoji || '')} قسم ${esc(sc.name)}</div>
      <div style="text-align:center;font-size:56px;font-weight:900;line-height:1.1;margin-top:4px">#${esc(kNum(o))}</div>
      <div style="text-align:center;font-size:14px;font-weight:700">${esc(label)}${o.pager ? ' • 📟 بيجر ' + esc(o.pager) : ''} • ${esc(t12(o.createdAt))}</div>
      <div style="border-top:2px dashed #000;margin:6px 0"></div>
      ${items.map((i) => `<div style="font-size:20px;font-weight:900;margin:4px 0">${i.qty}× ${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${i.note ? `<div style="font-size:15px;font-weight:700">📝 ${esc(i.note)}</div>` : ''}</div>`).join('')}
      ${o.note ? `<div style="border-top:1px dashed #000;margin-top:6px;padding-top:4px;font-size:15px;font-weight:700">📝 ${esc(o.note)}</div>` : ''}
      ${others.length ? `<div style="border-top:1px dashed #000;margin-top:6px;padding-top:4px;font-size:13px">يكتمل مع: ${esc(others.join('، '))}</div>` : ''}
    </div>`;
  }
  const docOf = (body) => `<html><head><meta charset="UTF-8"></head><body style="margin:0">${body}</body></html>`;
  window.secTicketBody = secTicketBody;

  // ── الطباعة: QZ Tray يرسل كل تذكرة لطابعة قسمها، وإلا كل التذاكر بنفس الطابعة (كل تذكرة بورقة)
  const QZ_SRC = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
  const QZ_SRI = 'sha384-eMCJjoa43DLpNZRyAjocYkZuahMjTlfLpm5i5MD/QGBM8dBbMG0xtjp50LA4vyhe';
  const qzKey = () => 'pos_qz_' + rid();
  const qzCfg = () => lsGet(qzKey(), { on: false, printers: {}, cert: '', key: '' });
  let qzLoading = null, qzSecSet = false;
  function qzLoad() {
    if (window.qz) return Promise.resolve();
    if (qzLoading) return qzLoading;
    qzLoading = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = QZ_SRC; sc.integrity = QZ_SRI; sc.crossOrigin = 'anonymous';
      sc.onload = res; sc.onerror = () => { qzLoading = null; rej(new Error('qz-load')); };
      document.head.appendChild(sc);
    });
    return qzLoading;
  }
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  function derLen(n) { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
  function pkcs1to8(der) {
    const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    const oct = [0x04, ...derLen(der.length), ...der];
    const body = [0x02, 0x01, 0x00, ...alg, ...oct];
    return new Uint8Array([0x30, ...derLen(body.length), ...body]);
  }
  async function qzSign(pem, data) {
    let der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1to8(der);
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, false, ['sign']);
    return b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data)));
  }
  async function qzReady() {
    await qzLoad();
    if (!qzSecSet) {
      qz.security.setCertificatePromise((res) => res(qzCfg().cert || ''));
      qz.security.setSignatureAlgorithm('SHA512');
      qz.security.setSignaturePromise((toSign) => (res, rej) => { const k = qzCfg().key; if (!k) return res(''); qzSign(k, toSign).then(res, rej); });
      qzSecSet = true;
    }
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
  }
  async function qzPrintHtml(printer, html) {
    const cfg = qz.configs.create(printer, { units: 'mm', size: { width: settings.paper === 58 ? 58 : 80 }, margins: 0, scaleContent: true });
    await qz.print(cfg, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }]);
  }
  // فتح درج الفلوس بعد ما تنطبع الفاتورة (الدرج موصول بالطابعة) — يشتغل بتطبيق الكاشير (أندرويد/سطح المكتب) وQZ Tray
  async function kickDrawer(printer) {
    if (!settings.drawer) return;
    try { if (DESK && DESK.drawer) { await DESK.drawer(printer || ''); return; } } catch (e) {}
    try { const qc = qzCfg(); if (qc.on && qc.main) { await qzReady(); await qz.print(qz.configs.create(qc.main), [{ type: 'raw', format: 'hex', data: '1B700019FA' }]); } } catch (e) {}
  }
  async function printOrderAll(o, receipt) {
    const secs = o.kSec ? Object.keys(o.kSec) : [];
    if (DESK) {
      const c = dpCfg(), jobs = [];
      if (receipt) jobs.push(deskPrint(receipt, c.main, '🧾 فاتورة #' + kNum(o), c.receiptCopies));
      for (const sid of secs) {
        const sc = secById(sid) || { name: sid };
        jobs.push(deskPrint(docOf(secTicketBody(o, sid)), (c.printers || {})[sid] || c.main, '👨‍🍳 ' + sc.name + ' #' + kNum(o), (c.copies || {})[sid]));
      }
      await Promise.all(jobs);
      if (receipt) kickDrawer(c.main);
      return;
    }
    const c = qzCfg();
    let left = secs;
    if (c.on && secs.length) {
      left = [];
      try {
        await qzReady();
        for (const sid of secs) { const pr = (c.printers || {})[sid]; if (pr) await qzPrintHtml(pr, docOf(secTicketBody(o, sid))); else left.push(sid); }
      } catch (e) { console.warn('qz', e); left = secs; toast('⚠️ برنامج الطابعات (QZ Tray) غير متصل — التذاكر انطبعت على الطابعة الافتراضية'); }
    }
    const pages = left.map((sid) => `<div style="page-break-before:always">${secTicketBody(o, sid)}</div>`).join('');
    if (receipt) { printHTML(pages ? receipt.replace('</body>', pages + '</body>') : receipt); kickDrawer(c.main || ''); }
    else if (pages) printHTML(docOf(pages.replace('page-break-before:always', 'page-break-before:auto')));
  }
  window.printOrderAll = printOrderAll;

  // ══════════ برنامج الكاشير للويندوز: طباعة مدمجة بدون QZ Tray ══════════
  // كل طابعة معرّفة بالويندوز تطلع بالقائمة، كل قسم لطابعته، طابور + إعادة محاولة،
  // وإذا طابعة قسم ما اشتغلت تنطبع تذكرته على الرئيسية حتى ما تضيع. الإعداد خاص بهالحاسبة.
  const DESK = window.SoraDesktop || null;
  const WIN_APP_URL = 'https://github.com/qaesartools-web/sora3a-rest2/releases/latest/download/sora3a-cashier-setup.exe';
  const REL = 'https://github.com/qaesartools-web/sora3a-rest2/releases';
  // تطبيق الكاشير لكل نظام: ويندوز، ماك، لينكس، أندرويد (أجهزة الكاشير والتابلت)
  function appOffer() {
    const ua = navigator.userAgent;
    const print = 'يطبع كل قسم على طابعته مباشرة، بدون أي برنامج ثاني وبدون نافذة طباعة.';
    if (/Android/i.test(ua)) return { label: '📱 تطبيق الكاشير للأندرويد', text: 'يطبع على الطابعة المدمجة بجهاز الكاشير، وطابعات الشبكة والبلوتوث مباشرة.', url: REL + '/download/cashier-android/sora3a-cashier.apk' };
    if (/Windows/i.test(ua)) return { label: '💻 برنامج الكاشير للويندوز', text: print, url: WIN_APP_URL };
    if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua) && !('ontouchend' in document)) return { label: '💻 برنامج الكاشير للماك', text: print, url: REL + '/latest/download/sora3a-cashier-mac.dmg' };
    if (/Linux/i.test(ua) && !/CrOS/i.test(ua)) return { label: '💻 برنامج الكاشير للينكس', text: print, url: REL + '/latest/download/sora3a-cashier-linux.AppImage' };
    return null;
  }
  const dpKey = () => 'pos_dp_' + rid();
  const dpCfg = () => ({ main: '', printers: {}, copies: {}, receiptCopies: 1, fallback: true, ...lsGet(dpKey(), {}) });
  window.dpCfgGet = dpCfg;
  let dpWarnAt = 0;
  async function deskPrint(html, printer, title, copies) {
    const c = dpCfg();
    let r;
    try {
      r = await DESK.print(html, { printer: printer || '', widthMm: settings.paper === 58 ? 58 : 80, copies: copies || 1, title,
        fallback: c.fallback && (printer || '') !== (c.main || '') ? (c.main || '') : null });
    } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    if (r.ok) return r;
    if (Date.now() - dpWarnAt > 3000) {
      dpWarnAt = Date.now();
      toast(r.fallback ? '⚠️ ' + title + ': طابعة «' + (printer || 'الافتراضية') + '» ' + r.error + ' — انطبعت على الطابعة الرئيسية'
        : '❌ ما انطبعت ' + title + ': ' + r.error);
    }
    return r;
  }
  if (DESK) {
    // كل طباعة بالكاشير (فواتير، تقارير، تذاكر محفوظة…) تروح مباشرة للطابعة الرئيسية بدون نافذة
    window.printHTML = printHTML = (html) => { deskPrint(html, dpCfg().main, '🖨️ طباعة', 1); };
    if (DESK.onUpdate) DESK.onUpdate((v) => deskUpd(v));
  }
  // نسخة جديدة لبرنامج الكاشير نفسه (الطباعة، شبكة المطعم…): شريط يبقى يرجع لحد ما تتثبت، وبعدها يختفي وحده
  //  «ثبّت هسه»: يتسكّر ويرجع بثواني. «لاحقاً»: يرجع بعد 30 دقيقة. وإذا محد لمس الكاشير 10 دقايق والسلة فارغة: يتثبت وحده
  let deskUpdV = '', deskUpdT = 0, deskAct = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { deskAct = Date.now(); }, true));
  const deskIdle = () => { try { return !window.auIdle || window.auIdle(); } catch (e) { return true; } };
  function deskInstall() {
    if (!deskIdle()) { toast('⚠️ خلّص الطلب اللي بالسلة أو سكّر النافذة المفتوحة أول، وبعدين ثبّت'); return; }
    toast('🔄 يتثبت التحديث — البرنامج يرجع ينفتح وحده بثواني');
    Promise.resolve(DESK.installUpdate()).catch(() => {});
  }
  function deskUpd(v) {
    deskUpdV = String(v || '');
    clearTimeout(deskUpdT);
    let b = $('deskUpd');
    if (!b) {
      b = document.createElement('div'); b.id = 'deskUpd'; b.setAttribute('role', 'status');
      b.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:9001;background:#1e3a8a;color:#fff;border-radius:999px;padding:6px 8px 6px 14px;box-shadow:0 6px 18px rgba(0,0,0,.3);font:700 13px Tajawal,sans-serif;display:flex;gap:8px;align-items:center;white-space:nowrap';
      document.body.appendChild(b);
    }
    const can = !!DESK.installUpdate;
    b.innerHTML = `⬆️ نسخة جديدة لبرنامج الكاشير ${esc(deskUpdV)}${can ? '' : ' — تتثبت لما تسكّر البرنامج وتفتحه'}
      ${can ? '<button type="button" data-du="go" style="border:0;border-radius:999px;padding:6px 12px;background:#fff;color:#1e3a8a;font:800 13px Tajawal,sans-serif;cursor:pointer">🔄 ثبّت هسه</button>' : ''}
      <button type="button" data-du="later" style="border:0;border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.18);color:#fff;font:700 12px Tajawal,sans-serif;cursor:pointer">لاحقاً</button>`;
    b.querySelector('[data-du="later"]').onclick = () => { b.remove(); clearTimeout(deskUpdT); deskUpdT = setTimeout(() => deskUpd(deskUpdV), 30 * 60000); };
    const go = b.querySelector('[data-du="go"]'); if (go) go.onclick = deskInstall;
  }
  setInterval(() => {
    if (deskUpdV && DESK && DESK.installUpdate && deskIdle() && Date.now() - deskAct > 10 * 60000) { deskAct = Date.now(); Promise.resolve(DESK.installUpdate()).catch(() => {}); }
  }, 60000);
  const dpOpt = (list, cur, emptyLabel) => '<option value="">' + emptyLabel + '</option>' + [...new Set([...list.map((p) => p.name), cur].filter(Boolean))]
    .map((n) => { const p = list.find((x) => x.name === n); const st = !p ? ' — ❓ مو موجودة' : p.ok ? '' : ' — ⚠️ ' + p.statusText;
      return `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}${p && p.isDefault ? ' (الافتراضية)' : ''}${st}</option>`; }).join('');
  window.dpFind = async (quiet) => {
    if (!DESK) return;
    const list = await DESK.printers().catch(() => []);
    const c = dpCfg();
    const m = $('dpMain'); if (m) m.innerHTML = dpOpt(list, m.value || c.main, '— الطابعة الافتراضية للويندوز —');
    secList().forEach((x) => { const sel = $('dpP_' + x.id); if (sel) sel.innerHTML = dpOpt(list, sel.value || (c.printers || {})[x.id] || '', '— نفس الطابعة الرئيسية —'); });
    const st = $('dpStatus');
    if (st) st.innerHTML = list.length ? list.map((p) => `<span class="dp-pr ${p.ok ? 'ok' : 'bad'}">${p.ok ? '🟢' : '🔴'} ${esc(p.displayName)}${p.ok ? '' : ' — ' + esc(p.statusText)}${p.kind === 'lan' && DESK.removePrinter ? ` <button type="button" class="dp-x" title="شيل الطابعة" onclick="dpRemoveNet(this.dataset.n)" data-n="${esc(p.name)}">✕</button>` : ''}</span>`).join('')
      : `<span class="ac-sub">${DESK.platform === 'android' ? 'ما لكينا طابعات — أضف طابعة شبكة تحت، أو اقرن طابعة البلوتوث من إعدادات الجهاز' : 'ما لكينا طابعات — عرّف الطابعة بالجهاز أولاً'}</span>`;
    if (!quiet) toast('🖨️ ' + toA(list.length) + ' طابعة بالحاسبة');
  };
  window.dpAddNet = async () => {
    const ip = (($('dpNetIp') || {}).value || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast('⚠️ اكتب IP الطابعة صحيح (مثال: 192.168.1.50)'); return; }
    const r = await DESK.addNetworkPrinter((($('dpNetName') || {}).value || '').trim(), ip, Number(($('dpNetPort') || {}).value) || 9100).catch((e) => ({ ok: false, error: String(e) }));
    if (!r || !r.ok) { toast('❌ ' + ((r && r.error) || 'ما انضافت')); return; }
    toast('✅ انضافت ' + r.name + ' — اختارها لقسمها وجرّبها بـ 🧪');
    ['dpNetName', 'dpNetIp'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    dpFind(true);
  };
  window.dpRemoveNet = async (name) => {
    if (!(await askOk('تشيل الطابعة «' + name + '»؟'))) return;
    await DESK.removePrinter(name); toast('🗑️ انشالت الطابعة'); dpFind(true);
  };
  window.dpTest = async (sid) => {
    const pr = sid === 'main' ? ($('dpMain') || {}).value : ($('dpP_' + sid) || {}).value || ($('dpMain') || {}).value;
    const name = sid === 'main' ? 'الفاتورة (الرئيسية)' : 'قسم ' + ((secById(sid) || {}).name || sid);
    const r = await DESK.print(docOf(`<div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;text-align:center;padding:10px;color:#000"><div style="font-size:22px;font-weight:900">🖨️ تجربة طابعة</div><div style="font-size:18px;font-weight:700;margin-top:6px">${esc(name)}</div><div style="font-size:13px;margin-top:6px">${esc(pr || 'الطابعة الافتراضية')}</div></div>`),
      { printer: pr || '', widthMm: settings.paper === 58 ? 58 : 80, copies: 1, title: '🧪 تجربة ' + name }).catch((e) => ({ ok: false, error: String(e) }));
    toast(r.ok ? '✅ انطبعت التجربة على ' + (pr || 'الطابعة الافتراضية') : '❌ فشلت: ' + r.error);
    dpJobs();
  };
  window.dpJobs = async () => {
    const el = $('dpJobs'); if (!el || !DESK) return;
    const js = await DESK.jobs().catch(() => []);
    el.innerHTML = js.length ? js.slice(0, 30).map((j) => `<div class="dp-job"><span>${j.ok ? '✅' : j.fallback ? '⚠️' : '❌'}</span>
      <span class="dp-jt"><b>${esc(j.title)}</b><small>${esc(new Date(j.at).toLocaleTimeString('ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit', hour12: true }))} • ${esc(j.fallback ? 'انطبعت على ' + j.fallback : j.printer)}${j.ok ? '' : ' • ' + esc(j.error)}</small></span>
      ${j.canReprint ? `<button type="button" class="btn-soft" onclick="dpReprint(${j.id})">🔁</button>` : ''}</div>`).join('') : '<div class="ac-sub">ماكو طباعة لحد الآن</div>';
  };
  window.dpReprint = async (id) => { const r = await DESK.reprint(id); toast(r.ok ? '✅ انعادت الطباعة' : r.fallback ? '⚠️ انطبعت على الطابعة الرئيسية' : '❌ ' + r.error); dpJobs(); };
  window.dpAuto = async (on) => {
    const v = await DESK.setAutoStart(on), android = DESK.platform === 'android';
    // أندرويد 10+: يحتاج «الظهور فوق التطبيقات» — تنفتح شاشته، والخانة تتحدث لما يرجع
    if (on && !v && android) { toast('⚠️ اسمح للتطبيق «بالظهور فوق التطبيقات» وارجع — بعدها يفتح وحده مع تشغيل الجهاز'); return; }
    toast(v ? (android ? '✅ الكاشير يفتح وحده مع تشغيل الجهاز' : '✅ البرنامج يشتغل وحده مع تشغيل الحاسبة') : 'تمام — ما يشتغل وحده');
  };
  function dpSettingsHtml(s) {
    const c = dpCfg(), secs = secArr(s.sections || []).filter((x) => x.name);
    const cp = (id, v) => `<input class="finp" type="number" min="1" max="5" id="${id}" value="${v || 1}" title="عدد النسخ" style="width:64px;text-align:center">`;
    return `<div class="flbl" style="margin-top:12px">🖨️ الطباعة — مدمجة ببرنامج الكاشير (بدون QZ)</div>
      <div class="ac-sub" style="margin:4px 0 8px;line-height:1.8">${DESK.platform === 'android' ? 'الطابعة المدمجة بالجهاز وطابعات البلوتوث المقترنة تطلع هنا وحدها، وطابعات الشبكة تضيفها بالـ IP تحت.' : DESK.platform === 'darwin' || DESK.platform === 'linux' ? 'كل طابعة معرّفة بالجهاز تطلع هنا.' : 'كل طابعة معرّفة بالويندوز تطلع هنا.'} اختر طابعة الفاتورة وطابعة كل قسم، وجرّبها بـ 🧪. الطباعة مباشرة بدون أي نافذة.</div>
      ${featOn('printTest') ? `<div class="dp-test">
        <label class="set-check" style="margin:0"><input type="checkbox" id="dpTestChk" onchange="dpTestMode(this.checked)"> 🧪 <b>وضع تجربة الطابعات</b> — طابعات وهمية، والورق يطلع على شاشة «محاكي الطابعات» بدون أي طابعة حقيقية</label>
        <div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="btn-soft" style="flex:1" onclick="dpSample()">🧾 طلب تجريبي</button><button type="button" class="btn-soft" style="flex:1" onclick="SoraDesktop.openSimulator()">🖥️ فتح المحاكي</button></div>
      </div>` : ''}
      <div id="dpStatus" class="dp-status"><span class="ac-sub">⏳ نجيب الطابعات…</span></div>
      <button type="button" class="btn-soft" style="width:100%;margin-top:6px" onclick="dpFind()">🔄 تحديث قائمة الطابعات</button>
      <div class="set-row" style="margin-top:8px"><div class="sec-cat">🧾 الفاتورة (الطابعة الرئيسية)</div><div style="display:flex;gap:6px"><select class="fsel" id="dpMain" style="flex:1"><option value="${esc(c.main)}" selected>${esc(c.main || '— الطابعة الافتراضية للويندوز —')}</option></select>${cp('dpRc', c.receiptCopies)}<button type="button" class="btn-soft" style="padding:8px 10px" onclick="dpTest('main')">🧪</button></div></div>
      ${secs.map((x) => `<div class="set-row" style="margin-top:8px"><div class="sec-cat">${esc(x.emoji || '')} ${esc(x.name)}</div><div style="display:flex;gap:6px"><select class="fsel" id="dpP_${esc(x.id)}" style="flex:1"><option value="${esc((c.printers || {})[x.id] || '')}" selected>${esc((c.printers || {})[x.id] || '— نفس الطابعة الرئيسية —')}</option></select>${cp('dpC_' + esc(x.id), (c.copies || {})[x.id])}<button type="button" class="btn-soft" style="padding:8px 10px" onclick="dpTest('${esc(x.id)}')">🧪</button></div></div>`).join('')}
      <label class="set-check" style="margin-top:8px"><input type="checkbox" id="dpFb" ${c.fallback !== false ? 'checked' : ''}> إذا طابعة قسم ما اشتغلت (مطفية / خلص الورق)، اطبع تذكرتها على الطابعة الرئيسية حتى ما تضيع</label>
      ${DESK.canAddNetwork ? `<div class="dp-net"><div class="flbl">➕ إضافة طابعة شبكة (LAN / Wi-Fi)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><input class="finp" id="dpNetName" placeholder="الاسم (مثلاً: مطبخ الشاورما)" style="flex:2;min-width:140px">
        <input class="finp" id="dpNetIp" dir="ltr" inputmode="decimal" placeholder="192.168.1.50" style="flex:1.4;min-width:120px">
        <input class="finp" id="dpNetPort" dir="ltr" type="number" value="9100" style="width:80px">
        <button type="button" class="btn-soft" onclick="dpAddNet()">➕ إضافة</button></div>
        <div class="ac-sub" style="margin-top:4px">الـ IP يطلع من ورقة إعدادات الطابعة (اضغط زر الطابعة مطوّلاً وهي تشتغل).</div></div>` : ''}
      ${DESK.canAutoStart === false ? '' : `<label class="set-check"><input type="checkbox" id="dpAutoChk" onchange="dpAuto(this.checked)"> ${DESK.platform === 'android' ? '🚀 افتح الكاشير وحده مع تشغيل الجهاز' : '🚀 شغّل برنامج الكاشير وحده مع تشغيل الحاسبة'}</label>`}
      <details style="margin-top:8px" ontoggle="if(this.open)dpJobs()"><summary class="ac-sub" style="cursor:pointer">🧾 سجل الطباعة (آخر 30) — وإعادة الطباعة</summary><div id="dpJobs" class="dp-jobs"></div></details>
      <div class="ac-sub" style="margin-top:6px">برنامج الكاشير ${esc(DESK.version || '')}</div>`;
  }
  // رجعنا من شاشة «الظهور فوق التطبيقات» بالأندرويد ← نحدّث خانة التشغيل مع الجهاز
  window.addEventListener('sora:resume', () => {
    const el = $('dpAutoChk'); if (el && DESK) DESK.getAutoStart().then((v) => { el.checked = !!v; }).catch(() => {});
  });

  // ── هل الأقسام مضبوطة؟ (من الخانات المعروضة حالياً، قبل الحفظ) ──
  const normAr = (t) => String(t || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .split(/\s+/).map((w) => w.replace(/^ال/, '')).join('').toLowerCase();
  function secFormState() {
    const on = !!($('stSecOn') || {}).checked;
    const secs = [...document.querySelectorAll('[id^="stSecN"]')].map((el) => ({ id: secArr(settings.sections)[+el.id.slice(6)]?.id, name: el.value.trim() })).filter((x) => x.id && x.name);
    const cats = [...document.querySelectorAll('[id^="stCat"]')].map((el) => ({ cat: el.dataset.cat, sid: el.value, el }));
    return { on, secs, cats, unmapped: cats.filter((c) => !c.sid), empty: secs.filter((x) => !cats.some((c) => c.sid === x.id)) };
  }
  function renderSecHealth() {
    const box = $('secHealth'); if (!box) return;
    const st = secFormState();
    const dirty = st.on !== !!settings.kSecOn || st.cats.some((c) => (c.sid || '') !== ((settings.catSection || {})[c.cat] || ''));
    let h;
    if (!st.on) h = `<div class="sh-warn">⚠️ <b>تقسيم الأقسام مطفي</b> — كل طلب يطبع <b>فاتورة بس</b>، وما تطلع تذكرة لأي قسم بالمطبخ.<button type="button" class="btn-soft" onclick="document.getElementById('stSecOn').click()">✅ فعّل التقسيم</button></div>`;
    else if (!st.secs.length) h = `<div class="sh-warn">⚠️ ماكو أقسام — اكتب اسم قسم واحد على الأقل فوق.</div>`;
    else if (st.unmapped.length) h = `<div class="sh-warn">⚠️ <b>${toA(st.unmapped.length)} فئة ما مربوطة بقسم</b> — أصنافها تطلع بالفاتورة بس، ما تنطبع بالمطبخ: ${st.unmapped.map((c) => esc(c.cat)).join('، ')}
        <button type="button" class="btn-soft" onclick="secAutoMap()">🪄 ربط تلقائي حسب الاسم</button></div>`;
    else h = `<div class="sh-ok">✅ كل الفئات مربوطة: ${st.secs.map((x) => `<b>${esc(x.name)}</b> (${toA(st.cats.filter((c) => c.sid === x.id).length)})`).join(' • ')}</div>`;
    if (st.on && st.empty.length && st.secs.length) h += `<div class="ac-sub" style="margin-top:4px">ℹ️ أقسام ما بيها فئات (ما راح تطبع شي): ${st.empty.map((x) => esc(x.name)).join('، ')}</div>`;
    if (dirty) h += `<div class="sh-save">💾 لا تنسى تضغط <b>✅ حفظ الإعدادات</b> تحت حتى تشتغل</div>`;
    box.innerHTML = h;
  }
  window.renderSecHealth = renderSecHealth;
  // يربط كل فئة بالقسم اللي اسمه يشبهها (شاورما ← الشاورما، وجبات برغر ← البرغر…)
  window.secAutoMap = () => {
    const st = secFormState(); let n = 0;
    st.unmapped.forEach((c) => {
      const cn = normAr(c.cat);
      const hit = st.secs.find((x) => { const sn = normAr(x.name); return sn && (cn.includes(sn) || sn.includes(cn)); });
      if (hit) { c.el.value = hit.id; n++; }
    });
    renderSecHealth();
    toast(n ? '🪄 انربطت ' + toA(n) + ' فئة — راجعها واضغط حفظ' : 'ما لكينا تشابه بالأسماء — اختار القسم لكل فئة يدوياً');
  };
  document.addEventListener('change', (e) => { const id = (e.target && e.target.id) || ''; if (id === 'stSecOn' || id.startsWith('stCat')) renderSecHealth(); });
  document.addEventListener('input', (e) => { if (((e.target && e.target.id) || '').startsWith('stSecN')) renderSecHealth(); });

  function dpAfterRender() {
    if (!DESK) return;
    dpFind(true);
    DESK.getAutoStart().then((v) => { const el = $('dpAutoChk'); if (el) el.checked = !!v; }).catch(() => {});
    if (DESK.getTestMode) DESK.getTestMode().then((v) => { const el = $('dpTestChk'); if (el) el.checked = !!v; }).catch(() => {});
    dpEnforceTest();
  }
  function dpEnforceTest() {
    if (!DESK || !DESK.getTestMode || featOn('printTest')) return;
    DESK.getTestMode().then(async (on) => {
      const c = dpCfg(), virt = (v) => String(v || '').startsWith(VPRE);
      const usesVirt = virt(c.main) || Object.values(c.printers || {}).some(virt);
      if (on) await DESK.setTestMode(false);
      if (usesVirt) {
        lsSet(dpKey(), { ...c, main: virt(c.main) ? '' : c.main, printers: Object.fromEntries(Object.entries(c.printers || {}).filter(([, v]) => !virt(v))) });
      }
      if (on || usesVirt) { toast('🧪 تجربة الطابعات انطفت من الإدارة — رجعنا للطابعات الحقيقية'); if ($('dpMain')) renderSettings(); }
    }).catch(() => {});
  }
  // وضع التجربة: نختار الطابعات الوهمية تلقائياً (الكاشير + مطبخ 1/2/3 للأقسام) ونرجّع الحقيقية لما ينطفي
  const VPRE = '🧪 تجريبية — ';
  window.dpTestMode = async (on) => {
    if (!DESK || !DESK.setTestMode) return;
    await DESK.setTestMode(on);
    await dpFind(true);
    const set = (sel, v) => { const el = $(sel); if (el) el.value = v; };
    if (on) {
      set('dpMain', VPRE + 'الكاشير');
      secList().forEach((x, i) => set('dpP_' + x.id, VPRE + 'مطبخ ' + ((i % 3) + 1)));
    } else {
      if ((($('dpMain') || {}).value || '').startsWith(VPRE)) set('dpMain', '');
      secList().forEach((x) => { if ((($('dpP_' + x.id) || {}).value || '').startsWith(VPRE)) set('dpP_' + x.id, ''); });
    }
    dpSave(); await dpFind(true);
    toast(on ? '🧪 وضع التجربة شغّال — اضغط «🧾 طلب تجريبي» وشوف الورق بالمحاكي' : '✅ رجعنا للطابعات الحقيقية');
  };
  // طلب تجريبي من المنيو الحقيقي (صنف من كل فئة) وبنفس منطق الطلب الحقيقي — بدون ما ينحفظ طلب
  window.dpSample = async () => {
    const items = menu.filter((c) => c && c.cat && (c.items || []).length).slice(0, 8).map((c, i) => {
      const it = c.items[0], v = (it.variants || [])[0] || { name: 'وحدة', price: it.price || 0 };
      return { name: it.name, variant: v.name || 'وحدة', qty: 1 + (i % 2), price: v.price || 0, note: i === 0 ? 'بدون بصل' : '' };
    });
    if (!items.length) { toast('⚠️ المنيو فارغ — أضف أصناف أولاً'); return; }
    const total = items.reduce((t, i) => t + i.price * i.qty, 0);
    const o = { id: 'TEST' + Date.now(), restaurantId: rid(), orderType: 'salon', salonNum: 99, pager: 3, items, value: total, subtotal: total, discount: 0,
      createdAtMs: Date.now(), createdAt: nowT(), note: 'هذا طلب تجريبي — لا تحضّره' };
    o.ticketNo = 99; // ما ناخذ رقم من تسلسل اليوم
    if (secOn()) {
      const ks = {};
      items.forEach((it) => { const sid = secOfItem(it.name); if (sid) { it.sec = sid; (ks[sid] = ks[sid] || { n: 0, readyAt: 0 }).n += it.qty; } });
      if (Object.keys(ks).length) o.kSec = ks;
    }
    await printOrderAll(o, receiptHTML(o, null, { payment: { method: 'cash', cash: total, card: 0 } }, settings.printKitchen && !o.kSec));
    const n = o.kSec ? Object.keys(o.kSec).length : 0;
    if (!secOn()) toast('⚠️ انطبعت فاتورة بس — تقسيم الأقسام مطفي (فعّله فوق واحفظ)');
    else if (!n) toast('⚠️ انطبعت فاتورة بس — ولا فئة مربوطة بقسم');
    else toast('🧾 انطبع طلب تجريبي: فاتورة + ' + toA(n) + ' تذكرة قسم');
    dpJobs();
  };
  function dpSave() {
    const c = dpCfg(), n = (id) => Math.max(1, Math.min(5, Math.round(num(($(id) || {}).value) || 1)));
    const next = { ...c, main: ($('dpMain') || {}).value || '', receiptCopies: n('dpRc'), fallback: !!($('dpFb') || {}).checked, printers: {}, copies: {} };
    secList().forEach((x) => { const v = ($('dpP_' + x.id) || {}).value; if (v) next.printers[x.id] = v; const k = n('dpC_' + x.id); if (k > 1) next.copies[x.id] = k; });
    lsSet(dpKey(), next);
  }
  window.dpSave = dpSave;
  window.qzFind = async () => {
    try { await qzReady(); const list = await qz.printers.find(); renderQzPrinters(list); toast('🖨️ وُجدت ' + toA(list.length) + ' طابعة'); }
    catch (e) { toast('❌ ما اتصل ببرنامج QZ Tray — تأكد أنه مثبت وشغّال'); }
  };
  window.qzTest = async (sid) => {
    const pr = ($('qzP_' + sid) || {}).value; if (!pr) { toast('⚠️ اختر الطابعة أولاً'); return; }
    const sc = secById(sid) || { name: sid };
    try { await qzReady(); await qzPrintHtml(pr, docOf(`<div style="font-family:Arial;direction:rtl;text-align:center;font-size:22px;font-weight:900;padding:10px">🖨️ تجربة طابعة<br>قسم ${esc(sc.name)}</div>`)); toast('✅ أُرسلت تجربة إلى ' + pr); }
    catch (e) { toast('❌ فشلت الطباعة: ' + (e.message || e)); }
  };
  function renderQzPrinters(list) {
    secList().forEach((x) => { const sel = $('qzP_' + x.id); if (!sel) return; const cur = sel.value || (qzCfg().printers || {})[x.id] || '';
      sel.innerHTML = '<option value="">— نفس الطابعة الافتراضية —</option>' + [...new Set([...list, cur].filter(Boolean))].map((n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join(''); });
  }
  window.renderQzPrinters = renderQzPrinters;
  window.qzCfgGet = qzCfg;
  window.qzCfgSet = (c) => { lsSet(qzKey(), c); };
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'stQzOn') { const b = $('qzBox'); if (b) b.style.display = e.target.value === '1' ? 'block' : 'none'; } });

  // ══════════ خدمات المطعم (يفتحها المدير الأعلى من لوحة الإدارة) ══════════
  // صاحب المطعم يكدر يوقف (ويرجّع) الخدمات اللي شغّلها البرج — من لوحة الإدارة (restaurants.svcOff)
  const ownerOff = (k) => !!(restData && restData.svcOff && restData.svcOff[k] === true && !['devices', 'printTest', 'screen'].includes(k));
  function feat(k) { return (!restData || !restData.features || restData.features[k] !== false) && !ownerOff(k); }
  window.posFeat = feat;
  // خدمات مطفية إلا إذا شغّلها المدير الأعلى (مثل محاكي الطابعات)
  function featOn(k) { return !!(restData && restData.features && restData.features[k] === true) && !ownerOff(k); }
  function applyFeatures() {
    syncTypeBtns();
    ['readyScrBtn', 'screenApkBtn'].forEach((id) => { const b = $(id); if (b) b.style.display = feat('screen') ? '' : 'none'; });
    // «شاشة المجهز» مفعّلة ← المطبخ ينشال من الكاشير (المجهز يحضّر على جهازه، ويرجع الطلب للكاشير أول ما يصير جاهز)
    document.querySelectorAll('[data-tab="capPay"]').forEach((b) => { b.style.display = tabAllowed('capPay') ? '' : 'none'; });
    if (!tabAllowed('capPay') && $('capPayScreen') && $('capPayScreen').classList.contains('on')) goTab('cashier');
    const kOff = featOn('kitchen');
    document.querySelectorAll('[data-tab="kitchen"]').forEach((b) => { b.style.display = kOff ? 'none' : ''; });
    if ($('kdsLink')) $('kdsLink').style.display = kOff ? '' : 'none';
    if (kOff && $('kitchenScreen') && $('kitchenScreen').classList.contains('on')) goTab('cashier');
    renderPagers();
    dpEnforceTest();
  }
  function listenRest() {
    unsubs.push(fb().onSnapshot(fb().doc(fb().db, 'restaurants', rid()), (s) => {
      if (!s.exists() || !restData) return;
      const before = JSON.stringify([restData.features || {}, restData.svcOff || {}]), beforeH = JSON.stringify(restData.hours || null);
      restData.features = s.data().features || null;
      restData.svcOff = s.data().svcOff || null;
      restData.hours = s.data().hours || null;   // ساعات الدوام (من برج سرعة) — تنشر ويا المنيو الأونلاين
      if (before !== JSON.stringify([restData.features || {}, restData.svcOff || {}])) { applyFeatures(); pubSoon(); toast('🔄 تم تحديث خدمات المطعم'); }
      else if (beforeH !== JSON.stringify(restData.hours || null)) pubSoon();
    }, () => {}));
  }

  // ══════════ دوام الكاشير (يحدده صاحب المطعم من لوحة الإدارة) ══════════
  // الوقت بتوقيت بغداد، والقواعد على السيرفر تمنع الكاشير خارج دوامه أيضاً
  let dutyLocked = false, dutyWarned = 0, dutyClosing = false;
  const bagNow = () => (Math.floor(Date.now() / 60000) + 180) % 1440;
  const hm = (n) => { const h = Math.floor(n / 60), m = n % 60; return toA((h % 12) || 12) + ':' + toA(String(m).padStart(2, '0')) + (h < 12 ? ' صباحاً' : ' مساءً'); };
  function onDutyNow(h) {
    if (!h) return true;
    const n = bagNow();
    return h.from < h.to ? (n >= h.from && n < h.to) : (n >= h.from || n < h.to);
  }
  const minsLeft = (h) => ((h.to - bagNow()) + 1440) % 1440;
  // ── تمديد الدوام: لما يخلص الوقت يطلع للكاشير «تمديد» (ساعة، ساعتين، ٣ ساعات، أو لنهاية اليوم) بدل ما يطلع مباشرة ──
  const extUntil = (u) => (u.hoursExt && Number(u.hoursExt.untilMs)) || 0;
  const extOn = (u) => extUntil(u) > Date.now();
  const bagMinOf = (ms) => (Math.floor(ms / 60000) + 180) % 1440;
  // نهاية اليوم بتوقيت بغداد: نص الليل (وإذا هسه بعد نص الليل: ٥ الصبح)
  function endOfDayMs() {
    const now = Date.now(), m = bagMinOf(now), target = m < 300 ? 300 : 1440;
    return now - (now % 60000) + (target - m) * 60000;
  }
  // نفس شرط السيرفر: من نص ساعة قبل نهاية الدوام لحد ساعة بعدها، أو خلال تمديد (أو خلص قبل أقل من ساعة)
  function canExtend(u) {
    if (!u.hours) return false;
    const e = u.hoursExt;
    if (e && e.h === 'off' && Number(e.atMs) > Date.now() - 12 * 3600000) return false;   // صاحب المطعم لغى التمديد اليوم
    const gap = (bagNow() - u.hours.to + 1440) % 1440;
    return gap < 60 || gap >= 1410 || extUntil(u) > Date.now() - 3600000;
  }
  const dutyLeft = (u) => Math.max(onDutyNow(u.hours) ? minsLeft(u.hours) : 0, extOn(u) ? Math.ceil((extUntil(u) - Date.now()) / 60000) : 0);
  let extAsk = false, extAskT = null;
  function dutyCheck() {
    const u = window.posUser; if (!u || u.role !== 'cashier' || !restData) return;
    const h = u.hours;
    if (onDutyNow(h) || extOn(u)) {
      if (dutyLocked) { location.reload(); return; }       // بداية الدوام أو تمدد: تشغيل كامل من جديد
      if (extAsk) closeExtAsk();
      if (h) {
        const left = dutyLeft(u);
        if (left <= 10 && dutyWarned !== 10 && left > 5) { dutyWarned = 10; toast('⏰ باقي ' + toA(left) + ' دقائق على نهاية دوامك — كمّل الطلبات المفتوحة'); }
        if (left <= 5 && dutyWarned !== 5) { dutyWarned = 5; toast('⏰ باقي ' + toA(left) + ' دقائق — لما يخلص الوقت تكدر تمدد الدوام'); }
      }
      return;
    }
    if (dutyLocked || extAsk) return;
    // خلص الوقت: نسأله يمدد (السيرفر يسمح ١٥ دقيقة)، وإذا ما اختار شي ينقفل وحده
    if (canExtend(u)) { askExtend(); return; }
    endDuty();
  }
  function endDuty() {
    closeExtAsk();
    if (dutyLocked) return;
    dutyLocked = true;
    dutyEndShift().finally(showDutyLock);
  }
  window.dutyEndNow = endDuty;
  // الأجهزة المعتمدة: السيرفر رفض هذا الجهاز وهو شغّال (الحساب انفتح بجهاز ثاني، أو الإدارة لغت اعتماد الجهاز)
  window.posSessionLost = () => {
    const u = window.posUser;
    if (!u || u.role !== 'cashier' || !restData || !(restData.features && restData.features.devices === true)) return;
    if (dutyLocked || extAsk || $('devLost')) return;
    if (!(onDutyNow(u.hours) || extOn(u))) return;   // خارج الدوام: قفل الدوام يتكفل
    const el = document.createElement('div'); el.id = 'devLost'; el.className = 'duty-lock on';
    el.innerHTML = `<div class="duty-box"><div class="duty-i">⛔</div><b>ما تكدر تشتغل على هذا الجهاز هسه</b>
      <div class="duty-t">يا إما حسابك انفتح بجهاز ثاني، أو الإدارة لغت اعتماد هذا الجهاز</div>
      <button type="button" class="btn-main" onclick="location.reload()">🔄 دخول من جديد على هذا الجهاز</button>
      <button type="button" class="btn-soft" onclick="dutyLogout()">🚪 تسجيل خروج</button></div>`;
    document.body.appendChild(el);
  };
  // نسأل السيرفر إذا هذا الجهاز بعده مسموح: لما كتابة تنرفض (حتى ما نقفل بسبب صلاحية وحدة ناقصة)، وكل ٣ دقايق
  //  (مستند ما يسمعه أحد، حتى السيرفر يفحص من جديد — مو جواب من مستمع مفتوح)
  let deniedAt = 0;
  window.posDenied = async () => {
    const u = window.posUser, fb = window._fb;
    if (!u || u.role !== 'cashier' || !restData || !(restData.features && restData.features.devices === true) || !fb.getDocFromServer) return;
    if (Date.now() - deniedAt < 15000 || $('devLost')) return;
    deniedAt = Date.now();
    try { await fb.getDocFromServer(fb.doc(fb.db, 'restaurants', restData.id, 'probe', 'device')); }
    catch (e) { if (e && e.code === 'permission-denied') window.posSessionLost(); }
  };
  setInterval(() => { if (!document.hidden && navigator.onLine) window.posDenied(); }, 180000);
  const extBtns = () => {
    const eod = endOfDayMs(), opts = [[1, '⏱️ ساعة'], [2, '⏱️ ساعتين'], [3, '⏱️ ٣ ساعات']].filter(([n]) => Date.now() + n * 3600000 < eod);
    return `<div class="ext-grid">${opts.map(([n, l]) => `<button type="button" class="ext-b" onclick="dutyExtend(${n})">${l}</button>`).join('')}
      <button type="button" class="ext-b eod" onclick="dutyExtend('day')">🌙 لنهاية اليوم <small>لغاية ${hm(bagMinOf(eod))}</small></button></div>`;
  };
  function askExtend() {
    extAsk = true;
    let el = $('extAsk');
    if (!el) { el = document.createElement('div'); el.id = 'extAsk'; el.className = 'duty-lock'; document.body.appendChild(el); }
    el.innerHTML = `<div class="duty-box"><div class="duty-i">⏰</div><b>خلص وقت دوامك</b>
      <div class="duty-t">تريد تمدد الدوام؟</div>
      ${extBtns()}
      <button type="button" class="btn-soft" onclick="dutyEndNow()">🔒 إنهاء الدوام وطباعة تقرير المبيعات</button>
      <div class="duty-s">إذا مدّدت، التقرير ينطبع لما يخلص التمديد. وإذا ما اخترت شي، الدوام ينتهي وينطبع التقرير وحده بعد ١٤ دقيقة</div></div>`;
    el.classList.add('on');
    clearTimeout(extAskT);
    extAskT = setTimeout(() => { if (extAsk) endDuty(); }, 14 * 60000);
  }
  function closeExtAsk() { extAsk = false; clearTimeout(extAskT); const el = $('extAsk'); if (el) el.classList.remove('on'); }
  window.dutyExtend = async (n) => {
    const u = window.posUser; if (!u) return;
    const untilMs = n === 'day' ? endOfDayMs() : Math.min(Date.now() + n * 3600000, endOfDayMs());
    try {
      await fb().updateDoc(fb().doc(fb().db, 'users', u.uid), { hoursExt: { untilMs, atMs: Date.now(), h: String(n) } });
      u.hoursExt = { untilMs, atMs: Date.now(), h: String(n) };
      dutyWarned = 0; closeExtAsk();
      toast('✅ تمدد الدوام لغاية ' + hm(bagMinOf(untilMs)));
      if (dutyLocked) setTimeout(() => location.reload(), 600);   // كان مقفول: يرجع يشتغل
    } catch (e) { toast('⚠️ تعذّر التمديد' + (e && e.code === 'permission-denied' ? ' — انتهى وقت التمديد، كلّم صاحب المطعم' : ' — تأكد من الإنترنت')); }
  };
  // نهاية الدوام: إغلاق وردية هذا الكاشير وطباعة فاتورة المبلغ الكلي
  // نهاية الدوام: وردية مفتوحة ← تنسد وينطبع تقريرها (Z)؛ ماكو وردية ← ينطبع تقرير مبيعات اليوم
  let dutyPrinted = null;
  async function dutyEndShift() {
    const u = window.posUser;
    if (dutyClosing) return;
    if (!shift || !(shift.uid === u.uid || shift.device === deviceId)) {
      toast('🖨️ انتهى الدوام — دا ينطبع تقرير مبيعات اليوم');
      const day = Date.now(); printDaily(day); dutyPrinted = { kind: 'daily', day };
      return;
    }
    dutyClosing = true;
    await ensureShiftOrders(shift);
    if (!shift) { dutyClosing = false; return; }
    const report = shiftCalc(shift);
    const done = { status: 'closed', closedAtMs: Date.now(), countedCash: report.expected, expectedCash: report.expected, diff: 0,
      note: 'إغلاق تلقائي عند نهاية الدوام — يُرجى عدّ الدرج وتسليمه', autoClosed: true, report };
    try {
      await fb().updateDoc(sub('shifts', shift.id), done);
      const closed = { ...shift, ...done };
      printShift(closed, 'z'); dutyPrinted = { kind: 'z', id: closed.id };
      closedShifts = [closed, ...closedShifts].slice(0, KEEP_REPORTS);
      shift = null;
      toast('🔒 انتهى الدوام — أُغلقت الوردية وانطبع تقرير المبيعات');
    } catch (e) { toast('⚠️ تعذّر إغلاق الوردية تلقائياً — صاحب المطعم يغلقها'); }
  }
  function showDutyLock() {
    const h = window.posUser.hours;
    let el = $('dutyLock');
    if (!el) { el = document.createElement('div'); el.id = 'dutyLock'; el.className = 'duty-lock'; document.body.appendChild(el); }
    el.innerHTML = `<div class="duty-box"><div class="duty-i">⏰</div><b>خارج وقت الدوام</b>
      <div class="duty-t">دوامك من ${hm(h.from)} إلى ${hm(h.to)}</div>
      <div class="duty-s">النظام يفتح تلقائياً عند بداية دوامك</div>
      ${canExtend(window.posUser) ? `<div class="duty-t" style="margin-top:4px">أو مدّد الدوام:</div>${extBtns()}` : ''}
      ${dutyPrinted ? `<button type="button" class="btn-soft" onclick="${dutyPrinted.kind === 'z' ? `shiftReprint('${esc(dutyPrinted.id)}')` : `printDaily(${Number(dutyPrinted.day) || 0})`}">🖨️ إعادة طباعة تقرير المبيعات</button>` : ''}
      <button type="button" class="btn-main" onclick="dutyLogout()">🚪 تسجيل خروج</button></div>`;
    el.classList.add('on');
  }
  window.dutyLogout = async () => { try { await fb().signOut(fb().auth); } catch (e) {} location.reload(); };
  setInterval(dutyCheck, 20000);

  // ══════════ البيجر (جهاز استدعاء الزبائن بالصالة) ══════════
  // الكاشير يختار رقم البيجر قبل الترحيل ← يظهر الرقم مشغولاً ← عند «جاهز» من المطبخ يصير أخضر ويرن
  // ← الكاشير يضغط زر الرقم على جهاز البيجر ← بعد استلام الزبون يضغط الرقم هنا فيتحرر
  let pagerSel = 0;
  const pagerAlerted = new Set();
  let pagerReady = false;
  const pagerOrders = () => {
    const m = new Map();
    orders.forEach((o) => {
      if (!o.pager || o.pagerDone || o.status === 'cancelled' || Date.now() - (o.createdAtMs || 0) > 12 * 3600000) return;
      const prev = m.get(o.pager); if (!prev || (o.createdAtMs || 0) > (prev.createdAtMs || 0)) m.set(o.pager, o);
    });
    return m;
  };
  const pagerIsReady = (o) => o.kitchen === 'ready' || o.status === 'ready';
  function pagerBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .18, .36, .7, .88, 1.06].forEach((d) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'square'; o.frequency.value = 1046;
        g.gain.setValueAtTime(.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d + .14); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .16); });
    } catch (e) {}
  }
  function renderPagers() {
    let el = $('pagerBar');
    const n = Number(settings.pagers != null ? settings.pagers : 10) || 0;
    if (!el) {
      const anchor = $('curCust'); if (!anchor) return;
      el = document.createElement('div'); el.id = 'pagerBar'; el.className = 'pager-bar';
      anchor.parentNode.insertBefore(el, anchor);
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) pagerClick(+b.dataset.pg); });
    }
    if (!n || !restData || !feat('pager') || !myPerm('pager')) { el.style.display = 'none'; pagerSel = 0; return; }
    el.style.display = '';
    const busy = pagerOrders();
    // تنبيه عند صيرورة طلب جاهزاً
    const fresh = [];
    busy.forEach((o, p) => { if (pagerIsReady(o) && !pagerAlerted.has(o.id)) { pagerAlerted.add(o.id); if (pagerReady) fresh.push(p); } });
    pagerReady = true;
    if (fresh.length) { pagerBeep(); toast('📟 اضغط البيجر رقم ' + fresh.map(toA).join(' و ') + ' — الطلب جاهز'); }
    if (pagerSel && busy.has(pagerSel)) pagerSel = 0;
    const readyN = [...busy.values()].filter(pagerIsReady).length;
    el.innerHTML = `<div class="pg-head"><span>📟 البيجر</span><small>${pagerSel ? 'للطلب الحالي: <b>' + toA(pagerSel) + '</b>' : (cart.length ? 'اختر رقم للطلب' : '')}${readyN ? ' • <b class="pg-rd">' + toA(readyN) + ' جاهز</b>' : ''}</small></div>
      <div class="pg-grid">${Array.from({ length: n }, (_, i) => {
        const p = i + 1, o = busy.get(p);
        const cls = o ? (pagerIsReady(o) ? 'ready' : 'busy') : (pagerSel === p ? 'sel' : '');
        const tip = o ? (pagerIsReady(o) ? 'جاهز — اضغط البيجر ثم اضغط هنا بعد الاستلام' : 'قيد التحضير — ' + (o.customer || '')) : 'متاح';
        return `<button type="button" class="pg ${cls}" data-pg="${p}" title="${esc(tip)}">${toA(p)}</button>`;
      }).join('')}</div>`;
  }
  function pagerClick(p) {
    const o = pagerOrders().get(p);
    if (!o) { pagerSel = pagerSel === p ? 0 : p; renderPagers(); if (pagerSel) toast('📟 بيجر ' + toA(p) + ' للطلب الحالي — أعطِ الجهاز للزبون'); return; }
    const label = (o.customer || '') + ' • ' + orderItemsFull(o).map((i) => toA(i.qty) + '× ' + i.name).join('، ');
    if (!pagerIsReady(o)) {
      acDialog('📟 بيجر ' + toA(p) + ' — قيد التحضير', label, [], () => { kdsDone(o.id); }, '✅ الطلب جاهز — نادِ الزبون');
      return;
    }
    acDialog('📟 بيجر ' + toA(p) + ' — جاهز', 'اضغط رقم ' + toA(p) + ' على جهاز البيجر. بعد ما يستلم الزبون طلبه ويرجّع الجهاز اضغط «استلم» — ' + label, [], () => { pagerFree(o); }, '🤝 الزبون استلم — حرّر البيجر');
  }
  async function pagerFree(o) {
    try {
      if (o.held && o.status !== 'delivered') { ordHandover(o.id); return; }
      else { await fb().updateDoc(fb().doc(fb().db, 'orders', o.id), { pagerDone: true, servedAtMs: Date.now() }); toast('✅ تحرر البيجر ' + toA(o.pager)); }
    } catch (e) { toast('❌ تعذّر التحديث'); }
  }

  // ══════════ إشعار الكابتن حتى والتطبيق مسكّر (سيرفر إشعارات مجاني) ══════════
  // عنوان السيرفر يحطه المدير الأعلى من لوحة الإدارة (config/push). بدونه كلشي يشتغل عادي بدون هذا الإشعار.
  let pushUrl = null;
  const pushQueue = new Map(); // orderId → وقت التخصيص
  async function loadPushUrl() {
    try { const s = await fb().getDoc(fb().doc(fb().db, 'config', 'push')); const u = s.exists() ? String(s.data().url || '') : ''; pushUrl = /^https?:\/\//.test(u) ? u : null; } catch (e) { pushUrl = null; }
  }
  window.notifyCaptain = notifyCaptain;
  // n = وقت هذا التخصيص: إعادة المحاولة ترسل نفس n (ما يتكرر الإشعار)، وإعادة تخصيص نفس الكابتن ترسل n جديد (يرن من جديد)
  async function notifyCaptain(orderId, tries, n) {
    tries = tries || 0; n = n || Date.now();
    if (!pushUrl || !orderId) return;
    if (!navigator.onLine) { pushQueue.set(orderId, n); return; }
    const retry = () => { if (tries < 2) setTimeout(() => notifyCaptain(orderId, tries + 1, n), 3000 * (tries + 1)); else pushQueue.set(orderId, n); };
    try {
      const u = fb().auth.currentUser; if (!u) return;
      const r = await fetch(pushUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await u.getIdToken()) }, body: JSON.stringify({ orderId, n }) });
      if (r.status === 404 || r.status >= 500) retry();
    } catch (e) { retry(); }
  }
  addEventListener('online', () => { const l = [...pushQueue]; pushQueue.clear(); l.forEach(([id, n]) => notifyCaptain(id, 0, n)); });

  // ══════════ خصم الزبون الدائم (الدلفري) ══════════
  // صاحب المطعم يحدده من تطبيق الإدارة: كل N طلبات دلفري ← خصم. الكاشير يبلّغ الزبون ثم يطبّقه بضغطة.
  let loyalty = { on: false };
  const loyaltyOn = () => !!(loyalty.on && loyalty.every >= 2 && loyalty.value > 0);
  const loyaltyLabel = () => loyalty.type === 'amt' ? money(loyalty.value) : toA(loyalty.value) + '٪' + (loyalty.cap ? ' (بحد أقصى ' + money(loyalty.cap) + ')' : '');
  const dCount = (d) => (d && (d.dOrders ?? d.orders)) || 0;
  function loyaltyDue(d) { if (!loyaltyOn() || !d) return 0; const next = dCount(d) + 1; return next % loyalty.every === 0 ? next : 0; }
  function listenLoyalty() {
    loyalty = { on: false };
    unsubs.push(fb().onSnapshot(sub('loyalty', 'main'), (s) => {
      loyalty = s.exists() ? s.data() : { on: false };
      if (!loyaltyOn() && disc.loyalty) { disc = { type: 'amt', value: 0, reason: '' }; toast('⏸️ أوقفت الإدارة خصم الزبائن الدائمين — أُزيل من السلة'); renderCart(); }
      renderLoyalty(); renderCurCust();
    }, () => {}));
  }
  function loyCustomer() {
    const k = phoneKey($('dPhone') && $('dPhone').value);
    if (k.length < 7) return null;
    const data = curCust && curCust.phone === k && curCust.data ? curCust.data : custCache.get(k);
    return data ? { k, data } : null;
  }
  window.renderLoyalty = renderLoyalty;
  function renderLoyalty() {
    const el = $('loyHint'); if (!el) return;
    const busy = typeof changingOrderId !== 'undefined' && changingOrderId;
    const c = !busy && $('delivOv') && $('delivOv').classList.contains('on') ? loyCustomer() : null;
    const due = c ? loyaltyDue(c.data) : 0;
    if (disc.loyalty && (!c || disc.loyalty.phone !== c.k || !loyaltyOn())) { disc = { type: 'amt', value: 0, reason: '' }; renderCart(); }
    if (!due) { el.innerHTML = ''; return; }
    if (disc.loyalty) {
      el.innerHTML = `<div class="loy-hint done">✅ <b>تم تطبيق خصم الزبون الدائم</b> — ${loyaltyLabel()}<small>الخصم -${money(totals('delivery').disc)} ينطبع بالفاتورة</small><button type="button" onclick="removeLoyalty()">✕ إلغاء الخصم</button></div>`;
      return;
    }
    el.innerHTML = `<div class="loy-hint">🎉 <b>هذا الزبون يستحق خصم ${loyaltyLabel()}</b><br>هذا طلب الدلفري رقم ${toA(due)} له — زبون دائم 🌟<small>📢 بلّغ الزبون بالخصم بالتلفون، وبعدها اضغط الزر</small><button type="button" onclick="applyLoyalty()">✅ بلّغت الزبون — طبّق الخصم</button></div>`;
  };
  window.applyLoyalty = () => {
    const c = loyCustomer(); const due = c ? loyaltyDue(c.data) : 0;
    if (!due) { toast('⚠️ الزبون ما يستحق الخصم حالياً'); renderLoyalty(); return; }
    const sub_ = totals(null).sub;
    if (loyalty.type === 'amt') disc = { type: 'amt', value: Math.min(loyalty.value, sub_), reason: 'خصم الزبون الدائم' };
    else {
      const pct = Math.min(100, loyalty.value), amt = Math.round(sub_ * pct / 100);
      disc = loyalty.cap && amt > loyalty.cap ? { type: 'amt', value: loyalty.cap, reason: 'خصم الزبون الدائم' } : { type: 'pct', value: pct, reason: 'خصم الزبون الدائم' };
    }
    disc.loyalty = { phone: c.k, n: due };
    renderCart(); renderLoyalty();
    toast('🎁 تم تطبيق خصم الزبون الدائم');
  };
  window.removeLoyalty = () => { disc = { type: 'amt', value: 0, reason: '' }; renderCart(); renderLoyalty(); };

  // ══════════ سجل الزبائن ══════════
  let curCust = null;            // الزبون الحالي (من مكالمة أو بحث)
  const custCache = new Map();
  function phoneKey(p) {
    let x = String(p || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, '');
    if (x.startsWith('00964')) x = x.slice(5); else if (x.startsWith('964')) x = x.slice(3);
    if (x.length === 10 && x[0] === '7') x = '0' + x;
    return x;
  }
  // custSeq: إذا انحفظ الزبون أثناء البحث، ما نخزّن نتيجة قديمة («زبون جديد») بالكاش
  const custSeq = new Map();
  async function getCustomer(phone) {
    const k = phoneKey(phone); if (k.length < 7) return null;
    if (custCache.has(k)) return custCache.get(k);
    const v = custSeq.get(k);
    try { const s = await fb().getDoc(sub('customers', k)); const d = s.exists() ? s.data() : null; if (custSeq.get(k) === v) custCache.set(k, d); return d; }
    catch (e) { return null; }
  }
  function saveCustomer(o) {
    const k = phoneKey(o.phone); if (k.length < 7 || !rid()) return;
    const f = fb(), counts = {};
    (o.items || []).forEach((i) => { const n = String(i.name || '').slice(0, 60); if (n) counts[n] = f.increment(i.qty || 1); });
    const cached = custCache.get(k);
    const d = { phone: k, orders: f.increment(1), spent: f.increment(o.value || 0), lastOrderAt: Date.now(),
      lastItems: (o.items || []).slice(0, 15).map((i) => { const x = { name: i.name, variant: i.variant, qty: i.qty }; if (i.note) x.note = i.note; return x; }), itemCounts: counts };
    if (o.customer && !/^(سفري|صالة|طاولة)/.test(o.customer)) d.name = String(o.customer).slice(0, 60);
    if (o.address) d.address = String(o.address).slice(0, 200);
    // عدّاد طلبات الدلفري (أساس خصم الزبون الدائم) — الزبائن القدامى يبدأ عدّادهم من عدد طلباتهم
    if (o.orderType === 'delivery') d.dOrders = cached && cached.dOrders == null ? (cached.orders || 0) + 1 : f.increment(1);
    if (o.loyalty) { d.loyaltyGiven = f.increment(1); d.lastLoyaltyAt = Date.now(); }
    f.setDoc(sub('customers', k), d, { merge: true }).catch(() => {});
    custCache.delete(k); custSeq.set(k, (custSeq.get(k) || 0) + 1);
  }
  const ago = (ms) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : 'قبل ' + toA(d) + ' يوم'; };
  function favs(d, n) { return Object.entries((d && d.itemCounts) || {}).sort((a, b) => b[1] - a[1]).slice(0, n || 3); }
  function custSummary(d) {
    if (!d) return '<span class="cs-new">🆕 زبون جديد</span>';
    const f = favs(d, 3);
    return `<b>${esc(d.name || 'بدون اسم')}</b>${d.address ? ' • 📍 ' + esc(d.address) : ''}<br>
      ⭐ ${toA(d.orders || 0)} طلب${loyaltyDue(d) ? '<span class="loy-badge">🎁 يستحق خصم بالدلفري</span>' : ''}${d.spent ? ' • ' + money(d.spent) : ''}${d.lastOrderAt ? ' • آخر طلب ' + ago(d.lastOrderAt) : ''}
      ${f.length ? '<br>❤️ ' + f.map(([n, q]) => esc(n) + ' ×' + toA(q)).join('، ') : ''}`;
  }
  function showCustHint(d) {
    const el = $('custHint'); if (!el) return;
    renderLoyalty();
    el.innerHTML = d ? `<div class="cust-hint">${custSummary(d)}${(d.lastItems || []).length ? `<button type="button" onclick="repeatLast()">🔁 أضف آخر طلب للسلة</button>` : ''}</div>` : '';
  }
  // كتابة الرقم بنموذج الدلفري تملأ الاسم والعنوان تلقائياً
  let phoneT = null;
  $('dPhone').addEventListener('input', () => {
    clearTimeout(phoneT);
    phoneT = setTimeout(async () => {
      const d = await getCustomer($('dPhone').value);
      if (d) { if (!$('dName').value) $('dName').value = d.name || ''; if (!$('dAddr').value) $('dAddr').value = d.address || ''; curCust = { phone: phoneKey($('dPhone').value), data: d }; }
      showCustHint(d);
    }, 350);
  });
  window.repeatLast = () => {
    const d = curCust && curCust.data; if (!d || !(d.lastItems || []).length) return;
    let added = 0;
    d.lastItems.forEach((i) => {
      let p = null, v = null;
      menu.forEach((c) => c.items.forEach((it) => { if (it.name === i.name) { p = it; v = it.variants.find((x) => x.name === i.variant) || it.variants[0]; } }));
      if (p && v) { const ex = cart.find((c) => c.name === p.name && c.variant === v.name && (c.note || '') === (i.note || '')); if (ex) ex.qty += i.qty; else cart.push({ name: p.name, variant: v.name, price: v.price, qty: i.qty, note: i.note || '' }); added++; }
    });
    renderCart();
    toast(added ? '🔁 أُضيف آخر طلب للسلة' : '⚠️ أصناف الطلب السابق غير موجودة بالمنيو الحالي');
  };
  function renderCurCust() {
    const el = $('curCust'); if (!el) return;
    if (!curCust) { el.classList.remove('on'); el.innerHTML = ''; return; }
    el.classList.add('on');
    el.innerHTML = `<div style="flex:1;min-width:0">📞 <b dir="auto">${esc(curCust.phone || curCust.label || '')}</b> — ${curCust.data ? esc(curCust.data.name || 'زبون') + ' • ' + toA(curCust.data.orders || 0) + ' طلب' + (loyaltyDue(curCust.data) ? '<span class="loy-badge">🎁 يستحق خصم بالدلفري</span>' : '') : 'زبون جديد'}</div><button type="button" title="إلغاء" onclick="clearCurCust()">✕</button>`;
  }
  window.clearCurCust = () => { curCust = null; renderCart(); };
  // سفري قيد التحضير: نفس التعبئة التلقائية
  window.openHold = () => {
    if (!cart.length) return;
    const d = curCust && curCust.data;
    acDialog('🍳 حفظ الطلب قيد التحضير', 'يبقى بالكاشير لحد ما تحوله للكابتن أو يستلمه الزبون', [
      { id: 'name', label: 'اسم الزبون (اختياري)', ph: 'مثال: أبو علي', value: (d && d.name) || (curCust && curCust.label) || '' },
      { id: 'phone', label: 'رقم الهاتف (اختياري)', type: 'tel', ph: '07xxxxxxxxx', value: curCust ? curCust.phone : '' },
      { id: 'note', label: 'ملاحظة للمطبخ (اختياري)', ph: 'بدون بصل...' },
    ], (v) => { holdOrder({ name: v.name.trim(), phone: v.phone.trim(), note: v.note.trim() }); }, '🍳 حفظ وطباعة تذكرة المطبخ');
  };

  // ══════════ المكالمات الواردة (توكن جوكر) ══════════
  const calls = new Map();      // id -> {id, number, line, data, at}
  let callsReady = false, callRingT = null, ringingNow = new Set();
  const CALL_TTL = () => window.__callTtl || 120000;   // البطاقة تختفي بعد دقيقتين
  // كل رقم للمطعم يرن عند كاشيريته (صاحب المطعم يختار من لوحة الإدارة ← الكاشير ← «أرقام المطعم اللي ترن عنده»)
  //  perms.lines = ['1','3'] ← خط ١ و٣ بس (الشريحة والواتساب). بدون تحديد ← كل الأرقام
  const callLineNo = (l) => String(l || '').replace(/^\s*(واتساب|whatsapp)\s*/i, '').trim();
  const lineMine = (l) => {
    const u = window.posUser, ls = u && u.role === 'cashier' && (u.perms || {}).lines;
    return !Array.isArray(ls) || ls.map(String).includes(callLineNo(l));
  };
  const callMissed = (id) => { if (!id || String(id).startsWith('lan-')) return; fb().updateDoc(fb().doc(fb().db, 'incomingCalls', id), { status: 'missed' }).catch(() => {}); };
  function listenCalls() {
    const f = fb();
    callsReady = false; calls.clear(); renderCalls();
    unsubs.push(f.onSnapshot(f.query(f.collection(f.db, 'incomingCalls'), f.where('restaurantId', '==', rid()), f.where('status', '==', 'ringing')), (s) => {
      ringingNow = new Set(s.docs.map((d) => d.id));
      if (!callsReady) {                                 // مكالمات قديمة قبل فتح الكاشير لا تُعرض
        callsReady = true;
        // اللي بقت «ترن» بعد ٣ دقايق أكيد فاتت ← «فائتة» (وما ننزعج بيها بكل فتحة)
        const old = s.docs.map((d) => d.id);
        if (old.length) setTimeout(() => old.filter((id) => ringingNow.has(id)).slice(0, 200).forEach(callMissed), CALL_TTL() + 60000);
        return;
      }
      s.docChanges().forEach((ch) => {
        if (ch.type === 'added') {
          const c = { id: ch.doc.id, ...ch.doc.data(), at: Date.now(), data: undefined };
          if (!feat(/(واتس|whats)/i.test(c.line || '') ? 'whatsapp' : 'calls')) return;
          if (!myPerm('oDeliv')) return;   // الاتصالات لكاشير الدلفري بس (كاشير الصالة ما يرن عنده)
          if (!lineMine(c.line)) return;    // رقم مخصص لكاشير ثاني
          // واتساب يحدّث إشعار المكالمة أكثر من مرة: نفس الرقم ونفس الخط خلال دقيقة = بطاقة واحدة
          const dup = [...calls.values()].find((x) => x.number === c.number && x.line === c.line && c.at - x.at < 60000);
          if (dup) { dup.at = c.at; if (dup.lanId && !dup.fsId) dup.fsId = c.id; return; }   // وصلت من الواي فاي قبل

          calls.set(c.id, c);
          getCustomer(c.number).then((d) => { const x = calls.get(c.id); if (x) { x.data = d; renderCalls(); } });
          notifyCall(c);
        } else if (ch.type === 'removed') { calls.delete(ch.doc.id); calls.forEach((x, k) => { if (x.fsId === ch.doc.id) calls.delete(k); }); }     // استلمها كاشير آخر
      });
      renderCalls();
    }, (e) => console.warn('calls', e.code)));
  }
  function ringCall() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .25, .5].forEach((d) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = d === .25 ? 660 : 880;
        g.gain.setValueAtTime(.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.4, ctx.currentTime + d + .03); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d + .22); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .24); });
    } catch (e) {}
  }
  function notifyCall(c) {
    ringCall();
    clearInterval(callRingT);
    let n = 0; callRingT = setInterval(() => { if (!calls.size || ++n > 8) { clearInterval(callRingT); return; } ringCall(); }, 2500);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => r && r.showNotification('📞 مكالمة واردة — خط ' + (c.line || ''), { body: c.number, tag: 'call-' + c.id, dir: 'rtl', lang: 'ar', requireInteraction: true }));
    }
  }
  // واتساب يرسل أحياناً اسم جهة الاتصال بدل الرقم: نعرض النص كما هو إذا لم يكن رقماً
  const callPhone = (c) => { const k = phoneKey(c.number); return k.length >= 7 ? k : ''; };
  const callLabel = (c) => callPhone(c) || String(c.number || '').trim() || '—';
  function renderCalls() {
    const el = $('callsBox'); if (!el) return;
    // تختفي تلقائياً بعد دقيقتين
    [...calls.values()].forEach((c) => { if (Date.now() - c.at > CALL_TTL()) { calls.delete(c.id); callMissed(c.fsId || c.id); } });
    el.innerHTML = [...calls.values()].sort((a, b) => b.at - a.at).slice(0, 4).map((c) => `
      <div class="call-card">
        <div class="call-top"><span class="call-pulse">📞</span> مكالمة واردة <span class="call-line">خط ${esc(c.line || '—')}</span>
          <button type="button" class="call-x" title="إخفاء" onclick="callHide('${esc(c.id)}')">✕</button></div>
        <button type="button" class="call-num" onclick="callTake('${esc(c.id)}')" dir="auto">${esc(callLabel(c))}</button>
        <div class="call-info">${c.data === undefined ? '⏳ جاري البحث عن الزبون…' : custSummary(c.data)}</div>
        <div class="call-btns">
          <button type="button" class="call-go" onclick="callTake('${esc(c.id)}')">✅ استلام وتعبئة</button>
          ${c.data && (c.data.lastItems || []).length ? `<button type="button" onclick="callTake('${esc(c.id)}',true)">🔁 كرر آخر طلب</button>` : ''}
        </div>
      </div>`).join('');
  }
  setInterval(() => { if (calls.size) renderCalls(); }, Math.min(15000, CALL_TTL()));
  // مكالمة من تلفون الخط عن طريق الواي فاي (تشتغل حتى لو النت مقطوع) — نفس بطاقة المكالمة، والمكرر من النت يندمج وياها
  function callIn(x) {
    const c = { id: 'lan-' + x.lanId, lanId: x.lanId, number: x.number, line: x.line, at: Date.now(), data: undefined };
    if (!feat(/(واتس|whats)/i.test(c.line || '') ? 'whatsapp' : 'calls')) return;
    if (!myPerm('oDeliv') || !lineMine(c.line)) return;
    const dup = [...calls.values()].find((y) => y.number === c.number && y.line === c.line && c.at - y.at < 60000);
    if (dup) { if (!dup.lanId) dup.lanId = c.lanId; return; }
    calls.set(c.id, c);
    getCustomer(c.number).then((d) => { const y = calls.get(c.id); if (y) { y.data = d; renderCalls(); } });
    notifyCall(c);
    renderCalls();
  }
  // كاشير ثاني استلمها (بالواي فاي)
  function callTakenElsewhere(d) {
    let n = 0;
    calls.forEach((c, k) => { if ((d.id && c.lanId === d.id) || (d.number && c.number === d.number && (c.line || '') === (d.line || ''))) { calls.delete(k); n++; } });
    if (n) { if (!calls.size) clearInterval(callRingT); renderCalls(); }
  }
  // انطفى الدلفري على هذا الكاشير (أو انشال رقمه منه): تختفي المكالمات الظاهرة ويوكف الرنين
  window.callsPermSync = () => {
    if (!calls.size) return;
    calls.forEach((c, k) => { if (!myPerm('oDeliv') || !lineMine(c.line)) calls.delete(k); });
    if (!calls.size) clearInterval(callRingT);
    renderCalls();
  };
  window.callHide = (id) => { calls.delete(id); renderCalls(); };
  window.callTake = async (id, repeat) => {
    const c = calls.get(id); if (!c) return;
    calls.delete(id); clearInterval(callRingT); renderCalls();
    const fid = c.fsId || (String(id).startsWith('lan-') ? '' : id);
    if (fid) fb().updateDoc(fb().doc(fb().db, 'incomingCalls', fid), { status: 'taken', takenBy: deviceId, takenAtMs: Date.now() }).catch(() => {});
    // الكاشيرية الثانين على نفس الواي فاي تختفي عندهم (حتى بدون نت)
    const L = lanApi(); if (L && lanOn) L.broadcast({ t: 'taken', id: c.lanId || '', number: c.number, line: c.line || '' });
    const d = c.data === undefined ? await getCustomer(c.number) : c.data;
    curCust = { phone: callPhone(c), label: callPhone(c) ? '' : callLabel(c), data: d };
    goTab('cashier');
    if (repeat) repeatLast();
    renderCart();
    if (window.matchMedia('(max-width:600px)').matches && repeat) document.querySelector('.cside').classList.add('open');
    toast(d ? '👤 ' + (d.name || 'الزبون') + ' — اختر الأصناف ثم «ترحيل» والمعلومات معبّأة' : '🆕 زبون جديد — الرقم معبّأ تلقائياً');
  };

  // ══════════ شبكة المطعم (بنت أو بدون نت) ══════════
  // هذا الجهاز «مركز» على الواي فاي (برنامج الحاسبة وتطبيق الأندرويد): شاشة المطبخ/المجهز وشاشة «طلبك جاهز» وتلفون الخط يتصلون بيه
  //  للشاشات: نسخة خفيفة من طلبات اليوم (بدون أرقام وعناوين الزبائن) تتحدث أول بأول. ومنها: «جاهز» من المطبخ، والمكالمات من الخط.
  //  اللي يتغير بدون نت ينحفظ بهذا الجهاز ويترفع للسحابة وحده من يرجع النت
  const lanApi = () => (window.SoraLan && window.SoraLan.role === 'hub' ? window.SoraLan : null);
  let lanOn = false, lanBound = false, lanSent = new Map(), lanPushT = 0, lanSt = null, lanGen = 0;
  let lanFw = null, lanFwT = 0, lanFwHide = false;   // جدار حماية ويندوز (برنامج الكاشير)
  const lanSeen = new Set();
  const LAN_F = ['orderType', 'ticketNo', 'salonNum', 'holdNum', 'pager', 'tableNo', 'createdAt', 'createdAtMs', 'day', 'status', 'kitchen', 'kitchenReadyAt',
    'readyAt', 'kSec', 'kitchenSecDoneAt', 'note', 'captainId', 'servedAtMs', 'pagerDone', 'held', 'restaurantId'];
  const lanOrder = (o) => {
    const x = { id: o.id };
    LAN_F.forEach((k) => { if (o[k] !== undefined && o[k] !== null) x[k] = o[k]; });
    x.items = (o.items || []).map((i) => ({ name: i.name, qty: i.qty, variant: i.variant, note: i.note, sec: i.sec }));
    return x;
  };
  const lanList = () => orders.filter((o) => Date.now() - (o.createdAtMs || 0) < 36 * 3600000).map(lanOrder);
  const lanSettings = () => ({ sections: settings.sections || [], kSecOn: !!settings.kSecOn, receiptTitle: settings.receiptTitle || '', screen: settings.screen || null });
  const lanRest = () => ({ name: (restData && restData.name) || '', features: (restData && restData.features) || {}, svcOff: (restData && restData.svcOff) || {} });
  const lanName = () => String((window.posUser && window.posUser.name) || 'الكاشير').slice(0, 40);
  const toScreens = (m) => { const L = lanApi(); if (L && lanOn) { L.send('role:kitchen', m); L.send('role:screen', m); } };
  const lanFull = (to) => { const L = lanApi(); if (L && lanOn) L.send(to, { t: 'state', full: 1, orders: lanList(), settings: lanSettings(), rest: lanRest(), hub: { name: lanName() } }); };
  function lanPush() {
    const list = lanList(), now = new Map(list.map((o) => [o.id, JSON.stringify(o)]));
    const ch = list.filter((o) => lanSent.get(o.id) !== now.get(o.id)), del = [...lanSent.keys()].filter((id) => !now.has(id));
    lanSent = now;
    if (ch.length || del.length) toScreens({ t: 'state', orders: ch, del });
  }
  window.posLanOrders = () => { if (!lanOn) return; clearTimeout(lanPushT); lanPushT = setTimeout(lanPush, 250); };
  function lanSettingsPush() { toScreens({ t: 'state', settings: lanSettings() }); }
  // «جاهز» من شاشة المطبخ (بدون نت): نفس اللي يسويه المطبخ بالنت
  async function lanReady(o) {
    const t = Date.now(), fields = { kitchen: 'ready', kitchenReadyAt: o.kitchenReadyAt || t };
    if (o.kSec) fields.kSec = Object.fromEntries(Object.entries(o.kSec).map(([k, v]) => [k, { ...v, readyAt: v.readyAt || t }]));
    if (o.status === 'preparing') await orderUpdate(o.id, { ...fields, status: 'ready', readyAt: t }, 'الطلب جاهز للاستلام', 'ready');
    else await fb().updateDoc(fb().doc(fb().db, 'orders', o.id), fields);
  }
  async function lanAct(ev) {
    const d = ev.d, L = lanApi(), reply = (ok) => { if (L) L.send(ev.id, { t: 'ack', rq: d.rq, ok }); };
    const o = orders.find((x) => x.id === d.id);
    if (!o || ev.role !== 'kitchen') return reply(false);
    try {
      if (d.op === 'ready') await lanReady(o);
      else if (d.op === 'sec' && o.kSec && o.kSec[d.sec]) {
        const ks = { ...o.kSec, [d.sec]: { ...o.kSec[d.sec], readyAt: d.on ? (o.kSec[d.sec].readyAt || Date.now()) : 0 } };
        const all = Object.values(ks).every((v) => v.readyAt);
        if (all && !featOn('kitchen')) await lanReady({ ...o, kSec: ks });   // ماكو مجهز ← جاهز
        else await fb().updateDoc(fb().doc(fb().db, 'orders', o.id), all ? { kSec: ks, kitchenSecDoneAt: Date.now() } : { kSec: ks });
      } else return reply(false);
      reply(true);
    } catch (e) { reply(false); }
  }
  function lanCall(d) {
    if (!d || d.t !== 'call' || !d.id || lanSeen.has(d.id)) return;
    lanSeen.add(d.id);
    if (lanSeen.size > 300) lanSeen.delete(lanSeen.values().next().value);
    callIn({ lanId: String(d.id).slice(0, 64), number: String(d.number || '').slice(0, 24), line: String(d.line || '').slice(0, 30) });
  }
  function onLan(ev) {
    if (!ev || !restData) return;
    if (ev.t === 'status') { lanSt = ev; lanOn = !!ev.on; lanUi(); return; }
    if (ev.t === 'join' || ev.t === 'leave') { const L = lanApi(); if (L) Promise.resolve(L.status()).then((st) => { if (st) { lanSt = st; lanUi(); } }); return; }
    if (ev.t === 'msg' && ev.d) {
      const d = ev.d;
      if (d.t === 'sync' && (ev.role === 'kitchen' || ev.role === 'screen')) return lanFull(ev.id);
      if (d.t === 'act') { lanAct(ev); return; }
      if (d.t === 'call' && ev.role === 'line') { lanCall(d); const L = lanApi(); if (L) L.send(ev.id, { t: 'ack', rq: d.id, ok: true }); }
      return;
    }
    if (ev.t === 'ev' && ev.d) {
      if (ev.d.t === 'call') lanCall(ev.d);
      else if (ev.d.t === 'taken') callTakenElsewhere(ev.d);
    }
  }
  const newLanKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  // الرمز السري للمطعم (lan/key): كل أجهزة المطعم تتصافح بيه. يسويه صاحب المطعم أو كاشير عنده صلاحية الإعدادات
  async function lanKeyFromCloud(r) {
    const s = await fb().getDoc(sub('lan', 'key'));
    if (s.exists() && s.data().key) return s.data().key;
    if (!(isOwnerPOS() || can('settings'))) return '';
    const ref = sub('lan', 'key');
    return fb().runTransaction(fb().db, async (tx) => {
      const x = await tx.get(ref);
      if (x.exists() && x.data().key) return x.data().key;
      const key = newLanKey();
      tx.set(ref, { key, atMs: Date.now() });
      return key;
    });
  }
  async function lanStart() {
    const L = lanApi(); if (!L || !restData) return;
    if (!lanBound) { lanBound = true; L.on(onLan); }
    const r = rid(), g = ++lanGen;
    unsubs.push(() => { if (g !== lanGen) return; lanGen++; lanOn = false; lanSt = null; clearTimeout(lanFwT); lanFw = null; lanFwBar(); L.stop(); });   // تسجيل خروج
    const run = async (key) => {
      if (!key || g !== lanGen || r !== rid()) return;
      lsSet('pos_lan_' + r, key);
      lanSt = await L.start({ rid: r, key, dev: deviceId, name: lanName() });
      lanOn = !!(lanSt && lanSt.on);
      lanSent = new Map();
      // الشاشات المتصلة من قبل (الصفحة انفتحت من جديد): نسخة كاملة
      if (lanOn) { lanFull('role:kitchen'); lanFull('role:screen'); lanPush(); lanFwCheck(); }
      lanUi();
    };
    const cached = lsGet('pos_lan_' + r, '');
    if (cached) await run(cached);   // بدون نت: نشتغل فوراً بالرمز المحفوظ
    try {
      const key = await lanKeyFromCloud(r);
      if (key && key !== cached) await run(key);
      else if (!key && !cached && g === lanGen) { lanSt = { on: false, err: 'نحتاج صاحب المطعم يفتح الكاشير أو لوحة الإدارة مرة وحدة بالنت' }; lanUi(); }
    } catch (e) { if (!cached && g === lanGen) { lanSt = { on: false, err: 'أول تشغيل يحتاج نت' }; lanUi(); } }
  }
  const ROLE_N = { kitchen: '👨‍🍳 شاشة مطبخ', screen: '📺 شاشة طلبك جاهز', line: '📞 خط المطعم' };
  function lanCardHtml() {
    if (!lanApi()) {
      // الكاشير بالمتصفح: الشاشات ما تكدر تتصل بيه — بدون نت يحتاج برنامج الكاشير
      const a = appOffer();
      return `<div class="sh-card"><div class="sh-title">🛜 شبكة المطعم (بنت أو بدون نت)</div>
        <div class="ac-sub" style="line-height:1.8">⚠️ هذا الكاشير مفتوح بالمتصفح، فإذا انقطع النت الطلبات ما توصل لشاشة المطبخ والمجهز و«طلبك جاهز». حتى يشتغل بدون نت شغّل ${a ? `<a href="${a.url}" target="_blank" rel="noopener">${esc(a.label)}</a>` : 'برنامج الكاشير'} بدل المتصفح.</div></div>`;
    }
    return `<div class="sh-card"><div class="sh-title">🛜 شبكة المطعم (بنت أو بدون نت)</div><div id="lanBox">${lanBoxHtml()}</div>
      <div class="ac-sub" style="line-height:1.8;margin-top:6px">شاشة المطبخ والمجهز وشاشة «طلبك جاهز» وتلفون الخط يتصلون بهذا الجهاز على نفس الواي فاي — إذا انقطع النت تبقى الطلبات و«جاهز» والاتصالات تمشي، ومن يرجع النت كلشي يترفع وحده.</div></div>`;
  }
  function lanBoxHtml() {
    const st = lanSt || {};
    if (!st.on) return `<div class="ac-sub">⏳ ${esc(st.err || 'جاري التشغيل…')}</div>`;
    const peers = st.peers || [];
    const fw = lanFw && lanFw.ok === false
      ? `<div class="ac-sub" style="color:#ef4444;line-height:1.8;margin-top:6px">⛔ جدار حماية ويندوز يمنع الشاشات توصل لهذا الجهاز</div>
        <button type="button" class="btn-soft" style="width:100%;margin-top:6px" onclick="lanFwFix()">🛡️ اسمح للشاشات توصل (ضغطة وحدة)</button>`
      : lanFw && lanFw.ok && !lanFw.na ? '<div class="ac-sub">🛡️ جدار الحماية: مسموح</div>' : '';
    return `<div class="ac-sub">✅ شغّالة${(st.ips || []).length ? ' — عنوان هذا الجهاز: <b dir="ltr">' + esc(st.ips[0]) + '</b>' : ''}</div>${fw}
      ${peers.length ? peers.map((x) => `<div class="ac-sub">🟢 ${esc(ROLE_N[x.role] || x.role)}${x.name ? ' — ' + esc(x.name) : ''}</div>`).join('')
        : `<div class="ac-sub">ماكو أجهزة متصلة هسه</div><div class="ac-sub" style="line-height:1.8">إذا شاشة ما تتصل: لازم تكون تطبيق «سرعة - المطبخ» أو تطبيق الشاشة (مو المتصفح)، وعلى نفس الواي فاي، وانفتحت مرة وحدة بالنت.</div>`}`;
  }
  function lanUi() { const b = $('lanBox'); if (b) b.innerHTML = lanBoxHtml(); lanFwBar(); }
  // جدار حماية ويندوز (برنامج الكاشير): يفحص إذا يمنع الشاشات، وشريط تنبيه حتى لو الكاشير ما فتح الإعدادات
  function lanFwCheck() {
    const L = lanApi(); if (!L || !L.fw) return;
    clearTimeout(lanFwT); lanFwT = setTimeout(lanFwCheck, 10 * 60000);
    Promise.resolve(L.fw()).then((r) => { lanFw = r || null; lanUi(); }, () => {});
  }
  function lanFwBar() {
    let b = $('lanFwBar');
    if (!(lanOn && lanFw && lanFw.ok === false) || lanFwHide) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div');
    b.id = 'lanFwBar';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9000;max-width:360px;background:#7f1d1d;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:14px;line-height:1.7';
    b.innerHTML = `<div>⛔ جدار حماية ويندوز يمنع شاشة المطبخ والمجهز و«طلبك جاهز» توصل لهذا الجهاز — إذا انقطع النت ما توصلها الطلبات</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn-soft" style="flex:1" onclick="lanFwFix()">🛡️ اسمح بضغطة</button><button type="button" class="btn-soft" onclick="lanFwLater()">لاحقاً</button></div>`;
    document.body.appendChild(b);
  }
  window.lanFwLater = () => { lanFwHide = true; lanFwBar(); };
  window.lanFwFix = async () => {
    const L = lanApi(); if (!L || !L.fwFix) return;
    toast('🛡️ ويندوز راح يسألك «تسمح لهذا التطبيق يسوي تغييرات؟» — اضغط «نعم»');
    const r = await Promise.resolve(L.fwFix()).catch(() => null);
    if (r) lanFw = r;
    lanUi();
    toast(r && r.ok ? '✅ تم — الشاشات تكدر توصل لهذا الجهاز حتى بدون نت'
      : r && r.refused ? '❌ انضغط «لا» — عيدها واضغط «نعم»'
      : '⚠️ ما تأكدنا — إذا عندك برنامج حماية ثاني (مكافح فيروسات) اسمح لبرنامج سرعة بيه');
  };

  // السلة على الهاتف: تفتح وتغلق بلمسة على رأسها
  $('cartHead').addEventListener('click', () => { if (window.matchMedia('(max-width:600px)').matches) document.querySelector('.cside').classList.toggle('open'); });

  // ══════════ اختصارات لوحة المفاتيح ══════════
  $('prodSearch').addEventListener('input', (e) => { prodQuery = e.target.value.trim(); renderMenu(); });
  document.addEventListener('keydown', (e) => {
    if (!restData) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
    if (e.key === 'Escape') {
      ['payOv', 'acOv', 'viewOv', 'typeOv', 'delivOv'].forEach((id) => $(id) && $(id).classList.remove('on'));
      $('varOv').classList.remove('on');
      if (e.target === $('prodSearch')) clearProdSearch();
      return;
    }
    if ($('payOv').classList.contains('on') && e.key === 'Enter') { e.preventDefault(); confirmPay(); return; }
    if ($('typeOv').classList.contains('on') && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); pickType(['salon', 'quick', 'takeaway', 'delivery'][+e.key - 1]); return; }
    if ($('varOv').classList.contains('on') && e.key === 'Enter') { e.preventDefault(); addToCart(); return; }
    if (e.key === 'F9') { e.preventDefault(); if (cart.length) { goTab('cashier'); openOrderType(); } return; }
    if (!typing && (e.key === '/' || e.key === 'F2')) { e.preventDefault(); goTab('cashier'); $('prodSearch').focus(); }
  });

  // ══════════ المنيو الأونلاين وطلبات QR ══════════
  // الزبون يمسح QR الطاولة أو يفتح رابط المطعم من البيت ويطلب (menu.html) — الطلب يوصل هنا فوراً وينطبع بالمطبخ.
  // المنيو المنشور نسخة عامة بدون كلفة ولا مخزون (publicMenus/{rid})، والطلبات بـ webOrders، والأسعار دائماً من منيو الكاشير.
  const SITE = /^https?:$/.test(location.protocol) ? new URL('./', location.href.split(/[?#]/)[0]).href : 'https://qaesartools-web.github.io/sora3a-rest2/';
  const ONLINE_DEF = { on: false, viewOnly: false, table: true, pickup: true, delivery: false, autoTable: false, note: '' };
  const onlineCfg = () => ({ ...ONLINE_DEF, ...(settings.online || {}) });
  // شاشة «طلبك جاهز»: الصالة بدون بيجر تطلع افتراضياً، والدلفري لا
  const scrCfg = () => ({ salon: true, delivery: false, qr: true, ...(settings.screen || {}) });
  const onlineOk = () => feat('online') && onlineCfg().on;
  const menuLink = (t) => SITE + 'menu.html?r=' + encodeURIComponent(rid() || '') + (t ? '&t=' + encodeURIComponent(t) : '');
  window.menuLink = menuLink;
  // الجهاز اللي يقبل الطلبات التلقائية ويطبعها (الافتراضي: جهاز الكاشير، مو التلفون)
  const webAutoKey = () => 'pos_web_auto_' + rid();
  const webAutoDev = () => lsGet(webAutoKey(), !window.matchMedia('(max-width:600px)').matches);
  const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; };

  // ── نشر المنيو للزبائن ──
  let pubT = null, pubBusy = false, pubAgain = false;
  const pubSoon = () => { clearTimeout(pubT); pubT = setTimeout(() => publishMenu(false), 1500); };
  function publicMenuDoc() {
    const oc = onlineCfg();
    const cats = menu.filter((c) => c && c.cat && (c.items || []).length).slice(0, 80).map((c) => ({
      cat: String(c.cat).slice(0, 40), emoji: c.emoji || '',
      items: c.items.slice(0, 200).map((p) => {
        const x = { name: p.name, variants: (p.variants || []).map((v) => ({ name: v.name, price: Number(v.price) || 0 })) };
        if (p.imgId && p.img) x.imgId = p.imgId;
        if (typeof p.stock === 'number' && p.stock <= 0) x.out = true;
        return x;
      }),
    }));
    return {
      name: String(settings.receiptTitle || restData.name || '').slice(0, 80), area: String(settings.receiptSub || restData.area || '').slice(0, 120),
      phone: String(settings.receiptPhone || restData.phone || '').slice(0, 30), on: !!oc.on && feat('online'),
      // «عرض المنيو بس»: الزبون يتصفح والمتوفر يبين، بدون طلب (كل طرق الطلب مطفية)
      modes: oc.viewOnly ? { table: false, pickup: false, delivery: false } : { table: !!oc.table, pickup: !!oc.pickup, delivery: !!oc.delivery && feat('captain') },
      fee: Number(settings.defaultFee) || 0, tables: Number(settings.tables) || 0, note: String(oc.note || '').slice(0, 300), autoTable: !!oc.autoTable, cats,
      ...pubHours(),
    };
  }
  // ساعات الدوام: خارجها الزبون يتصفح المنيو بس (menu.html)
  function pubHours() {
    const h = restData && restData.hours;
    return h && h.on && Number.isInteger(h.open) && Number.isInteger(h.close) && h.open !== h.close ? { hours: { on: true, open: h.open, close: h.close } } : {};
  }
  async function publishMenu(force) {
    if (!rid() || !restData) return;
    if (pubBusy) { pubAgain = true; return; }
    const sigKey = 'pos_pubsig_' + rid();
    // المطاعم اللي ما شغّلت الخدمة ما ننشر لها شي
    if (!force && !onlineCfg().on && !lsGet(sigKey, '')) return;
    const d = publicMenuDoc(), sig = hashStr(JSON.stringify(d));
    if (!force && lsGet(sigKey, '') === sig) return;
    const f = fb(), myRid = rid(), imgKey_ = 'pos_pubimg_' + myRid, sent = lsGet(imgKey_, {});
    pubBusy = true;
    try {
      // الصور أولاً (كل صورة مرة وحدة) حتى يلگاها الزبون وية المنيو
      for (const c of menu) for (const p of (c.items || [])) {
        if (!p.imgId || !p.img || sent[p.imgId] === imgSig(p.img) || p.img.length >= 300000) continue;
        try { await f.setDoc(f.doc(f.db, 'publicMenus', myRid, 'img', p.imgId), { data: p.img, updatedAtMs: Date.now() }); sent[p.imgId] = imgSig(p.img); }
        catch (e) { console.warn('pub img', e.code); }
      }
      lsSet(imgKey_, sent);
      try { await f.setDoc(f.doc(f.db, 'publicMenus', myRid), { ...d, updatedAtMs: Date.now() }); }
      catch (e) {
        // قواعد قديمة ما تعرف «hours» بعد ← ننشر المنيو بدونها حتى ما يوقف
        if (!(d.hours && e && e.code === 'permission-denied')) throw e;
        const { hours, ...d2 } = d; await f.setDoc(f.doc(f.db, 'publicMenus', myRid), { ...d2, updatedAtMs: Date.now() });
      }
      lsSet(sigKey, sig);
    } catch (e) { console.warn('publish menu', e.code || e); }
    finally { pubBusy = false; if (pubAgain) { pubAgain = false; pubSoon(); } }
  }
  window.publishMenu = publishMenu;

  // ══════════ تسديد طلبات الكابتن ══════════
  // الكابتن ياخذ طلب (أو أكثر) ويستلم المبلغ من الزبون — أجرة التوصيل إله — ولما يرجع يسدد قيمة كل طلب للكاشير.
  // كل طلب دلفري ينحفظ capSettled:false، و«✅ تم التسديد» يخليه true فينشال من التبويب وينقص من المجموع.
  let capDue = [];
  function listenCapPay() {
    const f = fb(); capDue = []; renderCapPay();
    unsubs.push(f.onSnapshot(f.query(f.collection(f.db, 'orders'), f.where('restaurantId', '==', rid()), f.where('capSettled', '==', false)), (s) => {
      capDue = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => o.captainId && o.status !== 'cancelled' && !capPaidHere(o))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      renderCapPay();
    }, (e) => console.warn('cap pay', e.code)));
  }
  const CAP_ST = { pending: 'ينتظر الكابتن', accepted: 'وافق الكابتن', pickup: 'بالمطعم', delivering: 'بالطريق', delivered: 'وصل للزبون', ready: 'جاهز', preparing: 'يتحضر' };
  function renderCapPay() {
    ['capPayPillD', 'capPayPillM'].forEach((id) => { const p = $(id); if (p) { p.textContent = capDue.length; p.classList.toggle('on', capDue.length > 0); } });
    const el = $('capPayBody'); if (!el) return;
    const total = capDue.reduce((s, o) => s + (Number(o.value) || 0), 0);
    if (!capDue.length) { el.innerHTML = '<div class="sh-card"><div class="sh-title">💵 تسديد طلبات الكابتن</div><div class="ac-sub">✅ ماكو طلبات تنتظر التسديد — كل الكباتن مسددين.</div></div>'; return; }
    const by = new Map();
    capDue.forEach((o) => { const k = o.captainId; if (!by.has(k)) by.set(k, { name: o.captainName || 'كابتن', list: [] }); by.get(k).list.push(o); });
    el.innerHTML = `<div class="sh-card cp-total"><div><div class="sh-title" style="margin:0">💵 المجموع الكلي عند الكباتن</div>
        <div class="ac-sub">${toA(capDue.length)} طلب — قيمة الطلبات بدون أجرة التوصيل (الأجرة للكابتن)</div></div><b id="capPayTotal">${money(total)}</b></div>`
      + [...by.values()].map((g) => {
        const sum = g.list.reduce((s, o) => s + (Number(o.value) || 0), 0);
        return `<div class="sh-card" data-cap-group="${esc(g.name)}"><div class="cp-cap"><div class="sh-title">🛵 ${esc(g.name)}</div><small>${toA(g.list.length)} طلب • ${money(sum)}</small></div>`
          + g.list.map((o) => `<div class="cp-row" data-cap-order="${esc(o.id)}"><div class="cp-i"><b>#${esc(String(kNum(o)))}</b> ${esc(o.customer || '')}
              <small>${o.address ? '📍 ' + esc(String(o.address).slice(0, 60)) + ' • ' : ''}<span class="cp-st ${o.status === 'delivered' ? 'done' : ''}">${esc(CAP_ST[o.status] || o.status || '')}</span>${o.fee ? ' • أجرة ' + money(o.fee) : ''}</small></div>
              <div class="cp-amt">${money(o.value || 0)}</div>
              <button type="button" class="btn-main" onclick="capSettle('${esc(o.id)}')">✅ تم التسديد</button></div>`).join('')
          + '</div>';
      }).join('');
  }
  window.capSettle = async (id) => {
    const o = capDue.find((x) => x.id === id); if (!o) return;
    capDue = capDue.filter((x) => x.id !== id); renderCapPay();            // ينشال فوراً وينقص من المجموع
    try {
      await fb().updateDoc(fb().doc(fb().db, 'orders', id), { capSettled: true, capSettledAtMs: Date.now(), capSettledShift: shift ? shift.id : null,
        capSettledBy: String((window.posUser && (window.posUser.name || window.posUser.email)) || '').slice(0, 80) });
      // المبلغ ينحسب بالدرج (النقد المتوقع بالوردية وتقرير الإغلاق)
      const amt = Number(o.value) || 0;
      if (shift && amt > 0) {
        const mv = { type: 'cap', amount: amt, note: (o.captainName || 'كابتن') + ' — #' + kNum(o), ts: Date.now(), orderId: o.id };
        shift.cashMoves = [...(shift.cashMoves || []), mv];
        fb().updateDoc(sub('shifts', shift.id), { cashMoves: fb().arrayUnion(mv) }).catch(() => {});
      }
      toast('✅ تم تسديد #' + kNum(o) + ' — ' + money(o.value || 0) + ' من ' + (o.captainName || 'الكابتن') + (shift ? '' : ' • ⚠️ ماكو وردية مفتوحة — المبلغ ما ينحسب بالدرج'));
    } catch (e) { toast('❌ ما انحفظ التسديد — تأكد من الإنترنت'); capDue.push(o); capDue.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)); renderCapPay(); }
  };

  // ── استلام الطلبات ──
  const webs = new Map();            // طلبات جديدة بانتظار القبول
  const webBusy = new Set(), webGone = new Set();   // webGone: انقبل أو انرفض من هذا الجهاز
  let webAttach = null, webRingT = null, webSt = null;
  const WEB_MODE = { table: '🪑 طاولة', pickup: '🛍️ استلام', delivery: '🏍️ توصيل' };
  // طلبات الويتر: دائماً تطلع للكاشير بتنبيه وتنتظر موافقته («قبول وإرسال للمطبخ»). التلقائي بس لطلبات QR الطاولات إذا مفعّل
  // كل كاشير يشوف الطلبات الأونلاين اللي من اختصاصه: التوصيل لكاشير الدلفري، الطاولات (QR والويتر) لكاشير الصالة، الاستلام لسفري قيد التحضير
  //   (الويتر وQR الطاولة ← الصالة؛ QR الاستلام (منها شاشة «طلبك جاهز») ← السفري)
  const webMine = (w) => (w.mode === 'delivery' ? myPerm('oDeliv') : w.mode === 'table' ? myPerm('oSalon') : myPerm('oHold') || myPerm('oTake'));
  const webVisible = () => [...webs.values()].filter(webMine);
  const webAutoOk = (w) => webAutoDev() && w.source !== 'waiter' && w.mode === 'table' && onlineCfg().autoTable;
  function listenWeb() {
    const f = fb();
    webs.clear(); renderWeb();
    unsubs.push(f.onSnapshot(f.query(f.collection(f.db, 'webOrders'), f.where('restaurantId', '==', rid()), f.where('status', '==', 'new')), (s) => {
      let fresh = false;
      s.docChanges().forEach((ch) => {
        if (ch.type === 'removed') { webs.delete(ch.doc.id); return; }
        const w = { id: ch.doc.id, ...ch.doc.data() };
        // نسخة محلية قديمة (الكاش يرجّع الطلب «جديد» لحظياً بعد ما نحدّث مرحلته): مو طلب جديد
        if (webGone.has(w.id) || ch.doc.metadata.hasPendingWrites || w.acceptedBy || w.stage || w.orderId) { webs.delete(w.id); return; }
        if (Date.now() - (w.createdAtMs || 0) > 3 * 3600000) return;     // طلب قديم ما انقبل: ما نزعج الكاشير بيه
        // كل الطلبات تنحفظ، بس اللي من اختصاص هذا الكاشير تطلع وترن (وتتحدث فوراً إذا تغيّرت صلاحياته)
        const mine = webMine(w);
        if (mine && !webs.has(w.id) && !webAutoOk(w)) { fresh = fresh || w; if (w.source === 'waiter') toast('🧑‍🍳 طلب من ' + (w.waiter || 'الويتر') + ' — ' + webWhere(w) + ' — اقبله يروح للمطبخ'); }
        webs.set(w.id, w);
        if (mine && webAutoOk(w)) setTimeout(() => webAccept(w.id, true), 0);
      });
      renderWeb();
      if (fresh) notifyWeb(fresh);
    }, (e) => console.warn('web orders', e.code)));
  }
  // الأسعار والأصناف من منيو الكاشير — الصنف اللي مو موجود ما ينحسب
  function webItems(w) {
    const out = [];
    (w.items || []).slice(0, 40).forEach((i) => {
      let p = null;
      menu.forEach((c) => (c.items || []).forEach((x) => { if (!p && x.name === i.name) p = x; }));
      if (!p) return;
      const vs = p.variants || [], v = vs.find((x) => x.name === i.variant) || (vs.length === 1 ? vs[0] : null);
      if (!v) return;
      const it = { name: p.name, variant: v.name, price: Number(v.price) || 0, qty: Math.max(1, Math.min(99, Math.round(num(i.qty)) || 1)) };
      if (i.note) it.note = String(i.note).slice(0, 80);
      out.push(it);
    });
    return out;
  }
  function webChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [784, 988, 1175].forEach((hz, i) => { const d = i * .16, o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'triangle'; o.frequency.value = hz;
        g.gain.setValueAtTime(.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.35, ctx.currentTime + d + .03); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d + .24); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .26); });
    } catch (e) {}
  }
  function notifyWeb(w) {
    webChime();
    clearInterval(webRingT);
    let n = 0; webRingT = setInterval(() => { if (!webVisible().length || ++n > 6) { clearInterval(webRingT); return; } webChime(); }, 4000);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => r && r.showNotification(w && w.source === 'waiter' ? '🧑‍🍳 طلب ويتر — ' + webWhere(w) : '📱 طلب أونلاين جديد', { body: 'افتح الكاشير حتى تقبله', tag: 'web-order', renotify: true, dir: 'rtl', lang: 'ar' }));
    }
  }
  const webWhere = (w) => w.mode === 'table' ? WEB_MODE.table + ' ' + toA(w.table || '') : WEB_MODE[w.mode] || '';
  // نرسم البطاقات من جديد بس إذا تغيّر محتواها: طلبات تخص كاشير ثاني أو تحديثات ما تبين هنا ما تعيد الرسم
  // (إعادة الرسم وقت الضغط تضيّع الضغطة، وبالزحمة كل طلب جديد كان يعيد رسمها)
  const setHtml = (el, html) => { if (el.__html !== html) { el.__html = html; el.innerHTML = html; } };
  function renderWeb() {
    const el = $('webBox'); if (!el) return;
    const list = webVisible().sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    setHtml(el, list.slice(0, 3).map((w) => {
      const items = webItems(w), miss = (w.items || []).length - items.length, busy = webBusy.has(w.id);
      const sum = items.reduce((s, i) => s + i.price * i.qty, 0) + (w.mode === 'delivery' ? (settings.defaultFee || 0) : 0);
      const mins = Math.max(0, Math.floor((Date.now() - (w.createdAtMs || Date.now())) / 60000));
      return `<div class="call-card web-card">
        <div class="call-top"><span class="call-pulse">📱</span> ${w.source === 'waiter' ? '🧑‍🍳 ' + esc(w.waiter || 'الويتر') : 'طلب أونلاين'} <span class="call-line">${esc(webWhere(w))}</span>
          <span class="web-ago">${mins ? 'قبل ' + toA(mins) + ' د' : 'هسه'}</span></div>
        ${w.customer || w.phone ? `<div class="web-cust">👤 ${esc(w.customer || '')}${w.phone ? ` <b dir="ltr">${esc(w.phone)}</b>` : ''}</div>` : ''}
        ${w.address ? `<div class="web-cust">📍 ${esc(w.address)}</div>` : ''}
        <div class="web-items">${items.map((i) => `<div><b>${toA(i.qty)}×</b> ${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${i.note ? ` <small>📝 ${esc(i.note)}</small>` : ''}</div>`).join('')}</div>
        ${miss > 0 ? `<div class="web-warn">⚠️ ${toA(miss)} صنف مو موجود بالمنيو — ما راح ينحسب</div>` : ''}
        ${w.note ? `<div class="web-note">📝 ${esc(w.note)}</div>` : ''}
        <div class="web-sum"><span>المجموع${w.mode === 'delivery' ? ' مع التوصيل' : ''}</span><b>${money(sum)}</b></div>
        <div class="call-btns">
          <button type="button" class="call-go" onclick="webAccept('${esc(w.id)}')" ${busy || !items.length ? 'disabled' : ''}>${busy ? '⏳ …' : '✅ قبول وإرسال للمطبخ'}</button>
          <button type="button" onclick="webReject('${esc(w.id)}')" ${busy ? 'disabled' : ''}>✕ رفض</button>
        </div></div>`;
    }).join('') + (list.length > 3 ? `<div class="call-card web-more">+ ${toA(list.length - 3)} طلبات ثانية بالانتظار</div>` : ''));
  }
  setInterval(() => { if (webs.size) renderWeb(); }, 30000);
  // القبول مرة وحدة بس حتى لو أكثر من جهاز ضغط سوا
  async function webClaim(w) {
    const f = fb(), ref = f.doc(f.db, 'webOrders', w.id);
    return f.runTransaction(f.db, async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists() || s.data().status !== 'new') return false;
      tx.update(ref, { status: 'accepted', acceptedBy: deviceId, acceptedAtMs: Date.now(), stage: 'preparing', stageAtMs: Date.now() });
      return true;
    });
  }
  // نفس مسار الكاشير بالضبط (رقم الطلب، الأقسام، البيجر، المخزون، الكابتن) بسلة مؤقتة
  async function webPlace(w, items) {
    const keep = { cart, disc, pagerSel, curCust };
    cart = items.map((i) => ({ ...i })); disc = { type: 'amt', value: 0, reason: '' }; pagerSel = 0; curCust = null;
    webAttach = w;
    try {
      if (w.mode === 'table') await finalOrder('salon', null, null, { table: w.table, payment: { method: 'later', cash: 0, card: 0, received: 0, change: 0 } });
      else if (w.mode === 'pickup') await holdOrder({ name: w.customer || '', phone: w.phone || '', note: w.note || '' });
      else await finalOrder('delivery', { id: null, name: '', later: true }, { name: w.customer || '', phone: w.phone || '', addr: w.address || '', fee: settings.defaultFee || 0 });
    } finally {
      webAttach = null;
      cart = keep.cart; disc = keep.disc; pagerSel = keep.pagerSel; curCust = keep.curCust;
      renderCart();
    }
  }
  window.webAccept = async (id, auto) => {
    const w = webs.get(id); if (!w || webBusy.has(id) || !restData) return;
    const items = webItems(w);
    if (!items.length) { if (!auto) toast('⚠️ أصناف الطلب مو موجودة بالمنيو — ارفضه'); return; }
    if (w.mode === 'delivery' && !feat('captain')) { if (!auto) toast('⛔ خدمة التوصيل موقوفة'); return; }
    webBusy.add(id); renderWeb();
    try {
      const ok = await webClaim(w);
      webs.delete(id); webGone.add(id);
      if (!ok) return;                 // انقبل من جهاز ثاني
      await webPlace(w, items);
      if (!webs.size) clearInterval(webRingT);
    } catch (e) { console.warn('web accept', e); if (!auto) toast('❌ تعذّر قبول الطلب — تأكد من الإنترنت'); }
    finally { webBusy.delete(id); renderWeb(); }
  };
  window.webReject = (id) => {
    if (!webs.get(id)) return;
    acDialog('✕ رفض الطلب الأونلاين', 'الزبون يشوف السبب على تلفونه', [{ id: 'reason', label: 'السبب', ph: 'مثال: الصنف خلص / المطبخ مسكّر' }], async (v) => {
      try {
        await fb().updateDoc(fb().doc(fb().db, 'webOrders', id), { status: 'rejected', reason: String(v.reason || '').trim().slice(0, 200) || 'المطعم ما يگدر يستقبل الطلب هسه' });
        webs.delete(id); webGone.add(id); renderWeb(); if (!webs.size) clearInterval(webRingT);
        toast('تم رفض الطلب');
      } catch (e) { toast('❌ تعذّر الرفض — يمكن انقبل من جهاز ثاني'); }
    }, '✕ رفض الطلب');
  };
  // ربط الطلب الأونلاين بطلب الكاشير: رقم التذكرة ورابط التتبع يوصلون للزبون
  function webLink(o, orderId) {
    const f = fb(), upd = { orderId, ticket: String(kNum(o)).slice(0, 10) };
    if (o.orderType === 'delivery') upd.trackId = orderId;
    f.updateDoc(f.doc(f.db, 'webOrders', o.webId), upd).catch((e) => console.warn('web link', e.code));
    if (!webSt) webSt = lsGet('pos_webst_' + rid(), {});
    webSt[o.webId] = 'preparing'; lsSet('pos_webst_' + rid(), webSt);
  }
  // طلب الطاولة الأونلاين: تذكرة المطبخ فقط (الفاتورة عند الحساب)
  function webKitchenPrint(o, items, total) {
    if (o.kSec) { printOrderAll(o, null); return; }
    printSlip('🍳 ' + (o.source === 'waiter' ? 'ويتر' : 'QR') + ' — ' + o.customer + ' #' + kNum(o), { customer: o.customer + (o.waiter ? ' • ' + o.waiter : '') },
      items.map((i) => ({ ...i, name: i.name + (i.note ? ' [' + i.note + ']' : '') })), total, 'المجموع', o.note);
  }
  // مرحلة الطلب تنعكس على تلفون الزبون
  function webStageOf(o) {
    if (o.status === 'cancelled') return 'cancelled';
    const t = getOrderType(o);
    if (t === 'delivery') return o.status === 'delivered' ? 'done' : ['pickup', 'delivering'].includes(o.status) ? 'on_way' : o.kitchen === 'ready' ? 'ready' : 'preparing';
    if (o.servedAtMs || o.pagerDone || (t !== 'salon' && o.status === 'delivered') || (t === 'salon' && o.payment && o.payment.method !== 'later')) return 'done';
    return o.kitchen === 'ready' || o.status === 'ready' ? 'ready' : 'preparing';
  }
  // ══════════ دلفري جاهز ينتظر كابتن ══════════
  // طلب التوصيل الأونلاين يروح للمطبخ أول؛ أول ما يجهز يطلع هنا ← الكاشير يختار أي كابتن متوفر
  const capWaitSeen = new Set();
  const CAP_NOANS = () => window.__capNoAns || 5 * 60000;
  // دلفري خلص تجهيزه يرجع لكاشيره (الجهاز اللي سجّله)؛ إذا ما اختار كابتن خلال ٣ دقايق يطلع لكل كاشيرية الدلفري
  const CAP_BACK = () => window.__capBack || 3 * 60000;
  const capNoAns = () => orders.filter((o) => getOrderType(o) === 'delivery' && o.status === 'pending' && o.captainId
    && !(o.rejectedBy || []).includes(o.captainId) && Date.now() - (o.assignedAtMs || o.createdAtMs || Date.now()) > CAP_NOANS());
  setInterval(() => { if (restData) renderCapWait(); }, 30000);
  function renderCapWait() {
    const el = $('capWaitBox'); if (!el || !restData) return;
    if (!myPerm('oDeliv')) { setHtml(el, ''); return; }
    const mine = (o) => !isCashierRole() || !o.device || o.device === deviceId || Date.now() - (o.kitchenReadyAt || o.readyAt || 0) > CAP_BACK();
    const list = orders.filter((o) => o.awaitCap && getOrderType(o) === 'delivery' && o.status !== 'cancelled' && !o.captainId && (o.kitchen === 'ready' || o.status === 'ready') && mine(o))
      .sort((a, b) => (a.kitchenReadyAt || a.readyAt || 0) - (b.kitchenReadyAt || b.readyAt || 0));
    let fresh = false;
    list.forEach((o) => { if (!capWaitSeen.has(o.id)) { capWaitSeen.add(o.id); fresh = true; } });
    if (fresh) { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} try { kdsBeep(); } catch (e) {} }
    setHtml(el, list.slice(0, 3).map((o) => `<div class="call-card cap-wait">
      <div class="call-top"><span class="call-pulse">🛵</span> دلفري جاهز — اختار الكابتن <span class="call-line">#${esc(kNum(o))}</span></div>
      <div class="call-info"><b>${esc(o.customer || '')}</b>${o.phone ? ' • <span dir="ltr">' + esc(o.phone) + '</span>' : ''}${o.address ? '<div class="ac-sub">📍 ' + esc(o.address) + '</div>' : ''}
        <div class="ac-sub">💰 ${money((o.value || 0) + (o.fee || 0))} مع التوصيل</div></div>
      <div class="call-btns"><button type="button" class="call-go" onclick="openChangeCapForOrder('${esc(o.id)}')">🛵 اختيار كابتن</button></div></div>`).join('')
      + (list.length > 3 ? `<div class="ac-sub" style="text-align:center">+ ${toA(list.length - 3)} طلبات ثانية جاهزة — من تبويب الطلبات</div>` : '')
      + capNoAns().slice(0, 3).map((o) => `<div class="call-card cap-wait cap-noans">
      <div class="call-top"><span class="call-pulse">⏰</span> الكابتن ما رد — ${esc(o.captainName || '')} <span class="call-line">#${esc(kNum(o))}</span></div>
      <div class="call-info"><b>${esc(o.customer || '')}</b> • من ${toA(Math.floor((Date.now() - (o.assignedAtMs || o.createdAtMs)) / 60000))} دقيقة ما قبل الطلب</div>
      <div class="call-btns"><button type="button" class="call-go" onclick="openChangeCapForOrder('${esc(o.id)}')">🔄 تغيير الكابتن</button></div></div>`).join(''));
  }
  window.renderCapWait = renderCapWait;
  function syncWebStages() {
    if (!restData) return;
    if (!webSt) webSt = lsGet('pos_webst_' + rid(), {});
    const day = Date.now() - 86400000, live = new Set();
    let dirty = false;
    orders.forEach((o) => {
      if (!o.webId || (o.createdAtMs || 0) < day) return;
      live.add(o.webId);
      const st = webStageOf(o);
      if (webSt[o.webId] === st) return;
      webSt[o.webId] = st; dirty = true;
      fb().updateDoc(fb().doc(fb().db, 'webOrders', o.webId), { stage: st, stageAtMs: Date.now() }).catch(() => {});
    });
    if (dirty) { Object.keys(webSt).forEach((k) => { if (!live.has(k)) delete webSt[k]; }); lsSet('pos_webst_' + rid(), webSt); }
  }

  // ── الإعدادات: خدمات الشاشة والويتر والباركود (كل وحدة يشغّلها أو يوقفها المدير الأعلى من لوحة الإدارة) ──
  const svcOff = (title) => `<div class="sh-card">${title}<div class="ac-sub">⛔ الخدمة موقوفة لمطعمك — تواصل ويا إدارة سرعة لتفعيلها.</div></div>`;
  function screenCardHtml() {
    const title = '<div class="sh-title">📺 شاشة «طلبك جاهز»</div>';
    if (!feat('screen')) return svcOff(title);
    return `<div class="sh-card">${title}
        <div class="ac-sub" style="margin-bottom:6px;line-height:1.8">شنو يطلع على شاشة التلفزيون؟ طلبات السفري والطلبات اللي وياها بيجر تطلع دائماً.</div>
        <label class="set-check"><input type="checkbox" id="stScrSalon" ${scrCfg().salon ? 'checked' : ''}> 🪑 طلبات الصالة حتى بدون بيجر</label>
        <label class="set-check"><input type="checkbox" id="stScrDel" ${scrCfg().delivery ? 'checked' : ''}> 🏍️ طلبات الدلفري (لحد ما يستلمها الكابتن)</label>
        <label class="set-check"><input type="checkbox" id="stScrQr" ${scrCfg().qr ? 'checked' : ''}> 📱 كود المنيو بزاوية الشاشة — الزبون يمسحه من مكانه (إذا خدمة الباركود شغّالة)</label>
      </div>`;
  }
  function onlineCardHtml() {
    const title = '<div class="sh-title">📱 الباركود والمنيو الأونلاين</div>';
    if (!feat('online')) return svcOff(title);
    const oc = onlineCfg(), dl = feat('captain');
    return `<div class="sh-card" id="onCard">${title}
      <div class="ac-sub" style="margin-bottom:8px;line-height:1.8">الزبون يمسح QR الطاولة أو يفتح رابط المطعم من البيت، يختار ويطلب — والطلب يوصل هنا فوراً وينطبع بالمطبخ. الأسعار دائماً من منيو الكاشير.</div>
      <label class="set-check"><input type="checkbox" id="stOnOn" ${oc.on ? 'checked' : ''}> <b>تشغيل المنيو الأونلاين</b></label>
      <label class="set-check"><input type="checkbox" id="stOnTable" ${oc.table ? 'checked' : ''}> 🪑 الطلب من الطاولة (QR على كل طاولة)</label>
      <label class="set-check"><input type="checkbox" id="stOnPickup" ${oc.pickup ? 'checked' : ''}> 🛍️ يطلب ويستلم من المطعم</label>
      <label class="set-check"${dl ? '' : ' style="opacity:.55"'}><input type="checkbox" id="stOnDeliv" ${oc.delivery && dl ? 'checked' : ''} ${dl ? '' : 'disabled'}> 🏍️ توصيل للبيت ${dl ? '(ينرسل لكل الكباتن)' : '— يحتاج خدمة الكابتن'}</label>
      <label class="set-check"><input type="checkbox" id="stOnAuto" ${oc.autoTable ? 'checked' : ''}> ⚡ طلبات الطاولات تدخل للمطبخ مباشرة بدون تأكيد</label>
      <label class="set-check"><input type="checkbox" id="stOnView" ${oc.viewOnly ? 'checked' : ''}> 📖 <b>عرض المنيو بس</b> — الزبون يشوف الأصناف والمتوفر بدون ما يطلب (يطلب من الكاشير أو الويتر)</label>
      <div class="flbl">ملاحظة تظهر للزبون (اختياري)</div><input class="finp" id="stOnNote" maxlength="300" value="${esc(oc.note || '')}" placeholder="مثال: التوصيل من ١٢ الظهر لحد ١٢ بالليل">
      <label class="set-check" style="margin-top:8px"><input type="checkbox" id="stOnDev" ${webAutoDev() ? 'checked' : ''}> 🖨️ هذا الجهاز يقبل الطلبات التلقائية ويطبعها (خليها على جهاز الكاشير بس)</label>
      <div class="on-link"><input class="finp" id="stOnLink" readonly dir="ltr" value="${esc(menuLink())}" onclick="this.select()"><button type="button" class="btn-soft" onclick="copyMenuLink()">📋 نسخ</button><a class="btn-soft" href="${esc(menuLink())}" target="_blank" rel="noopener">👁️ فتح</a></div>
      <div class="on-qr"><button type="button" class="btn-soft" onclick="printTableQR()">🖨️ QR الطاولات (${toA(settings.tables || 0)})</button><button type="button" class="btn-soft" onclick="printTableQR(true)">🖨️ QR المطعم (استلام وتوصيل)</button></div>
    </div>`;
  }
  function readOnlineForm() {
    if (!$('stOnOn')) return settings.online;
    if ($('stOnDev')) lsSet(webAutoKey(), $('stOnDev').checked);
    return { on: $('stOnOn').checked, viewOnly: $('stOnView').checked, table: $('stOnTable').checked, pickup: $('stOnPickup').checked, delivery: $('stOnDeliv').checked && feat('captain'),
      autoTable: $('stOnAuto').checked, note: $('stOnNote').value.trim().slice(0, 300) };
  }
  window.copyMenuLink = (link) => {
    const u = link || menuLink();
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast(link ? '📋 انسخ الرابط' : '📋 انسخ رابط المنيو — دزّه للزبائن أو حطه بالانستغرام'), () => askText('انسخ الرابط:', u));
  };
  function loadQR() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  const qrSvg = (u) => { const q = window.qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
  window.printTableQR = async (general) => {
    if (!onlineOk()) { toast('⚠️ شغّل المنيو الأونلاين واحفظ الإعدادات أولاً'); return; }
    const n = settings.tables || 0;
    if (!general && !n) { toast('⚠️ حدد عدد الطاولات بقسم «الأسعار والضرائب» واحفظ'); return; }
    try { await loadQR(); } catch (e) { toast('❌ تعذّر تحميل مولّد QR'); return; }
    const name = settings.receiptTitle || restData.name || '';
    const list = general ? [''] : Array.from({ length: n }, (_, i) => String(i + 1));
    const view = onlineCfg().viewOnly;
    const cards = list.map((t) => `<div class="qc"><div class="qn">${esc(name)}</div><div class="qt">${t ? 'طاولة ' + toA(t) : view ? 'المنيو' : 'اطلب أونلاين'}</div>${qrSvg(menuLink(t))}
      <div class="qh">📱 وجّه كاميرا تلفونك على الكود ${view ? 'وشوف المنيو' : 'واطلب'}</div><div class="qs">سرعة · sora3a</div></div>`).join('');
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>QR — ${esc(name)}</title><style>@page{size:A4;margin:10mm}
      body{margin:0;font-family:Tajawal,Arial,sans-serif;color:#0A100D}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
      .qc{border:2px dashed #0A100D;border-radius:6mm;padding:6mm;text-align:center;break-inside:avoid;page-break-inside:avoid}
      .qn{font-weight:900;font-size:18pt}.qt{display:inline-block;margin:2mm 0 3mm;padding:1mm 6mm;border-radius:99px;background:#0A100D;color:#fff;font-weight:900;font-size:16pt}
      .qc svg{width:55mm;height:55mm;display:block;margin:0 auto}.qh{font-size:11pt;margin-top:2mm;font-weight:700}.qs{font-size:8pt;color:#666;margin-top:1mm}</style></head>
      <body><div class="g">${cards}</div></body></html>`;
    // ورقة A4 بنافذة الطباعة (مو طابعة الفواتير)
    let fr = $('qrFr');
    if (!fr) { fr = document.createElement('iframe'); fr.id = 'qrFr'; fr.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;height:1100px;border:none'; document.body.appendChild(fr); }
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {} };
    fr.srcdoc = html;
  };

  // ══════════ التشغيل بعد تسجيل الدخول ══════════
  // الأساس (كان بـ index.html) — نفس الكود
function enterAppCore(){
  document.getElementById('splash').classList.add('hide');
  setTimeout(()=>{document.getElementById('splash').style.display='none';},600);
  document.getElementById('loginPage').style.display='none';
  document.getElementById('appPage').className='show';
  document.getElementById('restName').textContent=restData.name||'المطعم';
  loadAcc();renderMenu();renderCart();startListeners();initMenuManage();updateAccBadge();shrinkOldImages();renderHold();
  showThemeSwitcher();
}
  window.enterApp = function () {
    disc = { type: 'amt', value: 0, reason: '' }; prodQuery = ''; shift = null; kdsSeen.clear(); kdsReady = false;
    if ($('prodSearch')) $('prodSearch').value = '';
    listenSettings();
    listenLoyalty();
    loadPushUrl();
    enterAppCore();
    listenMenu();
    listenShifts();
    tkRefill();          // نحجز أرقام الطلبات من أول ما يفتح الكاشير
    listenCalls();
    lanStart();
    webSt = null; listenWeb();
    listenCapPay();
    listenMe();
    listenRest();
    applyFeatures();
    // بعد التحديث التلقائي: نرجع لنفس التبويب
    const au = window.auRestore && window.auRestore();
    if (au && au.tab && au.tab !== 'cashier') setTimeout(() => { try { goTab(au.tab); } catch (e) {} }, 300);
    curCust = null; custCache.clear();
    applyPerms();
    $('kdsSoundBtn').textContent = kdsSound ? '🔔 الصوت: يعمل' : '🔕 الصوت: مطفأ';
    if ('Notification' in window && Notification.permission === 'granted') registerRestPush(false);
  };
})();
