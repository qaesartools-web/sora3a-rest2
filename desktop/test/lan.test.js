// شبكة المطعم: المصافحة بالرمز السري، الرسائل بالاتجاهين، الأحداث الموقّعة بالبث، ورجوع الاتصال
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHub, createClient, hmac, macEvent } = require('../lan');

const KEY = 'a'.repeat(64), RID = 'R1';
const port = () => 41000 + Math.floor(Math.random() * 9000);
const wait = (ev, name, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout ' + name)), ms);
  ev.on(name, function h(v) { clearTimeout(t); ev.off(name, h); res(v); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rig() {
  const u = port();
  const hub = createHub({ udpPort: u, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const mk = (role, cfg) => { const c = createClient({ role, udpPort: u, targets: ['127.0.0.1'] }); c.cfg = { rid: RID, key: KEY, dev: role + '-1', name: role, ...cfg }; return c; };
  return { hub, mk, up: u };
}

test('HMAC vectors match the Android implementation (LanProtoTest.java)', () => {
  assert.equal(hmac('k'.repeat(64), 'c|sn|cn|R1|kitchen|D1'), 'f0e61934b7265f7e74acda9d3a391c5ea96963a03e9a14f03df95d0811a8cb71');
  assert.equal(macEvent('0123456789abcdef0123456789abcdef', 'R1', 'D1', 'id1', 1700000000000, '{"t":"call"}'), '0976c10eed9d2c5f19118e3aa0923d5c98d5214ada829d5f45fcc03380535431');
});

test('a kitchen finds the cashier, both sides prove the key, and messages flow both ways', async () => {
  const { hub, mk } = rig();
  const st = await hub.start({ rid: RID, key: KEY, dev: 'hub-1', name: 'كاشير 1' });
  assert.equal(st.on, true); assert.ok(st.port > 0);
  const k = mk('kitchen');
  const joined = wait(hub, 'join'), kj = wait(k, 'join');
  await k.start(k.cfg);
  const j = await joined, hj = await kj;
  assert.equal(j.role, 'kitchen'); assert.equal(j.dev, 'kitchen-1'); assert.equal(hj.id, 'hub-1'); assert.equal(hj.name, 'كاشير 1');
  assert.deepEqual(hub.status().peers.map((p) => p.role), ['kitchen']);
  const got = wait(k, 'msg');
  hub.send('*', { t: 'state', orders: [{ id: 'o1', items: [{ name: 'تكة', qty: 2 }] }] });
  assert.deepEqual((await got).d, { t: 'state', orders: [{ id: 'o1', items: [{ name: 'تكة', qty: 2 }] }] });
  const up = wait(hub, 'msg');
  k.send('hub-1', { t: 'act', id: 'o1', op: 'ready' });
  const m = await up;
  assert.equal(m.id, j.id); assert.equal(m.role, 'kitchen'); assert.deepEqual(m.d, { t: 'act', id: 'o1', op: 'ready' });
  // لنوع معيّن بس
  const s = mk('screen'); const sj = wait(hub, 'join'); await s.start(s.cfg); await sj;
  let kGot = 0; k.on('msg', () => kGot++);
  const sGot = wait(s, 'msg');
  hub.send('role:screen', { t: 'x' });
  assert.deepEqual((await sGot).d, { t: 'x' });
  await sleep(150); assert.equal(kGot, 0);
  const left = wait(hub, 'leave');
  k.stop();
  assert.equal((await left).role, 'kitchen');
  s.stop(); hub.stop();
});

test('a device with the wrong key or another restaurant never gets in', async () => {
  const { hub, mk } = rig();
  await hub.start({ rid: RID, key: KEY, dev: 'hub-1', name: 'كاشير' });
  let joins = 0; hub.on('join', () => joins++);
  const bad = mk('kitchen', { key: 'b'.repeat(64) });
  let badJoin = 0; bad.on('join', () => badJoin++);
  await bad.start(bad.cfg);
  const other = mk('screen', { rid: 'R2' });
  await other.start(other.cfg);
  await sleep(1500);
  assert.equal(joins, 0); assert.equal(badJoin, 0);
  assert.deepEqual(other.hubs(), []);   // الكاشير ما يجاوب مطعم ثاني
  bad.stop(); other.stop(); hub.stop();
});

test('signed broadcast events reach the cashier once; forged or replayed ones are dropped', async () => {
  const { hub, mk, up } = rig();
  await hub.start({ rid: RID, key: KEY, dev: 'hub-1', name: 'كاشير' });
  const line = mk('line');
  await line.start(line.cfg);
  const got = [];
  hub.on('ev', (e) => got.push(e));
  line.broadcast({ t: 'call', id: 'c1', number: '07701234567', line: '1' });
  await sleep(300);
  assert.deepEqual(got, [{ dev: 'line-1', d: { t: 'call', id: 'c1', number: '07701234567', line: '1' } }]);
  // مزوّر (رمز غلط) ما ينقبل
  const forger = mk('line', { key: 'c'.repeat(64), dev: 'line-x' });
  await forger.start(forger.cfg);
  forger.broadcast({ t: 'call', id: 'c2', number: '0000', line: '1' });
  await sleep(300);
  assert.equal(got.length, 1);
  // نفس الحزمة مرتين (إعادة إرسال) ← مرة وحدة
  const dgram = require('dgram'), u = dgram.createSocket('udp4'), at = Date.now(), d = JSON.stringify({ t: 'call', id: 'c3' });
  const pkt = Buffer.from(JSON.stringify({ t: 'ev', rid: RID, dev: 'line-9', id: 'e9', at, d, mac: macEvent(KEY, RID, 'line-9', 'e9', at, d) }));
  await new Promise((r) => u.send(pkt, up, '127.0.0.1', r));
  await new Promise((r) => u.send(pkt, up, '127.0.0.1', r));
  await sleep(300);
  u.close();
  assert.deepEqual(got.slice(1).map((e) => e.d.id), ['c3']);
  line.stop(); forger.stop(); hub.stop();
});

test('the kitchen reconnects by itself when the cashier program restarts', async () => {
  const { hub, mk } = rig();
  const cfg = { rid: RID, key: KEY, dev: 'hub-1', name: 'كاشير' };
  await hub.start(cfg);
  const k = mk('kitchen');
  await k.start(k.cfg);
  await wait(k, 'join');
  const left = wait(k, 'leave');
  hub.stop();
  await left;
  const back = wait(k, 'join', 8000);
  await hub.start(cfg);
  assert.equal((await back).id, 'hub-1');
  k.stop(); hub.stop();
});
