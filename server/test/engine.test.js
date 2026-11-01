import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { offsetPoint } from '../src/geo.js';

const C = { lat: 20.2961, lng: 85.8245 };
const U = (n) => ({ id: `u${n}`, displayName: `P${n}`, avatar: '' });
const at = (m, bearing = 0) => offsetPoint(C, bearing, m);
const cp = (id, kind, m, extra = {}) => ({ id, kind, name: id, description: '', ...at(m, id.length), radius: 25, active: true, approved: true, ...extra });

function setup({ players = 4, zombies = 1, settings = {} } = {}) {
  const host = U(0);
  const { room } = E.createRoom(host, { name: 'Test match', maxPlayers: 10, zombieCount: zombies, durationMin: 10 });
  const cps = [
    cp('m_comms', 'mission', 60, { missionType: 'comms' }), cp('m_med', 'mission', 70, { missionType: 'medical' }),
    cp('m_power', 'mission', 80, { missionType: 'power' }), cp('m_sig', 'mission', 90, { missionType: 'signal' }),
    cp('m_resc', 'mission', 100, { missionType: 'rescue' }), cp('s_one', 'supply', 40), cp('x_out', 'extraction', 15),
  ];
  let r = E.applyConfig(room, host.id, {
    settings: { area: { type: 'circle', center: C, radius: 300 }, allowSimGps: true, hostSafetyConfirmed: true, missionHoldSec: 5, extractionHoldSec: 10, extractionWindowMin: 2, countdownSec: 5, ...settings },
    checkpoints: cps,
  });
  assert.ok(r.ok, r.error);
  assert.equal(room.settings.hostSafetyConfirmed, false);   // changing area/checkpoints clears confirmation
  r = E.applyConfig(room, host.id, { settings: { hostSafetyConfirmed: true } });
  assert.ok(r.ok && room.settings.hostSafetyConfirmed === true);
  for (let i = 1; i < players; i++) { assert.ok(E.addPlayer(room, U(i)).ok); E.setReady(room, `u${i}`, true); }
  return room;
}
function run(room) {
  const r = E.startGame(room, 'u0'); assert.ok(r.ok, r.error);
  room.countdownEndsAt = Date.now() - 1; E.tick(room);
  assert.equal(room.status, 'running');
  return room;
}
const loc = (room, id, p, acc = 5) => assert.ok(E.updateLocation(room, id, { ...p, acc, sim: true }).ok);
const survivors = (room) => Object.values(room.players).filter((p) => p.team === 'survivor');
const zombiesOf = (room) => Object.values(room.players).filter((p) => p.team === 'zombie');
const shift = (room, ms) => { room.startedAt -= ms; };

test.beforeEach(() => { E.rooms.clear(); E.userRoom.clear(); });

test('readiness blocks start until everything is safe and approved', () => {
  const { room } = E.createRoom(U(50), {});
  assert.ok(E.readiness(room).issues.length >= 3);
  assert.equal(E.startGame(room, 'u50').ok, false);
  const ok = setup();
  assert.deepEqual(E.readiness(ok).issues, []);
  // unapproved active checkpoint blocks
  const c = ok.checkpoints.map((x, i) => (i === 0 ? { ...x, approved: false } : x));
  E.applyConfig(ok, 'u0', { checkpoints: c });
  assert.ok(E.readiness(ok).issues.some((i) => /approved|confirm/i.test(i)));
});

test('one active game per user, host-only config, locked after start', () => {
  const room = setup();
  assert.equal(E.createRoom(U(0), {}).ok, false);
  assert.equal(E.applyConfig(room, 'u1', { settings: { name: 'hack' } }).ok, false);
  run(room);
  assert.equal(E.applyConfig(room, 'u0', { settings: { name: 'late edit' } }).code, 'LOCKED');
  assert.equal(E.addPlayer(room, U(9)).code, 'STARTED');
});

test('roles assigned server-side; viewers cannot see opponents', () => {
  const room = setup({ players: 6, zombies: 2 });
  assert.equal(room.players.u1.team, null);
  run(room);
  assert.equal(zombiesOf(room).length, 2);
  const s = survivors(room)[0], z = zombiesOf(room)[0];
  const vs = E.viewFor(room, s.id);
  assert.equal(vs.me.team, 'survivor');
  assert.ok(vs.players.filter((p) => p.team).every((p) => p.team === 'survivor'));
  const vz = E.viewFor(room, z.id);
  assert.ok(vz.players.filter((p) => p.team).every((p) => p.team === 'zombie'));
});

test('mission needs presence + hold; server completes it', () => {
  const room = run(setup());
  const s = survivors(room)[0];
  assert.equal(E.startActivity(room, s.id, 'm_comms').ok, false);          // no fix yet
  loc(room, s.id, at(300, 1));
  assert.equal(E.startActivity(room, s.id, 'm_comms').code, 'RANGE');
  loc(room, s.id, room.checkpoints.find((c) => c.id === 'm_comms'));
  assert.ok(E.startActivity(room, s.id, 'm_comms').ok);
  E.tick(room); assert.equal(Object.keys(room.missionsDone).length, 0);    // hold not elapsed
  s.activity.startedEl -= 6000; E.tick(room);
  assert.ok(room.missionsDone.comms);
  assert.equal(s.score, 100);
  loc(room, s.id, room.checkpoints.find((c) => c.id === 'm_comms'));
  assert.equal(E.startActivity(room, s.id, 'm_comms').ok, false);          // already done
});

test('leaving the checkpoint cancels progress', () => {
  const room = run(setup());
  const s = survivors(room)[0];
  loc(room, s.id, room.checkpoints.find((c) => c.id === 'm_med'));
  assert.ok(E.startActivity(room, s.id, 'm_med').ok);
  loc(room, s.id, at(250, 2));
  E.tick(room);
  assert.equal(s.activity, null);
});

test('QR infection: range gate, one-time token, replay blocked, expiry', () => {
  const room = run(setup());
  const z = zombiesOf(room)[0], s = survivors(room)[0];
  loc(room, z.id, at(100, 3)); loc(room, s.id, at(200, 4));
  assert.equal(E.requestInfection(room, z.id).code, 'NO_TARGET');
  z.infectCd = 0;
  loc(room, s.id, offsetPoint(at(100, 3), 1, 6));
  let sent;
  E.out.toUser = (r, id, ev, payload) => { if (ev === 'infect:incoming') sent = { id, payload }; };
  const req = E.requestInfection(room, z.id); assert.ok(req.ok, req.error);
  assert.equal(sent.id, s.id);
  assert.equal(E.requestInfection(room, z.id).code, 'ACTIVE');             // duplicate request
  assert.equal(E.confirmInfection(room, survivors(room)[1].id, sent.payload.qr).ok, false); // wrong role
  assert.equal(E.confirmInfection(room, z.id, 'OO1:ZZZZZZ:abc').ok, false); // other match
  const res = E.confirmInfection(room, z.id, sent.payload.qr); assert.ok(res.ok, res.error);
  assert.equal(s.status, 'INFECTED'); assert.equal(s.team, 'zombie');
  assert.equal(E.confirmInfection(room, z.id, sent.payload.qr).code, 'USED'); // replay
  assert.equal(z.score, 100);
});

test('QR token expires; manual 6-digit code works', () => {
  const room = run(setup());
  const z = zombiesOf(room)[0], s = survivors(room)[0];
  loc(room, z.id, at(100, 3)); loc(room, s.id, offsetPoint(at(100, 3), 1, 4));
  let sent; E.out.toUser = (r, id, ev, p) => { if (ev === 'infect:incoming') sent = p; };
  assert.ok(E.requestInfection(room, z.id).ok);
  const late = Date.now() + 16_000;
  assert.equal(E.confirmInfection(room, z.id, sent.qr, late).code, 'EXPIRED');
  z.infectCd = 0; Object.values(room.tokens).forEach((t) => (t.used = true));
  assert.ok(E.requestInfection(room, z.id).ok);
  assert.ok(E.confirmInfection(room, z.id, sent.code).ok);
});

test('shield blocks silently; antidote cancels one infection', () => {
  const room = run(setup());
  const z = zombiesOf(room)[0], s = survivors(room)[0];
  loc(room, z.id, at(100, 3)); loc(room, s.id, offsetPoint(at(100, 3), 1, 4));
  s.inventory.shield = 1; assert.ok(E.useItem(room, s.id, 'shield').ok);
  assert.equal(E.requestInfection(room, z.id).code, 'NO_TARGET');
  s.shieldUntil = 0; z.infectCd = 0;
  s.inventory.medkit = 1;
  let sent; E.out.toUser = (r, id, ev, p) => { if (ev === 'infect:incoming') sent = p; };
  assert.ok(E.requestInfection(room, z.id).ok);
  const r = E.confirmInfection(room, z.id, sent.qr);
  assert.ok(r.resisted); assert.equal(s.status, 'ALIVE'); assert.equal(s.inventory.medkit, 0);
});

test('supplies cost credits, respect radius, limits and cooldown', () => {
  const room = run(setup());
  const s = survivors(room)[0];
  loc(room, s.id, at(300, 1));
  assert.equal(E.buyItem(room, s.id, 's_one', 'shield').code, 'RANGE');
  loc(room, s.id, room.checkpoints.find((c) => c.id === 's_one'));
  assert.match(E.buyItem(room, s.id, 's_one', 'medkit').error, /credits/);
  s.credits = 500;
  assert.ok(E.buyItem(room, s.id, 's_one', 'shield').ok);
  assert.match(E.buyItem(room, s.id, 's_one', 'shield').error, /cooling/);
  s.supplyCd = {}; assert.ok(E.buyItem(room, s.id, 's_one', 'shield').ok);
  s.supplyCd = {}; assert.match(E.buyItem(room, s.id, 's_one', 'shield').error, /Limit/);
  const z = zombiesOf(room)[0]; assert.equal(E.buyItem(room, z.id, 's_one', 'radar').ok, false);
});

test('zone: shrinks on schedule, penalty only with a good fix after grace', () => {
  const room = run(setup());
  const s = survivors(room)[0];
  assert.equal(E.zoneAt(room, 0).current.radius, 300);
  assert.equal(Math.round(E.zoneAt(room, 10 * 60_000 * 0.2).current.radius), 260);
  assert.equal(Math.round(E.zoneAt(room, 10 * 60_000 * 0.95).current.radius), 40);
  loc(room, s.id, at(290, 1), 5); E.tick(room); assert.equal(s.outSince, null);
  shift(room, 6 * 60_000);                                              // zone now ~ 220 m
  loc(room, s.id, at(290, 1), 5); E.tick(room); assert.notEqual(s.outSince, null);
  s.outSince -= 61_000; loc(room, s.id, at(290, 1), 80); E.tick(room);  // bad accuracy -> no penalty
  assert.equal(s.status, 'ALIVE');
  loc(room, s.id, at(290, 1), 5); E.tick(room);
  assert.equal(s.status, 'INFECTED');
});

test('extraction: needs missions + open window + hold -> survivors win', () => {
  const room = run(setup());
  const s = survivors(room)[0];
  const ex = room.checkpoints.find((c) => c.id === 'x_out');
  loc(room, s.id, ex);
  assert.match(E.startActivity(room, s.id, 'x_out').error, /not open/);
  shift(room, 9 * 60_000);
  loc(room, s.id, ex);
  assert.match(E.startActivity(room, s.id, 'x_out').error, /missions first/);
  for (const t of ['comms', 'medical', 'power']) room.missionsDone[t] = { by: s.id, byName: s.name, at: 0 };
  assert.ok(E.startActivity(room, s.id, 'x_out').ok);
  s.activity.startedEl -= 11_000; E.tick(room);
  assert.equal(room.status, 'finished'); assert.equal(room.winner, 'survivors'); assert.equal(room.reason, 'extraction');
  assert.equal(E.userRoom.size, 0);
});

test('timer end gives survivors the win; all infected gives zombies the win', () => {
  const a = run(setup({ settings: { forfeitSignalLossSec: 0 } }));
  shift(a, 10 * 60_000 + 1000); E.tick(a);
  assert.equal(a.winner, 'survivors'); assert.equal(a.reason, 'time');
  E.rooms.clear(); E.userRoom.clear();
  const b = run(setup({ players: 3 }));
  const z = zombiesOf(b)[0];
  for (const s of survivors(b)) { loc(b, z.id, at(100, 3)); loc(b, s.id, offsetPoint(at(100, 3), 1, 3)); z.infectCd = 0; E.out.toUser = (r, id, ev, p) => { if (ev === 'infect:incoming') b.__qr = p.qr; }; assert.ok(E.requestInfection(b, z.id).ok); assert.ok(E.confirmInfection(b, z.id, b.__qr).ok); }
  assert.equal(b.winner, 'zombies'); assert.equal(b.reason, 'all_infected');
});

test('pause freezes the clock; resume continues', () => {
  const room = run(setup());
  assert.ok(E.pause(room, 'u0').ok);
  const e1 = E.elapsed(room); const later = Date.now() + 30_000;
  assert.equal(E.elapsed(room, later), e1);
  room.pausedAt -= 30_000; E.resume(room);
  assert.ok(Math.abs(E.elapsed(room) - e1) < 200);
});

test('simulated GPS is rejected unless the host allows it; location hints are fuzzed and periodic', () => {
  const room = setup({ settings: { allowSimGps: false } });
  run(room);
  const s = survivors(room)[0];
  assert.equal(E.updateLocation(room, s.id, { ...at(10), acc: 5, sim: true }).code, 'SIM_DISABLED');
  assert.ok(E.updateLocation(room, s.id, { ...at(10), acc: 5 }).ok);
  const z = zombiesOf(room)[0];
  E.updateLocation(room, z.id, { ...at(20), acc: 5 });
  shift(room, 121_000); E.tick(room);
  const v = E.viewFor(room, z.id);
  assert.equal(v.hints.list.length, 1);
  assert.ok(v.hints.list[0].r >= 30 && !('id' in v.hints.list[0] && v.hints.list[0].id === s.id));
});

test('leaving a running match as the last survivor ends it; snapshot round-trips', () => {
  const room = run(setup({ players: 3 }));
  const snap = E.snapshot(room);
  assert.ok(JSON.stringify(snap).length > 100);
  for (const s of survivors(room)) E.leaveRoom(room, s.id);
  assert.equal(room.winner, 'zombies');
});
