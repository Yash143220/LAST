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
    settings: { area: { type: 'circle', center: C, radius: 300 }, allowSimGps: true, hostSafetyConfirmed: true, missionHoldSec: 10, countdownSec: 5, requiredMissions: 3, hideSec: 0 }, checkpoints: cps,
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

  // radio: survivors <-> survivors only, zombies <-> zombies only, one speaker at a time
  const S1 = S, S3 = sockets[sid[1]];
  const heard = (sock) => { const log = { talking: 0, chunks: 0, idle: 0 }; sock.on('voice:talking', () => log.talking++); sock.on('voice:chunk', () => log.chunks++); sock.on('voice:idle', () => log.idle++); return log; };
  const hS3 = heard(S3), hZ = heard(Z), hH = heard(S1);
  const v1 = await S1.emitA('voice:start'); assert.ok(v1.ok && v1.channel === 'survivor', JSON.stringify(v1));
  assert.equal((await S3.emitA('voice:start')).code, 'BUSY'); step('radio: channel is busy while a survivor is talking');
  for (let i = 0; i < 3; i++) S1.emit('voice:chunk', { d: Buffer.alloc(800, 9) }, () => {});
  await sleep(500); await S1.emitA('voice:end'); await sleep(400);
  assert.equal(hS3.talking, 1); assert.ok(hS3.chunks >= 1); assert.equal(hS3.idle, 1); assert.equal(hZ.chunks, 0); assert.equal(hZ.talking, 0);
  step('radio: survivor voice reached the other survivor ' + hS3.chunks + ' packets and the zombie heard nothing');
  const vz = await Z.emitA('voice:start'); assert.ok(vz.ok && vz.channel === 'zombie'); await Z.emitA('voice:end'); step('radio: zombie has its own channel');
  assert.equal(S3.state.me.channel, 'survivor'); assert.equal(Z.state.me.channel, 'zombie'); step('state exposes the player\'s radio channel');

  const m1 = cps[0];
  assert.equal((await S.emitA('activity:start', { cpId: m1.id })).ok, false); step('mission start refused without GPS fix');
  await sleep(600);
  await S.emitA('loc:update', { ...m1, acc: 5, sim: true });
  let res = await S.emitA('activity:start', { cpId: m1.id }); assert.ok(res.ok, res.error); step('mission started at checkpoint');
  await sleep(1100); await S.emitA('loc:update', { ...m1, acc: 5, sim: true });
  for (let i = 0; i < 10; i++) { await sleep(1100); await S.emitA('loc:update', { ...m1, acc: 5, sim: true }); }
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
  const vi = await S.emitA('voice:start'); assert.ok(vi.ok && vi.channel === 'zombie'); await S.emitA('voice:end'); step('infected survivor is now on the zombie radio');


  const leave = await hs.emitA('host:pause'); assert.ok(leave.ok); await sleep(1200); assert.equal(hs.state.status, 'paused'); step('host emergency pause');
  await hs.emitA('host:resume'); 

  // reconnect restores state
  bs.disconnect(); const S2 = await connect(b.cookie);
  await sleep(500); assert.equal(S2.state?.code, code); step('reconnect restored match state');

  // admin
  assert.equal((await http(a.cookie, 'GET', '/api/admin/overview')).status, 404); step('non-admin cannot reach admin API');
  const ov = await http(adm.cookie, 'GET', '/api/admin/overview');
  if (ov.status === 200) { assert.ok(ov.body.live.rooms >= 1); step('admin overview OK: ' + JSON.stringify(ov.body.live)); } else console.log('  (admin test skipped: add tester@dev.local to ADMIN_EMAILS)');

  // avatar: stored once, served by URL, never embedded in game state
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(300, 7)]);
  let ar = await fetch(BASE + '/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/webp', Origin: BASE, Cookie: b.cookie }, body: webp });
  const aj = await ar.json(); assert.equal(ar.status, 200, JSON.stringify(aj)); assert.match(aj.user.avatar, /^\/api\/avatar\/[a-f0-9]{24}\?v=/); step('avatar uploaded (' + aj.user.avatar.length + '-char URL, not data)');
  ar = await fetch(BASE + '/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/webp', Origin: BASE, Cookie: b.cookie }, body: Buffer.from('this is not an image '.repeat(10)) });
  assert.equal(ar.status, 400); step('non-image bytes rejected by signature check');
  ar = await fetch(BASE + aj.user.avatar, { headers: { Cookie: b.cookie } }); assert.equal(ar.status, 200); assert.equal(ar.headers.get('content-type'), 'image/webp'); assert.equal((await ar.arrayBuffer()).byteLength, webp.length); step('avatar served with long-cache headers: ' + ar.headers.get('cache-control'));
  assert.equal((await fetch(BASE + aj.user.avatar)).status, 401); step('avatar needs a session');
  await sleep(2300);
  const meP = S2.state.players.find((p) => p.id === b.user.id);
  assert.equal(meP.avatar, aj.user.avatar); assert.ok(JSON.stringify(S2.state).length < 20000); step('match state carries only the avatar URL (state size ' + JSON.stringify(S2.state).length + ' bytes)');

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
