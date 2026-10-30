// شبكة المطعم (بنت أو بدون نت): الكاشير «مركز» على الواي فاي، وشاشة المطبخ/المجهز وشاشة «طلبك جاهز» وتلفون الخط يتصلون بيه مباشرة
//  UDP 47800: «وين الكاشير؟» (find ← hub) + أحداث صغيرة موقّعة (ev: مكالمة، «استلمها كاشير»)
//  TCP 47801: سطر JSON بكل رسالة. أول شي مصافحة بالرمز السري للمطعم (HMAC) من الطرفين — محد يتصل أو يزوّر بدون الرمز
//  نفس البروتوكول بالأندرويد (LanProto.java) — أي تغيير هنا لازم ينعاد هناك
'use strict';
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const UDP_PORT = 47800, TCP_PORT = 47801, VER = 1;
const MAX_LINE = 16 * 1024 * 1024;
const PING_MS = 15000, IDLE_MS = 45000, AUTH_MS = 10000;
const EV_AGE = 10 * 60000;
const ROLES = ['kitchen', 'screen', 'line'];

const hmac = (key, s) => crypto.createHmac('sha256', Buffer.from(String(key), 'utf8')).update(String(s), 'utf8').digest('hex');
const nonce = () => crypto.randomBytes(16).toString('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const macClient = (key, sn, cn, rid, role, dev) => hmac(key, ['c', sn, cn, rid, role, dev].join('|'));
const macServer = (key, cn, sn, rid, dev) => hmac(key, ['s', cn, sn, rid, dev].join('|'));
const macEvent = (key, rid, dev, id, at, d) => hmac(key, ['e', rid, dev, id, at, d].join('|'));
const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanCfg(c) {
  c = c || {};
  const x = { rid: str(c.rid, 80), key: str(c.key, 200), dev: str(c.dev, 80), name: str(c.name, 60) };
  return x.rid && x.key.length >= 32 && x.dev ? x : null;
}

// عناوين البث لكل شبكة بالجهاز (192.168.1.255…) + البث العام
function bcastAddrs() {
  const out = new Set(['255.255.255.255']);
  Object.values(os.networkInterfaces()).flat().forEach((i) => {
    if (!i || i.internal || (i.family !== 'IPv4' && i.family !== 4) || !i.netmask) return;
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    if (a.length === 4 && m.length === 4) out.add(a.map((v, k) => (v | (~m[k] & 255)) >>> 0).join('.'));
  });
  return [...out];
}
function localIps() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && (i.family === 'IPv4' || i.family === 4)).map((i) => i.address);
}

// سطر بكل رسالة. يرجع send/close، ويطفي الاتصال إذا سكت 45 ثانية
function wire(sock, onLine, onClose) {
  let buf = '', dead = false, idleT = 0;
  const close = () => { if (dead) return; dead = true; clearInterval(pingT); clearTimeout(idleT); sock.destroy(); onClose(); };
  const idle = () => { clearTimeout(idleT); idleT = setTimeout(close, IDLE_MS); };
  const send = (o) => { if (dead) return false; try { sock.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n'); return true; } catch (e) { close(); return false; } };
  const pingT = setInterval(() => send({ t: 'ping' }), PING_MS);
  sock.setEncoding('utf8');
  sock.setNoDelay(true);
  sock.on('data', (chunk) => {
    idle();
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line) continue;
      const m = parse(line);
      if (!m) continue;
      if (m.t === 'ping') { send({ t: 'pong' }); continue; }
      if (m.t === 'pong') continue;
      onLine(m);
      if (dead) return;
    }
    if (buf.length > MAX_LINE) close();
  });
  sock.on('error', close);
  sock.on('close', close);
  idle();
  return { send, close, get dead() { return dead; } };
}

// حدث صغير موقّع بالبث (UDP): كل الأجهزة على نفس الراوتر تستلمه
function signEvent(cfg, d) {
  const id = nonce(), at = Date.now(), s = JSON.stringify(d);
  return JSON.stringify({ t: 'ev', rid: cfg.rid, dev: cfg.dev, id, at, d: s, mac: macEvent(cfg.key, cfg.rid, cfg.dev, id, at, s) });
}
function checkEvent(cfg, m, seen) {
  if (!m || m.t !== 'ev' || m.rid !== cfg.rid || m.dev === cfg.dev || typeof m.d !== 'string' || typeof m.id !== 'string') return null;
  if (!same(m.mac, macEvent(cfg.key, m.rid, m.dev, m.id, m.at, m.d)) || Math.abs(Date.now() - Number(m.at)) > EV_AGE) return null;
  if (seen.has(m.id)) return null;
  seen.set(m.id, Date.now());
  if (seen.size > 500) { const old = [...seen.keys()].slice(0, 200); old.forEach((k) => seen.delete(k)); }
  const d = parse(m.d);
  return d ? { dev: str(m.dev, 80), d } : null;
}

// ══ المركز (جهاز الكاشير) ══
//  opts: { udpPort, tcpPort, host, bcast: [عناوين] } — للتجارب. الأحداث: join / leave / msg / ev / status
function createHub(opts = {}) {
  const ev = new EventEmitter();
  const udpPort = opts.udpPort || UDP_PORT, tcpPort = opts.tcpPort == null ? TCP_PORT : opts.tcpPort, host = opts.host || '0.0.0.0';
  const clients = new Map(), seen = new Map();
  let cfg = null, srv = null, udp = null, err = '', seq = 0, port = 0;

  function status() {
    return { on: !!srv, err, rid: cfg ? cfg.rid : '', port, ips: localIps(),
      peers: [...clients.values()].map((c) => ({ id: c.id, role: c.role, dev: c.dev, name: c.name, ip: c.ip, since: c.since })) };
  }
  const emitStatus = () => ev.emit('status', status());

  function onConn(sock) {
    if (!cfg) return sock.destroy();
    const sn = nonce(), my = cfg, ip = String(sock.remoteAddress || '').replace(/^::ffff:/, '');
    let c = null;
    const authT = setTimeout(() => w.close(), AUTH_MS);
    const w = wire(sock, (m) => {
      if (!c) {
        const role = str(m.role, 20), dev = str(m.dev, 80), cn = str(m.n, 64);
        if (m.t !== 'auth' || m.rid !== my.rid || !ROLES.includes(role) || !dev || cn.length < 16 || !same(m.mac, macClient(my.key, sn, cn, my.rid, role, dev))) return w.close();
        clearTimeout(authT);
        // نفس الجهاز رجع اتصل (قبل ما ينقطع القديم): نسكّر القديم
        clients.forEach((o) => { if (o.dev === dev && o.role === role) o.w.close(); });
        c = { id: 'c' + (++seq), role, dev, name: str(m.name, 60), ip, since: Date.now(), w };
        clients.set(c.id, c);
        w.send({ t: 'ok', v: VER, mac: macServer(my.key, cn, sn, my.rid, my.dev) });
        ev.emit('join', { id: c.id, role: c.role, dev: c.dev, name: c.name, ip });
        emitStatus();
        return;
      }
      ev.emit('msg', { id: c.id, role: c.role, dev: c.dev, d: m });
    }, () => {
      clearTimeout(authT);
      if (c && clients.get(c.id) === c) { clients.delete(c.id); ev.emit('leave', { id: c.id, role: c.role, dev: c.dev }); emitStatus(); }
    });
    w.send({ t: 'hi', v: VER, rid: my.rid, dev: my.dev, name: my.name, n: sn });
  }

  function onUdp(buf, rinfo) {
    if (!cfg || buf.length > 64 * 1024) return;
    const m = parse(buf.toString('utf8'));
    if (!m) return;
    if (m.t === 'find' && m.rid === cfg.rid) {
      const r = Buffer.from(JSON.stringify({ t: 'hub', v: VER, rid: cfg.rid, dev: cfg.dev, name: cfg.name, port }));
      udp.send(r, rinfo.port, rinfo.address, () => {});
      return;
    }
    const e = checkEvent(cfg, m, seen);
    if (e) ev.emit('ev', e);
  }

  async function start(c) {
    const next = cleanCfg(c);
    if (!next) { stop(); err = 'بيانات ناقصة'; emitStatus(); return status(); }
    if (cfg && srv && next.rid === cfg.rid && next.key === cfg.key && next.dev === cfg.dev) { cfg.name = next.name; return status(); }
    stop();
    cfg = next; err = '';
    try {
      srv = net.createServer(onConn);
      await new Promise((res, rej) => { srv.once('error', rej); srv.listen(tcpPort, host, () => { srv.off('error', rej); res(); }); });
      port = srv.address().port;
      srv.on('error', (e) => { err = String(e.message || e); emitStatus(); });
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('message', onUdp);
      udp.on('error', (e) => { err = String(e.message || e); emitStatus(); });
      await new Promise((res, rej) => { udp.once('error', rej); udp.bind(udpPort, () => { udp.off('error', rej); try { udp.setBroadcast(true); } catch (e) {} res(); }); });
    } catch (e) {
      err = e && e.code === 'EADDRINUSE' ? 'المنفذ مستخدم ببرنامج ثاني' : String((e && e.message) || e);
      const keepErr = err; stop(); err = keepErr;
    }
    emitStatus();
    return status();
  }

  function stop() {
    clients.forEach((c) => c.w.close());
    clients.clear();
    if (srv) { try { srv.close(); } catch (e) {} srv = null; }
    if (udp) { try { udp.close(); } catch (e) {} udp = null; }
    cfg = null; port = 0;
  }

  // to: معرّف الجهاز، أو '*' للكل، أو 'role:kitchen' لنوع معيّن
  function send(to, m) {
    const line = JSON.stringify(m);
    const role = typeof to === 'string' && to.startsWith('role:') ? to.slice(5) : '';
    clients.forEach((c) => { if (to === '*' || c.id === to || (role && c.role === role)) c.w.send(line); });
  }

  function broadcast(d) {
    if (!cfg || !udp) return;
    const b = Buffer.from(signEvent(cfg, d));
    (opts.bcast || bcastAddrs()).forEach((a) => { try { udp.send(b, udpPort, a, () => {}); } catch (e) {} });
  }

  return { start, stop, send, broadcast, status, on: ev.on.bind(ev), off: ev.off.bind(ev) };
}

// ══ جهاز يتصل بالكاشير (شاشة المطبخ، الشاشة، الخط) — نفس اللي بالأندرويد؛ هنا للتجارب ══
//  opts: { role, udpPort, targets: [عناوين البحث] } — الأحداث: join / leave / msg / status
function createClient(opts = {}) {
  const ev = new EventEmitter();
  const role = opts.role, udpPort = opts.udpPort || UDP_PORT;
  const hubs = new Map();   // dev → {dev, name, ip, port, w, on}
  let cfg = null, udp = null, findT = 0;

  const list = () => [...hubs.values()].map((h) => ({ id: h.dev, name: h.name, ip: h.ip, on: !!h.on }));
  const emitStatus = () => ev.emit('status', { on: !!cfg, peers: list().filter((h) => h.on) });

  function connect(h) {
    if (h.w && !h.w.dead) return;
    const my = cfg, cn = nonce();
    const sock = net.connect({ host: h.ip, port: h.port });
    sock.setTimeout(5000, () => sock.destroy());
    sock.on('connect', () => sock.setTimeout(0));
    let sn = '';
    const w = h.w = wire(sock, (m) => {
      if (!h.on) {
        if (m.t === 'hi' && !sn) {
          if (m.rid !== my.rid || m.dev !== h.dev || typeof m.n !== 'string') return w.close();
          sn = m.n;
          w.send({ t: 'auth', v: VER, rid: my.rid, role, dev: my.dev, name: my.name, n: cn, mac: macClient(my.key, sn, cn, my.rid, role, my.dev) });
          return;
        }
        if (m.t === 'ok' && sn && same(m.mac, macServer(my.key, cn, sn, my.rid, h.dev))) {
          h.on = true; ev.emit('join', { id: h.dev, name: h.name, ip: h.ip }); emitStatus(); return;
        }
        return w.close();
      }
      ev.emit('msg', { id: h.dev, d: m });
    }, () => {
      if (h.w !== w) return;
      const was = h.on; h.on = false; h.w = null;
      if (was) { ev.emit('leave', { id: h.dev }); emitStatus(); }
    });
  }

  function find() {
    if (!cfg || !udp) return;
    const b = Buffer.from(JSON.stringify({ t: 'find', v: VER, rid: cfg.rid, dev: cfg.dev, role }));
    const to = new Set(opts.targets || bcastAddrs());
    hubs.forEach((h) => to.add(h.ip));
    to.forEach((a) => { try { udp.send(b, udpPort, a, () => {}); } catch (e) {} });
    clearTimeout(findT);
    findT = setTimeout(find, [...hubs.values()].some((h) => h.on) ? 15000 : 2000);
  }

  async function start(c) {
    stop();
    cfg = cleanCfg(c);
    if (!cfg) return;
    udp = dgram.createSocket('udp4');
    udp.on('error', () => {});
    udp.on('message', (buf, rinfo) => {
      const m = parse(buf.toString('utf8'));
      if (!m || m.t !== 'hub' || m.rid !== cfg.rid || !m.dev) return;
      const dev = str(m.dev, 80);
      const h = hubs.get(dev) || { dev };
      h.name = str(m.name, 60); h.ip = rinfo.address; h.port = Number(m.port) || 0;
      hubs.set(dev, h);
      if (h.port) connect(h);
    });
    await new Promise((res) => udp.bind(0, () => { try { udp.setBroadcast(true); } catch (e) {} res(); }));
    find();
  }
  function stop() {
    clearTimeout(findT);
    hubs.forEach((h) => { if (h.w) h.w.close(); });
    hubs.clear();
    if (udp) { try { udp.close(); } catch (e) {} udp = null; }
    cfg = null;
  }
  function send(to, m) {
    const line = JSON.stringify(m);
    hubs.forEach((h) => { if (h.on && (to === '*' || to === h.dev)) h.w.send(line); });
  }
  // حدث موقّع بالبث (الخط: المكالمة توصل حتى لو الاتصال بالكاشير ما خلص)
  function broadcast(d) {
    if (!cfg || !udp) return;
    const b = Buffer.from(signEvent(cfg, d));
    (opts.targets || bcastAddrs()).forEach((a) => { try { udp.send(b, udpPort, a, () => {}); } catch (e) {} });
  }
  return { start, stop, send, broadcast, hubs: list, on: ev.on.bind(ev), off: ev.off.bind(ev) };
}

module.exports = { createHub, createClient, hmac, macClient, macServer, macEvent, UDP_PORT, TCP_PORT };
