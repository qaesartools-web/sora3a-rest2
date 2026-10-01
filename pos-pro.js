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
    defaultFee: 5000, feePresets: [3000, 5000, 7000], taxPct: 0, servicePct: 0, tables: 0,
    printKitchen: false, quickAdd: true, paper: 80,
    quickNotes: ['بدون بصل', 'بدون صوص', 'حار', 'زيادة جبن', 'بدون مخلل'],
  };
  let settings = { ...DEFAULTS };
  const setKey = () => 'pos_settings_' + rid();

  // ══════════ حالة الكاشير ══════════
  let disc = { type: 'amt', value: 0, reason: '' };
  let prodQuery = '';
  let shift = null;           // الوردية المفتوحة
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
    const service = type === 'salon' ? Math.round((subT - d) * (settings.servicePct || 0) / 100) : 0;
    const tax = Math.round((subT - d + service) * (settings.taxPct || 0) / 100);
    return { sub: subT, disc: d, service, tax, total: subT - d + service + tax };
  }

  // ══════════ المنيو السحابي ══════════
  let hasLocalMenu = false, menuCloudTs = 0, menuPushT = null, menuCloudExists = null;
  const MENU_KEY = () => 'pos_menu_' + (rid() || 'def');
  const imgKey = (id) => 'pos_img_' + id;
  const imgSig = (d) => d ? d.length + ':' + d.slice(-32) : '';

  // استبدال loadMenu: لا نعرض منيو مطعم آخر للمطاعم الجديدة
  window.loadMenu = loadMenu = function () {
    const s = lsGet(MENU_KEY(), null);
    hasLocalMenu = Array.isArray(s) && s.length > 0;
    menu = hasLocalMenu ? s : [{ cat: 'عام', emoji: '🍽️', items: [] }];
  };
  const _saveMenuLocal = saveMenu;
  window.saveMenu = saveMenu = function (opts) {
    _saveMenuLocal();
    hasLocalMenu = true;
    if (!(opts && opts.local)) { clearTimeout(menuPushT); menuPushT = setTimeout(pushMenu, 1200); }
  };

  async function pushMenu() {
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
      _saveMenuLocal();
      await f.setDoc(sub('menu', 'main'), { cats, updatedAtMs: menuCloudTs, device: deviceId });
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
    menu = next;
    if (activeCat >= menu.length) activeCat = 0;
    saveMenu({ local: true });
    renderMenu();
    if ($('menuScreen').classList.contains('on')) { initMenuManage(); if ($('mListSec').style.display !== 'none') renderMList(); }
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
      setTimeout(() => { if (rid() === myRid) listenMenu(); }, 2000);
    });
    unsubs.push(() => { if (menuUnsub) { menuUnsub(); menuUnsub = null; } });
    // ضمان إضافي: إذا بقي المنيو فارغاً نجلبه مباشرة من السحابة
    setTimeout(async () => {
      if (rid() !== myRid || menu.some((c) => c.items.length)) return;
      try { const s = await fb().getDoc(sub('menu', 'main')); if (s.exists()) { menuCloudTs = 0; onMenuSnap(s); } } catch (e) {}
    }, 4000);
  }

  // ══════════ عرض المنيو + البحث ══════════
  const _renderMenuOrig = renderMenu;
  window.renderMenu = renderMenu = function () {
    if (!menu.length) menu = [{ cat: 'عام', emoji: '🍽️', items: [] }];
    if (activeCat >= menu.length) activeCat = 0;
    const totalItems = menu.reduce((s, c) => s + c.items.length, 0);
    if (!prodQuery) {
      _renderMenuOrig();
      if (!totalItems) {
        $('prods').innerHTML = `<div class="prod-empty"><div class="i">🍔</div><b>لا توجد أصناف بعد</b><br><small>أضف أصنافك من تبويب «المنيو»</small><br>
          <button onclick="goTab('menu')">➕ إضافة أصناف</button> <button onclick="importSampleMenu()">📋 استيراد منيو تجريبي</button></div>`;
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
  window.importSampleMenu = () => {
    if (!confirm('استيراد منيو تجريبي؟ يمكنك تعديله أو حذفه لاحقاً.')) return;
    menu = JSON.parse(JSON.stringify(defaultMenu)); activeCat = 0; saveMenu(); renderMenu(); toast('✅ تم استيراد المنيو التجريبي');
  };

  // ══════════ إضافة للسلة: ملاحظات + إضافة سريعة ══════════
  const _openVar = window.openVar;
  window.openVar = (ci, ii) => {
    const p = menu[ci] && menu[ci].items[ii]; if (!p) return;
    if (typeof p.stock === 'number' && p.stock <= 0) { toast('⛔ الصنف نفذ من المخزن'); return; }
    if (settings.quickAdd && p.variants.length === 1) { addLine(p, p.variants[0], 1, ''); return; }
    _openVar(ci, ii);
    $('varNote').value = '';
    $('varQuick').innerHTML = (settings.quickNotes || []).map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('');
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
  window.renderCart = renderCart = function () {
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
    if (t.disc || settings.taxPct) rows.push(`<div class="trow"><span>المجموع الفرعي</span><b>${money(t.sub)}</b></div>`);
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
  };
  window.cNote = (i) => {
    const c = cart[i]; if (!c) return;
    acDialog('📝 ملاحظة: ' + c.name, (settings.quickNotes || []).join(' • '), [{ id: 'n', label: 'الملاحظة', value: c.note || '' }], (v) => {
      const note = v.n.trim().slice(0, 80);
      const dup = cart.find((x, j) => j !== i && x.name === c.name && x.variant === c.variant && (x.note || '') === note);
      if (dup) { dup.qty += c.qty; cart.splice(i, 1); } else c.note = note;
      renderCart();
    }, '✅ حفظ');
  };
  window.clearCart = () => {
    if (!cart.length && !disc.value) return;
    if (cart.length && !confirm('تفريغ السلة؟')) return;
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
      if (v.t === 'pct' && val > 100) { toast('⚠️ النسبة لا تتجاوز ١٠٠٪'); return false; }
      disc = { type: v.t, value: val, reason: val ? v.r : '' };
      renderCart();
    }, '✅ تطبيق');
  };

  // ══════════ ترحيل الطلب ══════════
  window.openOrderType = () => {
    if (!cart.length) return;
    const t = totals(null);
    $('sumBox').innerHTML = cart.map((c) => `<div>• ${esc(c.name)} (${esc(c.variant)}) ×${c.qty}${c.note ? ' — 📝 ' + esc(c.note) : ''}</div>`).join('') +
      `<div style="font-weight:900;margin-top:4px;">الإجمالي: ${money(t.total)}</div>`;
    $('typeOv').classList.add('on');
  };
  window.pickType = (type) => {
    $('typeOv').classList.remove('on');
    if (type === 'salon') openPay({ kind: 'new', type: 'salon' });
    else if (type === 'quick') openPay({ kind: 'new', type: 'takeaway' });
    else if (type === 'takeaway') openHold();
    else if (type === 'delivery') openDelivModal();
  };
  const _openDeliv = openDelivModal;
  window.openDelivModal = openDelivModal = function () {
    _openDeliv();
    $('dFee').value = settings.defaultFee || 5000;
    renderFeePresets();
    $('custHint').innerHTML = '';
    if (curCust) {
      $('dPhone').value = curCust.phone;
      if (curCust.data) { $('dName').value = curCust.data.name || ''; $('dAddr').value = curCust.data.address || ''; }
      showCustHint(curCust.data);
    }
  };
  function renderFeePresets() {
    const el = $('feePresets'); if (!el) return;
    el.innerHTML = (settings.feePresets || []).slice(0, 4).map((f) => `<button class="fee-p" onclick="setFee(${Number(f) || 0})">${toA(Math.round((Number(f) || 0) / 1000))}</button>`).join('');
  }

  // عناصر الطلب مع الملاحظات والتكلفة
  window.cartItemsForOrder = cartItemsForOrder = function () {
    return cart.map((c) => { const it = { name: c.name, variant: c.variant, price: c.price, qty: c.qty, cost: unitCost(c.name, c.variant) }; if (c.note) it.note = c.note; return it; });
  };

  function baseOrder(type, t, items) {
    const now = nowT();
    const o = {
      restaurantId: restData.id, restaurantName: restData.name,
      orderType: type, items, notes: items.map((c) => `${c.name}(${c.variant})×${c.qty}${c.note ? ' [' + c.note + ']' : ''}`).join(', ').slice(0, 4900),
      subtotal: t.sub, discount: t.disc, service: t.service, tax: t.tax, value: t.total,
      inv: true, kitchen: 'new', createdAt: now, createdAtMs: Date.now(), shiftId: shift ? shift.id : null, device: deviceId,
    };
    if (t.disc) o.discountInfo = { type: disc.type, value: disc.value, reason: disc.reason || '' };
    return o;
  }

  // استبدال finalOrder: يحفظ فوراً (يعمل بدون إنترنت) ويطبع فاتورة كاملة
  window.finalOrder = finalOrder = async function (type, captain, custInfo, pay) {
    if (!restData || !cart.length) return;
    const t = totals(type), items = cartItemsForOrder(), now = nowT();
    const f = fb(), ref = f.doc(f.collection(f.db, 'orders'));
    const o = baseOrder(type, t, items);
    if (type === 'delivery') {
      Object.assign(o, {
        status: 'pending', customer: custInfo.name, phone: custInfo.phone, address: custInfo.addr,
        fee: custInfo.fee || settings.defaultFee || 0, captainId: captain.id, captainName: captain.name,
        commission: Math.round(t.total * .1), deliveryProof: null, rejectedBy: [], payment: { method: 'cod' },
      });
    } else {
      const tbl = pay && pay.table ? Number(pay.table) : 0;
      const salonNum = type === 'salon' ? (tbl || getNextSalonNum()) : null;
      Object.assign(o, { status: 'delivered', deliveredAt: Date.now(), payment: pay ? pay.payment : { method: 'cash', cash: t.total, card: 0 } });
      if (type === 'salon') { o.salonNum = salonNum; o.customer = tbl ? 'طاولة ' + tbl : 'صالة #' + salonNum; if (tbl) o.tableNo = tbl; }
      else o.customer = 'سفري';
    }
    o.timeline = [{ status: o.status, time: now, text: 'تم إنشاء الطلب' }];
    f.setDoc(ref, o).catch((e) => toast('❌ تعذّر حفظ الطلب: ' + (e.code || e.message)));
    if (type === 'delivery') { syncTracking(ref.id, { ...o, captainName: '' }); saveCustomer(o); }
    curCust = null;
    applySaleToStock(cart.map((c) => ({ name: c.name, variant: c.variant, qty: c.qty })), ref.id);
    printHTML(receiptHTML({ id: ref.id, ...o }, captain, pay, settings.printKitchen));
    const names = { salon: '🪑 ' + o.customer, takeaway: '🛍️ سفري فوري', delivery: '🏍️ دلفري — ' + (captain ? captain.name : '') };
    toast('✅ تم — ' + names[type] + (pay && pay.payment.change ? ' • الباقي ' + money(pay.payment.change) : ''));
    cart = []; disc = { type: 'amt', value: 0, reason: '' }; renderCart();
  };

  // سفري قيد التحضير: نفس الحفظ لكن بدون دفع (يُدفع عند التسليم)
  window.holdOrder = holdOrder = function (info) {
    if (!restData || !cart.length) return;
    const t = totals('takeaway'), items = cartItemsForOrder(), num_ = nextHoldNum(), now = nowT();
    const f = fb(), ref = f.doc(f.collection(f.db, 'orders'));
    const o = baseOrder('takeaway', t, items);
    Object.assign(o, { held: true, holdNum: num_, customer: info.name || ('سفري #' + num_), phone: info.phone || '', note: info.note || '',
      status: 'preparing', timeline: [{ status: 'preparing', time: now, text: 'تم إنشاء الطلب — قيد التحضير' }] });
    f.setDoc(ref, o).catch((e) => toast('❌ تعذر حفظ الطلب: ' + (e.code || e.message)));
    if (info.phone) saveCustomer({ ...o, customer: info.name || '' });
    curCust = null;
    applySaleToStock(cart.map((c) => ({ name: c.name, variant: c.variant, qty: c.qty })), ref.id);
    printSlip('🍳 تذكرة مطبخ #' + num_, { customer: o.customer, phone: o.phone }, items.map((i) => ({ ...i, name: i.name + (i.note ? ' [' + i.note + ']' : '') })), t.total, 'المجموع', o.note);
    toast('🍳 حُفظ الطلب #' + num_ + ' — قيد التحضير');
    cart = []; disc = { type: 'amt', value: 0, reason: '' }; renderCart();
  };

  // التسليم للزبون: يطلب الدفع إن لم يُدفع
  window.ordHandover = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    if (o.payment && o.payment.method !== 'later') {
      await orderUpdate(id, { status: 'delivered', deliveredAt: Date.now(), kitchen: 'ready' }, 'سُلّم للزبون', 'delivered');
      printOrderReceipt(o, 'takeaway', null); toast('🤝 تم التسليم للزبون'); return;
    }
    openPay({ kind: 'collect', order: o, handover: true });
  };
  window.ordCollect = (id) => { const o = orders.find((x) => x.id === id); if (o) openPay({ kind: 'collect', order: o }); };

  // زر «تحصيل» للطلبات المؤجلة الدفع
  const _orderActions = orderActions;
  window.orderActions = orderActions = function (o) {
    let h = _orderActions(o);
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
    payCtx = { ...ctx, typeName: type, due: t.total, method: 'cash', received: '', card: '', table: '' };
    $('payTitle').textContent = ctx.kind === 'new' ? (type === 'salon' ? '🪑 دفع — صالة' : '🛍️ دفع — سفري فوري') : '💵 تحصيل الطلب #' + (ctx.order.holdNum || ctx.order.id.substring(0, 6).toUpperCase());
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
    const cardPart = c.method === 'mixed' ? `<div class="dfield"><div class="dlbl">💳 مبلغ البطاقة</div><input class="dinp" id="payCard" inputmode="numeric" value="${esc(c.card)}"></div>` : '';
    el.innerHTML = `${cardPart}<div class="dfield"><div class="dlbl">💵 المبلغ المستلم نقداً</div><input class="dinp big-inp" id="payRecv" inputmode="numeric" placeholder="${fmt(cashDue())}" value="${esc(c.received)}"></div>
      <div class="pay-quick">${quickAmounts(cashDue()).map((v) => `<button type="button" data-v="${v}">${fmt(v)}</button>`).join('')}</div>
      <div class="pay-change" id="payChange"></div>`;
    el.querySelector('.pay-quick').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; c.received = b.dataset.v; $('payRecv').value = b.dataset.v; updChange(); });
    $('payRecv').addEventListener('input', (e) => { c.received = e.target.value; updChange(); });
    const pc = $('payCard'); if (pc) pc.addEventListener('input', (e) => { c.card = e.target.value; updChange(); el.querySelector('.pay-quick').innerHTML = quickAmounts(cashDue()).map((v) => `<button type="button" data-v="${v}">${fmt(v)}</button>`).join(''); });
    updChange();
  }
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
    const card = c.method === 'mixed' ? Math.min(num(c.card), c.due) : 0;
    const due = c.due - card, recv = c.received === '' ? due : num(c.received);
    if (recv < due) return null;
    return { method: c.method, cash: due, card, received: recv, change: recv - due };
  }
  $('payOk').addEventListener('click', confirmPay);
  async function confirmPay() {
    const c = payCtx; if (!c) return;
    const payment = buildPayment();
    if (!payment) { toast('⚠️ المبلغ المستلم أقل من المطلوب'); return; }
    payment.atMs = Date.now(); payment.shiftId = shift ? shift.id : null;
    const table = $('payTableSel') ? $('payTableSel').value : '';
    payClose();
    if (c.kind === 'new') { await finalOrder(c.typeName, null, null, { payment, table }); return; }
    const o = c.order;
    try {
      const fields = { payment };
      let text = 'تم تحصيل ' + money(o.value);
      if (c.handover) { Object.assign(fields, { status: 'delivered', deliveredAt: Date.now(), kitchen: 'ready' }); text = 'سُلّم للزبون — ' + text; }
      await orderUpdate(o.id, fields, text, c.handover ? 'delivered' : o.status);
      printHTML(receiptHTML({ ...o, ...fields }, null, { payment }, false));
      toast(c.handover ? '🤝 تم التسليم والتحصيل' : '💵 تم التحصيل' + (payment.change ? ' • الباقي ' + money(payment.change) : ''));
    } catch (e) { toast('❌ تعذّر الحفظ'); }
  }

  // ══════════ الفاتورة ══════════
  const PAY_AR = { cash: 'نقداً', card: 'بطاقة', mixed: 'مختلط', later: 'آجل — لم يُدفع', cod: 'عند الاستلام (الكابتن)' };
  function receiptHTML(o, captain, pay, withKitchen) {
    const items = orderItemsFull(o).map((i, k) => ({ ...i, note: (o.items && o.items[k] && o.items[k].note) || i.note }));
    const title = settings.receiptTitle || restData.name || 'سرعة';
    const subL = settings.receiptSub || restData.area || '';
    const phone = settings.receiptPhone || restData.phone || '';
    const d = new Date(o.createdAtMs || Date.now());
    const type = o.orderType || 'delivery';
    const head = type === 'salon' ? `<div class="num">#${esc(o.tableNo ? 'طاولة ' + o.tableNo : o.salonNum)}</div><div class="type">🪑 صالة</div>`
      : type === 'takeaway' ? `${o.holdNum ? `<div class="num">#${esc(o.holdNum)}</div>` : ''}<div class="type">🥡 سفري</div>`
      : `<div class="type">🏍️ دلفري — ${esc(o.captainName || (captain && captain.name) || '')}</div>`;
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
      <div class="div"></div>${head}<div class="div"></div>
      <div class="row"><span>رقم الطلب</span><span>${esc(String(o.id || '').substring(0, 6).toUpperCase())}</span></div>
      <div class="row"><span>التاريخ</span><span>${esc(d.toLocaleDateString('ar-IQ'))} ${esc(o.createdAt || '')}</span></div>
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
      ${p.method ? `<div class="div"></div><div class="row"><span>طريقة الدفع</span><span>${esc(PAY_AR[p.method] || p.method)}</span></div>` : ''}
      ${p.card && p.method === 'mixed' ? `<div class="row"><span>بطاقة</span><span>${fmt(p.card)}</span></div>` : ''}
      ${p.received && (p.method === 'cash' || p.method === 'mixed') ? `<div class="row"><span>المستلم نقداً</span><span>${fmt(p.received)}</span></div><div class="row"><span>الباقي</span><span>${fmt(p.change || 0)}</span></div>` : ''}
      <div class="div"></div><div class="foot">${esc(settings.receiptFooter || 'شكراً لزيارتكم ❤️')}</div>`;
    const kt = withKitchen ? `<div class="pb kt"><div class="logo">🍳 تذكرة مطبخ</div><div class="div"></div>${head}
      <div class="row"><span>${esc(o.createdAt || '')}</span><span>${esc(String(o.id || '').substring(0, 6).toUpperCase())}</span></div><div class="div"></div>
      ${items.map((i) => `<div class="item">${i.qty}× ${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${i.note ? `<div class="n">📝 ${esc(i.note)}</div>` : ''}</div>`).join('')}</div>` : '';
    return `<html><head><meta charset="UTF-8"><style>${css}</style></head><body>${rcpt}${kt}</body></html>`;
  }
  window.printOrderReceipt = printOrderReceipt = function (o, type, captain) { printHTML(receiptHTML(o, captain, null, false)); };
  window.reprintOrder = (id) => { const o = orders.find((x) => x.id === id); if (o) printHTML(receiptHTML(o, null, null, false)); };

  // ══════════ الوردية ══════════
  function listenShifts() {
    const f = fb();
    unsubs.push(f.onSnapshot(f.query(subCol('shifts'), f.where('status', '==', 'open')), (s) => {
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.openedAtMs - a.openedAtMs);
      shift = list[0] || null;
      $('shiftWarn').classList.toggle('on', !shift);
      if ($('shiftScreen').classList.contains('on')) renderShift();
    }, (e) => console.warn('shift', e.code)));
  }
  async function loadClosedShifts() {
    const f = fb();
    try {
      const s = await f.getDocs(f.query(subCol('shifts'), f.where('status', '==', 'closed')));
      closedShifts = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.closedAtMs - a.closedAtMs).slice(0, 15);
    } catch (e) { closedShifts = []; }
  }
  function shiftCalc(sh) {
    const mine = orders.filter((o) => o.shiftId === sh.id);
    const live = mine.filter((o) => o.status !== 'cancelled'), canc = mine.filter((o) => o.status === 'cancelled');
    const paidHere = orders.filter((o) => o.payment && o.payment.shiftId === sh.id);
    const r = { orders: live.length, sales: 0, sub: 0, disc: 0, service: 0, tax: 0, byType: { salon: { n: 0, v: 0 }, takeaway: { n: 0, v: 0 }, delivery: { n: 0, v: 0 } },
      cash: 0, card: 0, later: 0, cod: 0, refunds: 0, cancelled: canc.length, cancelledV: canc.reduce((s, o) => s + (o.value || 0), 0) };
    live.forEach((o) => {
      r.sales += o.value || 0; r.sub += o.subtotal != null ? o.subtotal : (o.value || 0); r.disc += o.discount || 0; r.service += o.service || 0; r.tax += o.tax || 0;
      const t = getOrderType(o); r.byType[t].n++; r.byType[t].v += o.value || 0;
      if (o.payment && o.payment.method === 'later') r.later += o.value || 0;
      if (t === 'delivery') r.cod += (o.value || 0) + (o.fee || 0);
    });
    paidHere.forEach((o) => {
      if (o.status === 'cancelled') { r.refunds += o.payment.cash || 0; return; }
      r.cash += o.payment.cash || 0; r.card += o.payment.card || 0;
    });
    const mv = sh.cashMoves || [];
    r.cashIn = mv.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    r.cashOut = mv.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);
    r.expected = (sh.openingCash || 0) + r.cash - r.refunds + r.cashIn - r.cashOut;
    return r;
  }
  function renderShift() {
    const el = $('shiftBody');
    // نحافظ على ما يكتبه الكاشير إذا أُعيد الرسم أثناء الكتابة
    const keep = {}; ['shOpenCash', 'shCashier'].forEach((id) => { const i = $(id); if (i) keep[id] = i.value; });
    const restore = () => Object.entries(keep).forEach(([id, v]) => { const i = $(id); if (i) i.value = v; });
    if (!shift) {
      // النموذج موجود: نحدّث قائمة الورديات السابقة فقط ولا نلمس ما يكتبه الكاشير
      if ($('shOpenCash') && $('shClosedWrap')) { $('shClosedWrap').innerHTML = closedHTML(); return; }
      el.innerHTML = `<div class="sh-card"><div class="sh-title">🧮 فتح وردية جديدة</div>
        <div class="ac-sub" style="margin-bottom:10px">الوردية تجمع مبيعات الكاشير والنقد بالدرج من الفتح للإغلاق، وتطلع لك تقرير نهاية الوردية.</div>
        <div class="dfield"><div class="dlbl">💵 النقد الموجود بالدرج عند الفتح</div><input class="dinp big-inp" id="shOpenCash" inputmode="numeric" placeholder="0"></div>
        <div class="dfield"><div class="dlbl">👤 اسم الكاشير (اختياري)</div><input class="dinp" id="shCashier" maxlength="40" value="${esc(lsGet('pos_cashier_name', ''))}"></div>
        <button class="btn-main" style="width:100%" onclick="shiftOpen()">🔓 فتح الوردية</button></div><div id="shClosedWrap">${closedHTML()}</div>`;
      restore();
      return;
    }
    const r = shiftCalc(shift);
    const mins = Math.floor((Date.now() - shift.openedAtMs) / 60000);
    const ln = (a, b, c) => `<div class="sh-line"><span>${a}</span><b class="${c || ''}">${b}</b></div>`;
    el.innerHTML = `<div class="sh-card">
      <div class="sh-title">🧮 الوردية الحالية <span class="sh-status open">● مفتوحة</span></div>
      <div class="ac-sub" style="margin-bottom:10px">منذ ${esc(new Date(shift.openedAtMs).toLocaleString('ar-IQ'))} (${toA(Math.floor(mins / 60))} س ${toA(mins % 60)} د)${shift.cashier ? ' • 👤 ' + esc(shift.cashier) : ''}</div>
      <div class="sh-grid">
        <div class="sh-stat"><b>${fmt(r.sales)}</b><span>صافي المبيعات</span></div>
        <div class="sh-stat"><b>${toA(r.orders)}</b><span>طلب</span></div>
        <div class="sh-stat"><b>${fmt(r.expected)}</b><span>النقد المتوقع بالدرج</span></div>
        <div class="sh-stat"><b>${fmt(r.card)}</b><span>مبيعات البطاقة</span></div>
      </div>
      ${ln('💵 رصيد افتتاحي', money(shift.openingCash))}
      ${ln('(+) مبيعات نقدية', money(r.cash), 'pos')}
      ${r.refunds ? ln('(−) مرتجع نقدي (طلبات ملغية)', '- ' + money(r.refunds), 'neg') : ''}
      ${r.cashIn ? ln('(+) إيداعات', money(r.cashIn), 'pos') : ''}
      ${r.cashOut ? ln('(−) مسحوبات', '- ' + money(r.cashOut), 'neg') : ''}
      ${ln('= المتوقع بالدرج', money(r.expected))}
      ${r.later ? ln('⏳ غير محصّل (آجل)', money(r.later), 'neg') : ''}
      ${r.cod ? ln('🏍️ دلفري عند الكباتن', money(r.cod)) : ''}
      ${r.disc ? ln('٪ الخصومات', money(r.disc)) : ''}
      <div class="sh-btns">
        <button class="btn-soft" onclick="shiftMove('in')">➕ إيداع نقدي</button>
        <button class="btn-soft" onclick="shiftMove('out')">➖ سحب نقدي</button>
        <button class="btn-soft" onclick="shiftPrint('x')">🖨️ تقرير مؤقت (X)</button>
        <button class="btn-danger" onclick="shiftClose()">🔒 إغلاق الوردية</button>
      </div></div>` + closedHTML();
  }
  function closedHTML() {
    if (!closedShifts.length) return '';
    return `<div class="sh-card"><div class="sh-title">📜 الورديات السابقة</div>${closedShifts.map((s) => `
      <div class="sh-line"><span>${esc(new Date(s.closedAtMs).toLocaleString('ar-IQ'))}${s.cashier ? ' • ' + esc(s.cashier) : ''}<div class="ac-sub">مبيعات ${money(s.report && s.report.sales)} • فرق ${money(s.diff)}</div></span>
      <button class="ac-b" style="flex:0 0 auto" onclick="shiftReprint('${esc(s.id)}')">🖨️</button></div>`).join('')}</div>`;
  }
  window.shiftOpen = async () => {
    const cash = num($('shOpenCash').value), cashier = ($('shCashier').value || '').trim().slice(0, 40);
    lsSet('pos_cashier_name', cashier);
    const f = fb();
    try {
      const ref = f.doc(subCol('shifts'));
      shift = { id: ref.id, status: 'open', openedAtMs: Date.now(), openingCash: cash, cashier, cashMoves: [], device: deviceId };
      const { id, ...data } = shift;
      f.setDoc(ref, data).catch((e) => toast('❌ ' + (e.code || e.message)));
      $('shiftWarn').classList.remove('on');
      toast('🔓 تم فتح الوردية'); renderShift();
    } catch (e) { toast('❌ تعذّر فتح الوردية'); }
  };
  window.shiftMove = (type) => {
    acDialog(type === 'in' ? '➕ إيداع نقدي بالدرج' : '➖ سحب نقدي من الدرج', type === 'in' ? 'مثلاً: فكّة إضافية' : 'مثلاً: شراء مواد، دفع لمورد', [
      { id: 'a', label: 'المبلغ', type: 'number' }, { id: 'n', label: 'السبب' }], (v) => {
      const amount = num(v.a); if (!(amount > 0)) { toast('⚠️ أدخل المبلغ'); return false; }
      const mv = { type, amount, note: v.n.trim().slice(0, 80), ts: Date.now() };
      shift.cashMoves = [...(shift.cashMoves || []), mv];
      fb().updateDoc(sub('shifts', shift.id), { cashMoves: shift.cashMoves }).catch(() => toast('❌ تعذّر الحفظ'));
      renderShift(); toast('✅ تم التسجيل');
    });
  };
  window.shiftClose = () => {
    const r = shiftCalc(shift);
    acDialog('🔒 إغلاق الوردية', 'المتوقع بالدرج: ' + money(r.expected) + ' — عُدّ النقد وأدخل المبلغ الفعلي', [
      { id: 'c', label: '💵 النقد الفعلي بالدرج', type: 'number' }, { id: 'n', label: 'ملاحظة (اختياري)' }], (v) => {
      if (v.c === '') { toast('⚠️ أدخل النقد الفعلي'); return false; }
      const counted = num(v.c), report = shiftCalc(shift);
      const done = { status: 'closed', closedAtMs: Date.now(), countedCash: counted, expectedCash: report.expected, diff: counted - report.expected, note: v.n.trim().slice(0, 120), report };
      const closed = { ...shift, ...done };
      fb().updateDoc(sub('shifts', shift.id), done).catch(() => toast('❌ تعذّر الحفظ'));
      printShift(closed, 'z');
      closedShifts = [closed, ...closedShifts].slice(0, 15);
      shift = null; $('shiftWarn').classList.add('on'); renderShift();
      toast(done.diff === 0 ? '✅ أُغلقت الوردية — الدرج مطابق' : (done.diff > 0 ? '⚠️ زيادة ' : '⚠️ عجز ') + money(Math.abs(done.diff)));
    }, '🔒 إغلاق وطباعة التقرير');
  };
  window.shiftPrint = () => { if (shift) printShift({ ...shift, report: shiftCalc(shift) }, 'x'); };
  window.shiftReprint = (id) => { const s = closedShifts.find((x) => x.id === id); if (s) printShift(s, 'z'); };
  function printShift(sh, kind) {
    const r = sh.report || shiftCalc(sh);
    const row = (a, b, bold) => `<div class="row" style="${bold ? 'font-weight:900;font-size:13px' : ''}"><span>${a}</span><span>${b}</span></div>`;
    printHTML(`<html><head><meta charset="UTF-8"><style>body{font-family:Tajawal,Arial,sans-serif;direction:rtl;padding:12px;width:${settings.paper === 58 ? 210 : 300}px}
      h2{text-align:center;font-size:16px}.sub{text-align:center;font-size:11px;margin-bottom:6px}.row{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}.div{border-top:1px dashed #000;margin:6px 0}</style></head><body>
      <h2>${kind === 'z' ? '🔒 تقرير إغلاق الوردية (Z)' : '🧾 تقرير مؤقت (X)'}</h2>
      <div class="sub">${esc(settings.receiptTitle || restData.name || '')}<br>${esc(new Date(sh.openedAtMs).toLocaleString('ar-IQ'))} ← ${esc(new Date(sh.closedAtMs || Date.now()).toLocaleString('ar-IQ'))}${sh.cashier ? '<br>👤 ' + esc(sh.cashier) : ''}</div><div class="div"></div>
      ${row('عدد الطلبات', r.orders)}${row('المجموع قبل الخصم', fmt(r.sub))}${r.disc ? row('الخصومات', '-' + fmt(r.disc)) : ''}${r.service ? row('الخدمة', fmt(r.service)) : ''}${r.tax ? row('الضريبة', fmt(r.tax)) : ''}
      ${row('صافي المبيعات', fmt(r.sales), true)}<div class="div"></div>
      ${row('🪑 صالة (' + r.byType.salon.n + ')', fmt(r.byType.salon.v))}${row('🥡 سفري (' + r.byType.takeaway.n + ')', fmt(r.byType.takeaway.v))}${row('🏍️ دلفري (' + r.byType.delivery.n + ')', fmt(r.byType.delivery.v))}
      <div class="div"></div>${row('💵 نقداً', fmt(r.cash))}${row('💳 بطاقة', fmt(r.card))}${r.later ? row('⏳ آجل غير محصّل', fmt(r.later)) : ''}${r.cod ? row('🏍️ عند الكباتن', fmt(r.cod)) : ''}
      ${r.cancelled ? row('❌ ملغي (' + r.cancelled + ')', fmt(r.cancelledV)) : ''}<div class="div"></div>
      ${row('رصيد افتتاحي', fmt(sh.openingCash || 0))}${row('(+) مبيعات نقدية', fmt(r.cash))}${r.refunds ? row('(−) مرتجع نقدي', '-' + fmt(r.refunds)) : ''}${r.cashIn ? row('(+) إيداعات', fmt(r.cashIn)) : ''}${r.cashOut ? row('(−) مسحوبات', '-' + fmt(r.cashOut)) : ''}
      ${row('= المتوقع بالدرج', fmt(r.expected), true)}
      ${sh.countedCash != null ? row('النقد الفعلي', fmt(sh.countedCash), true) + row(sh.diff >= 0 ? 'زيادة' : 'عجز', fmt(Math.abs(sh.diff)), true) : ''}
      ${(sh.cashMoves || []).length ? '<div class="div"></div>' + sh.cashMoves.map((m) => row((m.type === 'in' ? '➕ ' : '➖ ') + esc(m.note || ''), fmt(m.amount))).join('') : ''}
      ${sh.note ? '<div class="div"></div><div style="font-size:11px">📝 ' + esc(sh.note) + '</div>' : ''}
      </body></html>`);
  }

  // ══════════ شاشة المطبخ ══════════
  const kdsList = () => orders.filter((o) => o.kitchen === 'new' && o.status !== 'cancelled' && (Date.now() - (o.createdAtMs || 0)) < 86400000)
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
    $('kdsGrid').innerHTML = list.length ? list.map((o) => {
      const m = Math.floor((Date.now() - (o.createdAtMs || Date.now())) / 60000), t = getOrderType(o);
      const cls = m >= 20 ? 'late' : m >= 10 ? 'warn' : '';
      const label = t === 'salon' ? '🪑 ' + (o.tableNo ? 'طاولة ' + o.tableNo : 'صالة #' + (o.salonNum || '')) : t === 'takeaway' ? '🥡 ' + (o.holdNum ? 'سفري #' + o.holdNum : 'سفري') : '🏍️ دلفري';
      return `<div class="kds-card ${cls}"><div class="kds-top"><div><div class="kds-num">${esc(label)}</div><div class="kds-type">#${esc(o.id.substring(0, 6).toUpperCase())} • ${esc(o.createdAt || '')}</div></div>
        <div class="kds-time">⏱ ${toA(m)} د</div></div>
        <div class="kds-items">${orderItemsFull(o).map((i, k) => { const n = (o.items && o.items[k] && o.items[k].note) || ''; return `<div class="kds-it"><span class="q">${toA(i.qty)}×</span><span>${esc(i.name)}${i.variant && i.variant !== 'وحدة' ? ' (' + esc(i.variant) + ')' : ''}${n ? `<span class="n">📝 ${esc(n)}</span>` : ''}</span></div>`; }).join('')}</div>
        ${o.note ? `<div class="kds-note">📝 ${esc(o.note)}</div>` : ''}
        <button class="kds-done" onclick="kdsDone('${esc(o.id)}')">✅ جاهز</button></div>`;
    }).join('') : '<div class="kds-empty"><div class="i">👨‍🍳</div><b>لا توجد طلبات قيد التحضير</b><br><small>الطلبات الجديدة تظهر هنا تلقائياً</small></div>';
  }
  window.kdsDone = async (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    const fields = { kitchen: 'ready', kitchenReadyAt: Date.now() };
    try {
      if (o.status === 'preparing') await orderUpdate(id, { ...fields, status: 'ready', readyAt: Date.now() }, 'الطلب جاهز للاستلام', 'ready');
      else await fb().updateDoc(fb().doc(fb().db, 'orders', id), fields);
      toast('✅ جاهز');
    } catch (e) { toast('❌ تعذّر التحديث'); }
  };
  window.kdsToggleSound = () => { kdsSound = !kdsSound; lsSet('pos_kds_sound', kdsSound); $('kdsSoundBtn').textContent = kdsSound ? '🔔 الصوت: يعمل' : '🔕 الصوت: مطفأ'; if (kdsSound) kdsBeep(); };
  setInterval(() => { if (restData && $('kitchenScreen').classList.contains('on')) renderKds(); }, 30000);

  // تحديث الشاشات عند وصول الطلبات
  const _renderOrders = renderOrders;
  window.renderOrders = renderOrders = function () {
    _renderOrders();
    renderKds();
    if (shift && $('shiftScreen').classList.contains('on')) renderShift();
  };

  // ══════════ الإعدادات (واجهة) ══════════
  const _showMTab = window.showMTab;
  window.showMTab = (tab) => {
    if (tab === 'settings' ? !can('settings') : !can('menu')) { deny(); return; }
    if (tab !== 'settings') { $('mSetSec').style.display = 'none'; $('mt4').classList.remove('on'); _showMTab(tab); return; }
    ['mAddSec', 'mListSec', 'mCatsSec'].forEach((id) => { $(id).style.display = 'none'; });
    ['mt1', 'mt2', 'mt3'].forEach((id) => $(id).classList.remove('on'));
    $('mt4').classList.add('on');
    $('mSetSec').style.display = 'block';
    renderSettings();
  };
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
      </div>
      <div class="sh-card"><div class="sh-title">💰 الأسعار والضرائب</div>
        <div class="set-row"><div><div class="flbl">ضريبة ٪ (0 = بدون)</div><input class="finp" id="stTax" type="number" min="0" max="50" value="${s.taxPct || 0}"></div>
          <div><div class="flbl">خدمة الصالة ٪</div><input class="finp" id="stSvc" type="number" min="0" max="50" value="${s.servicePct || 0}"></div></div>
        <div class="set-row"><div><div class="flbl">أجرة التوصيل الافتراضية</div><input class="finp" id="stFee" type="number" min="0" value="${s.defaultFee || 0}"></div>
          <div><div class="flbl">أزرار الأجرة السريعة (مفصولة بفاصلة)</div><input class="finp" id="stFees" value="${esc((s.feePresets || []).join(','))}"></div></div>
        <div class="set-row"><div><div class="flbl">عدد الطاولات (0 = بدون)</div><input class="finp" id="stTables" type="number" min="0" max="200" value="${s.tables || 0}"></div><div></div></div>
      </div>
      <div class="sh-card"><div class="sh-title">⚡ السرعة</div>
        <label class="set-check"><input type="checkbox" id="stQuick" ${s.quickAdd ? 'checked' : ''}> إضافة سريعة: الصنف ذو السعر الواحد ينضاف بضغطة واحدة</label>
        <div class="flbl">ملاحظات سريعة للمطبخ (مفصولة بفاصلة)</div><input class="finp" id="stNotes" value="${esc((s.quickNotes || []).join('، '))}">
      </div>
      <button class="sivbtn" onclick="saveSettings()">✅ حفظ الإعدادات</button>
      <div class="sh-card" style="margin-top:10px"><div class="sh-title">🔔 إشعارات المطعم</div>
        <div class="ac-sub" style="margin-bottom:8px">إشعار عند رفض الكابتن لطلب أو عند تسليمه — حتى لو كان التطبيق مغلقاً. الحالة: <b>${notifState}</b></div>
        <button class="btn-soft" style="width:100%" onclick="enableRestPush()">🔔 تفعيل الإشعارات على هذا الجهاز</button></div>
      <div class="sh-card"><div class="sh-title">⌨️ اختصارات لوحة المفاتيح</div>
        <div class="ac-sub" style="line-height:2"><kbd>/</kbd> بحث عن صنف • <kbd>F9</kbd> ترحيل الطلب • <kbd>1</kbd>-<kbd>4</kbd> نوع الطلب • <kbd>Enter</kbd> تأكيد الدفع • <kbd>Esc</kbd> إغلاق</div></div>`;
  }
  window.saveSettings = async () => {
    const list = (v) => String(v || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v)));
    const next = {
      receiptTitle: $('stTitle').value.trim(), receiptSub: $('stSub').value.trim(), receiptPhone: $('stPhone').value.trim(), receiptFooter: $('stFooter').value.trim(),
      paper: $('stPaper').value === '58' ? 58 : 80, printKitchen: $('stKitchen').checked,
      taxPct: clamp($('stTax').value, 0, 50), servicePct: clamp($('stSvc').value, 0, 50), defaultFee: clamp($('stFee').value, 0, 1e6),
      feePresets: list($('stFees').value).map(num).filter((x) => x > 0).slice(0, 4), tables: Math.round(clamp($('stTables').value, 0, 200)),
      quickAdd: $('stQuick').checked, quickNotes: list($('stNotes').value).slice(0, 10).map((x) => x.slice(0, 30)),
    };
    settings = { ...DEFAULTS, ...next };
    lsSet(setKey(), settings);
    try { await fb().setDoc(sub('settings', 'main'), { ...settings, updatedAtMs: Date.now() }); toast('✅ تم حفظ الإعدادات لكل أجهزة المطعم'); }
    catch (e) { toast('⚠️ حُفظت على هذا الجهاز فقط — تحقق من الإنترنت'); }
    renderCart();
  };
  function listenSettings() {
    settings = { ...DEFAULTS, ...lsGet(setKey(), {}) };
    unsubs.push(fb().onSnapshot(sub('settings', 'main'), (s) => {
      if (!s.exists()) return;
      const { updatedAtMs, ...d } = s.data();
      settings = { ...DEFAULTS, ...d };
      lsSet(setKey(), settings);
      renderCart();
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
  const TABS = ['cashier', 'orders', 'kitchen', 'shift', 'reports', 'menu', 'acc'];
  const TAB_PERM = { reports: 'reports', acc: 'inventory' };
  const tabAllowed = (t) => t === 'menu' ? (can('menu') || can('settings')) : (!TAB_PERM[t] || can(TAB_PERM[t]));
  window.goTab = (tab) => {
    if (!TABS.includes(tab)) tab = 'cashier';
    if (!tabAllowed(tab)) { deny(); return; }
    TABS.forEach((t) => $(t + 'Screen').classList.toggle('on', t === tab));
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'reports') renderRep();
    if (tab === 'orders') renderOrders();
    if (tab === 'menu') {
      initMenuManage();
      // الكاشير بدون صلاحية المنيو يدخل مباشرة للإعدادات (إن سُمح له)
      if (!can('menu')) showMTab('settings'); else if ($('mt4').classList.contains('on')) { if (can('settings')) renderSettings(); else showMTab('add'); }
    }
    if (tab === 'acc') renderAcc();
    if (tab === 'kitchen') renderKds();
    if (tab === 'shift') { renderShift(); loadClosedShifts().then(() => { if ($('shiftScreen').classList.contains('on')) renderShift(); }); }
  };
  window.updateAccBadge = updateAccBadge = function () {
    const n = lowCount();
    const b = $('nb5'); if (b) { const ni = b.querySelector('.ni'); if (ni) ni.textContent = n ? '📦❗' : '📦'; }
    const d = document.querySelector('.dnb[data-tab="acc"]'); if (d) d.textContent = '📦 المخزون والحسابات' + (n ? ' (' + toA(n) + ')' : '');
  };

  const _ordCancel = window.ordCancel;
  window.ordCancel = (id) => { if (!can('cancel')) { deny(); return; } _ordCancel(id); };

  // ══════════ الصلاحيات (واجهة) ══════════
  function applyPerms() {
    const u = window.posUser || {};
    document.querySelectorAll('[data-tab]').forEach((b) => { b.style.display = tabAllowed(b.dataset.tab) ? '' : 'none'; });
    $('mt1').style.display = $('mt2').style.display = $('mt3').style.display = can('menu') ? '' : 'none';
    $('mt4').style.display = can('settings') ? '' : 'none';
    const os = $('ordSum'); if (os) os.style.display = can('reports') ? '' : 'none';
    const rn = $('restName');
    if (rn) rn.textContent = (restData.name || 'المطعم') + (u.role === 'cashier' ? ' • 👤 ' + (u.name || 'كاشير') : '');
    const ts = $('themeSwitcher'); if (ts && u.role === 'cashier' && !can('settings')) ts.style.display = 'none';
    // إذا كان على شاشة لم يعد مسموحاً بها
    const cur = TABS.find((t) => $(t + 'Screen').classList.contains('on'));
    if (cur && !tabAllowed(cur)) goTab('cashier');
    renderCart();
  }
  // الصلاحيات تتحدّث فوراً عند تغييرها من تطبيق الإدارة
  function listenMe() {
    const u = window.posUser; if (!u || u.role !== 'cashier') return;
    unsubs.push(fb().onSnapshot(fb().doc(fb().db, 'users', u.uid), (s) => {
      const d = s.exists() ? s.data() : null;
      if (!d || d.disabled || d.role !== 'cashier') { toast('⛔ تم إيقاف حسابك'); setTimeout(() => fb().signOut(fb().auth), 1500); return; }
      const before = JSON.stringify(u.perms || {});
      u.perms = d.perms || {}; u.name = d.name || u.name;
      if (before !== JSON.stringify(u.perms)) { applyPerms(); toast('🔄 تم تحديث صلاحياتك'); }
    }, () => {}));
  }

  // ══════════ سجل الزبائن ══════════
  let curCust = null;            // الزبون الحالي (من مكالمة أو بحث)
  const custCache = new Map();
  function phoneKey(p) {
    let x = String(p || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, '');
    if (x.startsWith('00964')) x = x.slice(5); else if (x.startsWith('964')) x = x.slice(3);
    if (x.length === 10 && x[0] === '7') x = '0' + x;
    return x;
  }
  async function getCustomer(phone) {
    const k = phoneKey(phone); if (k.length < 7) return null;
    if (custCache.has(k)) return custCache.get(k);
    try { const s = await fb().getDoc(sub('customers', k)); const d = s.exists() ? s.data() : null; custCache.set(k, d); return d; }
    catch (e) { return null; }
  }
  function saveCustomer(o) {
    const k = phoneKey(o.phone); if (k.length < 7 || !rid()) return;
    const f = fb(), counts = {};
    (o.items || []).forEach((i) => { const n = String(i.name || '').slice(0, 60); if (n) counts[n] = f.increment(i.qty || 1); });
    const d = { phone: k, orders: f.increment(1), spent: f.increment(o.value || 0), lastOrderAt: Date.now(),
      lastItems: (o.items || []).slice(0, 15).map((i) => { const x = { name: i.name, variant: i.variant, qty: i.qty }; if (i.note) x.note = i.note; return x; }), itemCounts: counts };
    if (o.customer && !/^(سفري|صالة|طاولة)/.test(o.customer)) d.name = String(o.customer).slice(0, 60);
    if (o.address) d.address = String(o.address).slice(0, 200);
    f.setDoc(sub('customers', k), d, { merge: true }).catch(() => {});
    custCache.delete(k);
  }
  const ago = (ms) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : 'قبل ' + toA(d) + ' يوم'; };
  function favs(d, n) { return Object.entries((d && d.itemCounts) || {}).sort((a, b) => b[1] - a[1]).slice(0, n || 3); }
  function custSummary(d) {
    if (!d) return '<span class="cs-new">🆕 زبون جديد</span>';
    const f = favs(d, 3);
    return `<b>${esc(d.name || 'بدون اسم')}</b>${d.address ? ' • 📍 ' + esc(d.address) : ''}<br>
      ⭐ ${toA(d.orders || 0)} طلب${d.spent ? ' • ' + money(d.spent) : ''}${d.lastOrderAt ? ' • آخر طلب ' + ago(d.lastOrderAt) : ''}
      ${f.length ? '<br>❤️ ' + f.map(([n, q]) => esc(n) + ' ×' + toA(q)).join('، ') : ''}`;
  }
  function showCustHint(d) {
    const el = $('custHint'); if (!el) return;
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
    el.innerHTML = `<div style="flex:1;min-width:0">📞 <b dir="ltr">${esc(curCust.phone)}</b> — ${curCust.data ? esc(curCust.data.name || 'زبون') + ' • ' + toA(curCust.data.orders || 0) + ' طلب' : 'زبون جديد'}</div><button type="button" title="إلغاء" onclick="clearCurCust()">✕</button>`;
  }
  window.clearCurCust = () => { curCust = null; renderCart(); };
  // سفري قيد التحضير: نفس التعبئة التلقائية
  window.openHold = () => {
    if (!cart.length) return;
    const d = curCust && curCust.data;
    acDialog('🍳 حفظ الطلب قيد التحضير', 'يبقى بالكاشير لحد ما تحوله للكابتن أو يستلمه الزبون', [
      { id: 'name', label: 'اسم الزبون (اختياري)', ph: 'مثال: أبو علي', value: (d && d.name) || '' },
      { id: 'phone', label: 'رقم الهاتف (اختياري)', type: 'tel', ph: '07xxxxxxxxx', value: curCust ? curCust.phone : '' },
      { id: 'note', label: 'ملاحظة للمطبخ (اختياري)', ph: 'بدون بصل...' },
    ], (v) => { holdOrder({ name: v.name.trim(), phone: v.phone.trim(), note: v.note.trim() }); }, '🍳 حفظ وطباعة تذكرة المطبخ');
  };

  // ══════════ المكالمات الواردة (توكن جوكر) ══════════
  const calls = new Map();      // id -> {id, number, line, data, at}
  let callsReady = false, callRingT = null;
  function listenCalls() {
    const f = fb();
    callsReady = false; calls.clear(); renderCalls();
    unsubs.push(f.onSnapshot(f.query(f.collection(f.db, 'incomingCalls'), f.where('restaurantId', '==', rid()), f.where('status', '==', 'ringing')), (s) => {
      if (!callsReady) { callsReady = true; return; }   // مكالمات قديمة قبل فتح الكاشير لا تُعرض
      s.docChanges().forEach((ch) => {
        if (ch.type === 'added') {
          const c = { id: ch.doc.id, ...ch.doc.data(), at: Date.now(), data: undefined };
          calls.set(c.id, c);
          getCustomer(c.number).then((d) => { const x = calls.get(c.id); if (x) { x.data = d; renderCalls(); } });
          notifyCall(c);
        } else if (ch.type === 'removed') calls.delete(ch.doc.id);     // استلمها كاشير آخر
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
  function renderCalls() {
    const el = $('callsBox'); if (!el) return;
    // تختفي تلقائياً بعد دقيقتين
    [...calls.values()].forEach((c) => { if (Date.now() - c.at > 120000) calls.delete(c.id); });
    el.innerHTML = [...calls.values()].sort((a, b) => b.at - a.at).slice(0, 4).map((c) => `
      <div class="call-card">
        <div class="call-top"><span class="call-pulse">📞</span> مكالمة واردة <span class="call-line">خط ${esc(c.line || '—')}</span>
          <button type="button" class="call-x" title="إخفاء" onclick="callHide('${esc(c.id)}')">✕</button></div>
        <button type="button" class="call-num" onclick="callTake('${esc(c.id)}')" dir="ltr">${esc(phoneKey(c.number) || c.number)}</button>
        <div class="call-info">${c.data === undefined ? '⏳ جاري البحث عن الزبون…' : custSummary(c.data)}</div>
        <div class="call-btns">
          <button type="button" class="call-go" onclick="callTake('${esc(c.id)}')">✅ استلام وتعبئة</button>
          ${c.data && (c.data.lastItems || []).length ? `<button type="button" onclick="callTake('${esc(c.id)}',true)">🔁 كرر آخر طلب</button>` : ''}
        </div>
      </div>`).join('');
  }
  setInterval(() => { if (calls.size) renderCalls(); }, 15000);
  window.callHide = (id) => { calls.delete(id); renderCalls(); };
  window.callTake = async (id, repeat) => {
    const c = calls.get(id); if (!c) return;
    calls.delete(id); clearInterval(callRingT); renderCalls();
    fb().updateDoc(fb().doc(fb().db, 'incomingCalls', id), { status: 'taken', takenBy: deviceId, takenAtMs: Date.now() }).catch(() => {});
    const d = c.data === undefined ? await getCustomer(c.number) : c.data;
    curCust = { phone: phoneKey(c.number) || c.number, data: d };
    goTab('cashier');
    if (repeat) repeatLast();
    renderCart();
    if (window.matchMedia('(max-width:600px)').matches && repeat) document.querySelector('.cside').classList.add('open');
    toast(d ? '👤 ' + (d.name || 'الزبون') + ' — اختر الأصناف ثم «ترحيل» والمعلومات معبّأة' : '🆕 زبون جديد — الرقم معبّأ تلقائياً');
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

  // ══════════ التشغيل بعد تسجيل الدخول ══════════
  const _enterApp = enterApp;
  window.enterApp = enterApp = function () {
    disc = { type: 'amt', value: 0, reason: '' }; prodQuery = ''; shift = null; kdsSeen.clear(); kdsReady = false;
    if ($('prodSearch')) $('prodSearch').value = '';
    listenSettings();
    _enterApp();
    listenMenu();
    listenShifts();
    listenCalls();
    listenMe();
    curCust = null; custCache.clear();
    applyPerms();
    $('kdsSoundBtn').textContent = kdsSound ? '🔔 الصوت: يعمل' : '🔕 الصوت: مطفأ';
    if ('Notification' in window && Notification.permission === 'granted') registerRestPush(false);
  };
})();
