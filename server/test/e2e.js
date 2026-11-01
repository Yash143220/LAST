// Live smoke test: node test/e2e.js  (server must be running; default http://localhost:8080)
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8080';
const C = { lat: 20.2961, lng: 85.8245 };
const ALL = { terms: true, privacy: true, location: true, safety: true, age: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const off = (m, b = 0) => ({ lat: C.lat + (m * Math.cos(b)) / 110540, lng: C.lng + (m * Math.sin(b)) / (111320 * Math.cos((C.lat * Math.PI) / 180)) });

async function http(cookie, method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(name) {
  const r = await http(null, 'POST', '/api/auth/dev', { name, consents: ALL });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: r.cookie, user: r.body.user };
}
function connect(cookie) {
  const s = io(BASE, { extraHeaders: { cookie, origin: BASE }, transports: ['websocket'], reconnection: false });
  s.state = null; s.on('game:state', (v) => (s.state = v));
  s.emitA = (ev, p) => new Promise((res) => s.emit(ev, p || {}, res));
  return new Promise((res, rej) => { s.on('connect', () => res(s)); s.on('connect_error', rej); });
}

const step = (m) => console.log('  ✓', m);
(async () => {
  console.log('E2E against', BASE);
  assert.equal((await http(null, 'GET', '/api/me')).status, 401); step('unauthenticated /api/me is 401');
  const noConsent = await http(null, 'POST', '/api/auth/dev', { name: 'NoConsent', consents: { ...ALL, privacy: false } });
  assert.equal(noConsent.status, 400); step('login refused without all consent boxes');

  const sfx = Math.random().toString(36).slice(2, 6);
  const host = await login('Hosty' + sfx), a = await login('Alpha' + sfx), b = await login('Bravo' + sfx), adm = await login('Tester');
  const hs = await connect(host.cookie), as = await connect(a.cookie), bs = await connect(b.cookie);

  const created = await http(host.cookie, 'POST', '/api/games', { settings: { name: 'Smoke Match', maxPlayers: 6, zombieCount: 1, durationMin: 10 } });
  assert.equal(created.status, 200, JSON.stringify(created.body)); const code = created.body.code; step(`created match ${code}`);
  assert.equal((await http(host.cookie, 'POST', '/api/games', {})).status, 409); step('second concurrent game refused');

  const cps = [
    ['m1', 'mission', 40, 'comms'], ['m2', 'mission', 50, 'medical'], ['m3', 'mission', 60, 'power'], ['s1', 'supply', 30, null], ['x1', 'extraction', 12, null],
  ].map(([id, kind, m, t], i) => ({ id: `cp_${id}`, kind, missionType: t, name: id, description: '', ...off(m, i + 1), radius: 25, active: true, approved: true }));
  let r = await http(host.cookie, 'PATCH', `/api/games/${code}/config`, {
    settings: { area: { type: 'circle', center: C, radius: 300 }, allowSimGps: true, hostSafetyConfirmed: true, missionHoldSec: 5, countdownSec: 5, requiredMissions: 3 }, checkpoints: cps,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await http(host.cookie, 'PATCH', `/api/games/${code}/config`, { settings: { hostSafetyConfirmed: true } }); assert.equal(r.status, 200); step('host configured area + checkpoints + safety confirmation');
  assert.equal((await http(a.cookie, 'PATCH', `/api/games/${code}/config`, { settings: { name: 'hax' } })).status, 403); step('non-host cannot configure');
  r = await http(host.cookie, 'PATCH', `/api/games/${code}/config`, { settings: { area: { type: 'circle', center: C, radius: 99999 } } });
  assert.equal(r.status, 400); step('oversized area rejected');

  assert.ok((await hs.emitA('game:join', { code })).ok);
  assert.ok((await as.emitA('game:join', { code })).ok);
  assert.ok((await bs.emitA('game:join', { code })).ok);
  await as.emitA('lobby:ready', { ready: true }); await bs.emitA('lobby:ready', { ready: true });
  await sleep(1300);
  assert.equal(hs.state.players.length, 3); step('3 players in lobby, state synced');
  assert.equal(as.state.checkpoints.length, 0); step('players cannot see checkpoints in lobby');

  const start = await hs.emitA('host:start'); assert.ok(start.ok, start.error); step('host started match (countdown)');
  await sleep(6500);
  assert.equal(hs.state.status, 'running'); step('match running after countdown');
  const sockets = { [host.user.id]: hs, [a.user.id]: as, [b.user.id]: bs };
  const roles = Object.fromEntries(Object.entries(sockets).map(([id, s]) => [id, s.state.me.team]));
  assert.equal(Object.values(roles).filter((x) => x === 'zombie').length, 1); step('exactly 1 zombie assigned server-side');
  const sid = Object.keys(roles).filter((id) => roles[id] === 'survivor'); const zid = Object.keys(roles).find((id) => roles[id] === 'zombie');
  const S = sockets[sid[0]], Z = sockets[zid];

  const m1 = cps[0];
  assert.equal((await S.emitA('activity:start', { cpId: m1.id })).ok, false); step('mission start refused without GPS fix');
  await sleep(600);
  await S.emitA('loc:update', { ...m1, acc: 5, sim: true });
  let res = await S.emitA('activity:start', { cpId: m1.id }); assert.ok(res.ok, res.error); step('mission started at checkpoint');
  await sleep(1100); await S.emitA('loc:update', { ...m1, acc: 5, sim: true });
  for (let i = 0; i < 6; i++) { await sleep(1100); await S.emitA('loc:update', { ...m1, acc: 5, sim: true }); }
  await sleep(2200);
  assert.equal(S.state.missions.done, 1); assert.equal(S.state.me.score, 100); step('server completed mission after hold (+100)');

  await sleep(600);
  await Z.emitA('loc:update', { ...off(100, 3), acc: 5, sim: true });
  await sleep(2100);
  await S.emitA('loc:update', { ...off(104, 3), acc: 5, sim: true });
  let qr; S.once('infect:incoming', (p) => (qr = p));
  res = await Z.emitA('infect:request'); assert.ok(res.ok, res.error); await sleep(300);
  assert.ok(qr?.qr?.startsWith('OO1:')); step('survivor received one-time QR token');
  res = await Z.emitA('infect:confirm', { token: qr.qr }); assert.ok(res.ok, res.error);
  await sleep(2200); assert.equal(S.state.me.status, 'INFECTED'); step('QR scan infected the survivor; state pushed to clients');
  assert.equal((await Z.emitA('infect:confirm', { token: qr.qr })).ok, false); step('QR replay rejected');

  const leave = await hs.emitA('host:pause'); assert.ok(leave.ok); await sleep(1200); assert.equal(hs.state.status, 'paused'); step('host emergency pause');
  await hs.emitA('host:resume'); 

  // reconnect restores state
  bs.disconnect(); const S2 = await connect(b.cookie);
  await sleep(500); assert.equal(S2.state?.code, code); step('reconnect restored match state');

  // admin
  assert.equal((await http(a.cookie, 'GET', '/api/admin/overview')).status, 404); step('non-admin cannot reach admin API');
  const ov = await http(adm.cookie, 'GET', '/api/admin/overview');
  if (ov.status === 200) { assert.ok(ov.body.live.rooms >= 1); step('admin overview OK: ' + JSON.stringify(ov.body.live)); } else console.log('  (admin test skipped: add tester@dev.local to ADMIN_EMAILS)');

  // profile + delete
  r = await http(a.cookie, 'PATCH', '/api/me', { displayName: 'Alpha Prime' }); assert.equal(r.body.user.displayName, 'Alpha Prime'); step('callsign changed');
  r = await http(a.cookie, 'DELETE', '/api/me', { confirm: 'nope' }); assert.equal(r.status, 400);
  r = await http(a.cookie, 'DELETE', '/api/me', { confirm: 'DELETE' }); assert.equal(r.status, 200); step('account deleted');
  assert.equal((await http(a.cookie, 'GET', '/api/me')).status, 401); step('deleted account session is dead');

  // terminate
  await hs.emitA('host:terminate'); await sleep(1200);
  assert.equal(hs.state.status, 'finished'); step('host terminated; match finished');
  [hs, as, bs, S2].forEach((s) => s.disconnect());
  console.log('E2E PASSED');
  process.exit(0);
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
