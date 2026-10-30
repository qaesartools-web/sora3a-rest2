// شبكة المطعم بالصفحات (بنت أو بدون نت): شاشة المطبخ/المجهز وشاشة «طلبك جاهز» تستلم طلبات الكاشير مباشرة على نفس الراوتر
//  تشتغل بتطبيقات الأندرويد بس (window.SoraLan من التطبيق) — بالمتصفح ما تسوي شي والصفحة تشتغل بالنت مثل قبل
//  الكاشير يرسل: {t:'state', full?, orders:[…], del:[ids], settings?, rest?} — والشاشة ترسل {t:'sync'} و {t:'act', rq, id, op…} وتستلم {t:'ack'}

const waitLan = (ms) => new Promise((res) => {
  if (window.SoraLan) return res(window.SoraLan);
  const t = setTimeout(() => res(window.SoraLan || null), ms);
  window.addEventListener('soralan', () => { clearTimeout(t); res(window.SoraLan || null); }, { once: true });
});

// نفس الطلب من كاشيرين: الأكثر تقدّماً (خلص ← جاهز ← أقسام جاهزة)
const DONE = ['delivered', 'done', 'cancelled'];
const score = (o) => (DONE.includes(o.status) || o.servedAtMs || o.pagerDone ? 4 : 0) + (o.kitchen === 'ready' || o.status === 'ready' ? 2 : 0)
  + Object.values(o.kSec || {}).filter((v) => v && v.readyAt).length / 100;

export function lanLink({ role, onChange }) {
  const hubs = new Map();   // معرّف الكاشير ← {name, orders: Map, settings, rest, synced}
  const pend = new Map();
  let L = null, seq = 0, fireT = 0;
  const fire = () => { clearTimeout(fireT); fireT = setTimeout(() => { try { onChange && onChange(); } catch (e) { console.warn('lan', e); } }, 30); };
  const hub = (id, name) => {
    let h = hubs.get(id);
    if (!h) { h = { name: name || '', orders: new Map(), settings: null, rest: null, synced: false }; hubs.set(id, h); }
    else if (name) h.name = name;
    return h;
  };
  function onEv(e) {
    if (!e || !e.t) return;
    if (e.t === 'join') { hub(e.id, e.name); L.send(e.id, { t: 'sync', role }); fire(); }
    else if (e.t === 'leave') { hubs.delete(e.id); fire(); }
    else if (e.t === 'msg' && e.d && e.id) {
      const d = e.d;
      if (d.t === 'state') {
        const h = hub(e.id);
        if (d.full) h.orders = new Map();
        (d.orders || []).forEach((o) => { if (o && o.id) h.orders.set(o.id, o); });
        (d.del || []).forEach((id) => h.orders.delete(id));
        if (d.settings) h.settings = d.settings;
        if (d.rest) h.rest = d.rest;
        if (d.hub && d.hub.name) h.name = d.hub.name;
        h.synced = true;
        fire();
      } else if (d.t === 'ack') { const p = pend.get(d.rq); if (p) { pend.delete(d.rq); p(!!d.ok); } }
    }
  }
  const ready = waitLan(4000).then((x) => {
    if (!x || x.role === 'hub') return null;
    L = x;
    L.on(onEv);
    // الصفحة انفتحت والتطبيق متصل من قبل: نطلب الطلبات من كل كاشير
    return Promise.resolve(L.status()).then((s) => { ((s && s.peers) || []).forEach((p) => { hub(p.id, p.name); L.send(p.id, { t: 'sync', role }); }); fire(); return L; }, () => L);
  });
  const synced = () => [...hubs.values()].filter((h) => h.synced);
  return {
    ready,
    // {rid, key, name}: تنحفظ بالتطبيق — حتى لو انقطع النت يتصل وحده بآخر إعدادات
    start: (cfg) => ready.then((x) => (x ? x.start(cfg) : null)),
    app: () => !!L,
    on: () => synced().length > 0,
    hubs: () => [...hubs.entries()].map(([id, h]) => ({ id, name: h.name, synced: h.synced })),
    orders() {
      const m = new Map();
      synced().forEach((h) => h.orders.forEach((o, id) => { const x = m.get(id); if (!x || score(o) > score(x)) m.set(id, o); }));
      return m;
    },
    settings: () => (synced().find((h) => h.settings) || {}).settings || null,
    rest: () => (synced().find((h) => h.rest) || {}).rest || null,
    has: (id) => synced().some((h) => h.orders.has(id)),
    // «جاهز» من الشاشة ← الكاشير اللي عنده الطلب يحفظه (ويرفعه للسحابة من يرجع النت). يرجع true إذا الكاشير أكّد
    act(id, op, extra) {
      const to = [...hubs.entries()].find(([, h]) => h.synced && h.orders.has(id));
      if (!L || !to) return Promise.resolve(false);
      const rq = role + '-' + Date.now().toString(36) + '-' + (++seq);
      return new Promise((res) => {
        const t = setTimeout(() => { pend.delete(rq); res(false); }, 6000);
        pend.set(rq, (ok) => { clearTimeout(t); res(ok); });
        L.send(to[0], { t: 'act', rq, id, op, ...(extra || {}) });
      });
    },
  };
}
