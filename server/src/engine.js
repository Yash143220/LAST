// Authoritative game engine. All rules live here; sockets/REST only call into it.
// Single-process, in-memory rooms (snapshotted to MongoDB) -> synchronous and race-free.
import crypto from 'node:crypto';
import { config } from './config.js';
import {
  MISSIONS, ITEMS, SHIELD_MS, ENERGY_MS, ANTIDOTE_MS, RADAR_MS, RADAR_RANGE, SUPPLY_COOLDOWN_MS,
  START_CREDITS, FIX_FRESH_MS, HINT_FRESH_MS, ZONE_STAGES, GAME_RETENTION_MS,
} from './constants.js';
import { haversine, inShape, scaledShape, areaCenter, randomPointNear } from './geo.js';
import { DEFAULT_SETTINGS, settingsSchema, checkpointsSchema, cleanText } from './schemas.js';

export const rooms = new Map();      // code -> room
export const userRoom = new Map();   // userId -> code (one active game per user)

// Output hooks, wired by the socket layer / services.
export const out = {
  broadcast: () => {}, toUser: () => {}, toast: () => {}, finished: () => {}, persist: () => {}, closed: () => {},
};

const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const fail = (error, code = 'BAD_REQUEST') => ({ ok: false, error, code });
const ok = (data = {}) => ({ ok: true, ...data });

export function newCode() {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < 6; j++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('Could not allocate room code');
}

export const elapsed = (room, now = Date.now()) => {
  if (!room.startedAt) return 0;
  const end = room.status === 'finished' ? room.endedAt : room.pausedAt || now;
  return Math.max(0, end - room.startedAt - room.pausedTotal);
};
const durationMs = (room) => room.settings.durationMin * 60_000;

function ev(room, msg, { type = 'info', aud = 'all', now = Date.now() } = {}) {
  room.events.push({ id: rid(4), t: elapsed(room, now), type, msg, aud });
  if (room.events.length > 150) room.events.splice(0, room.events.length - 150);
}

const isTeam = (p, team) => p.team === team;
const isActive = (p) => p.status === 'ALIVE' || p.status === 'INFECTED';
const survivorsAlive = (room) => Object.values(room.players).filter((p) => p.team === 'survivor' && p.status === 'ALIVE');
const zombies = (room) => Object.values(room.players).filter((p) => p.team === 'zombie' && isActive(p));

function newPlayer(user) {
  return {
    id: user.id, name: user.displayName, avatar: user.avatar || user.photoUrl || '',
    ready: false, connected: false, joinedAt: Date.now(), disconnectedAt: null,
    team: null, origin: null, status: 'LOBBY', loc: null, jumpAt: 0, lastLocEl: 0,
    score: 0, credits: START_CREDITS, missions: [], inventory: { shield: 0, radar: 0, energy: 0, medkit: 0 },
    bought: { shield: 0, radar: 0, energy: 0, medkit: 0 }, supplyCd: {},
    shieldUntil: 0, energyUntil: 0, radar: null, activity: null, outSince: null,
    infections: 0, extracted: false, flags: { sim: false, jumps: 0 }, infectCd: 0, confirmFails: 0, lockUntil: 0,
  };
}

// ---------------------------------------------------------------- lifecycle
export function createRoom(host, settingsPatch = {}) {
  if (rooms.size >= config.limits.maxRooms) return fail('Server is at capacity. Try again soon.', 'CAPACITY');
  if (userRoom.has(host.id)) return fail('You are already in an active game. Leave it first.', 'IN_GAME');
  const merged = { ...DEFAULT_SETTINGS, ...settingsPatch, area: null };
  const parsed = settingsSchema.safeParse(merged);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const room = {
    id: rid(12), code: newCode(), hostId: host.id, status: 'lobby', settings: parsed.data, checkpoints: [],
    players: {}, createdAt: Date.now(), startedAt: 0, countdownEndsAt: 0, pausedAt: 0, pausedTotal: 0, endedAt: 0,
    winner: null, reason: null, events: [], missionsDone: {}, hints: { at: 0, nextAt: 0, zombie: [], survivor: [] },
    zoneIdx: 0, extractionAnnounced: false, tokens: {}, result: null, dirty: true, lastSnap: 0,
  };
  room.players[host.id] = newPlayer(host);
  room.players[host.id].ready = true;
  rooms.set(room.code, room);
  userRoom.set(host.id, room.code);
  ev(room, `${host.displayName} opened the lobby.`);
  out.persist(room, true);
  return ok({ room });
}

export function applyConfig(room, userId, { settings, checkpoints }) {
  const before = JSON.stringify([room.settings.area, room.checkpoints]);
  if (room.hostId !== userId) return fail('Only the host can change settings.', 'FORBIDDEN');
  if (room.status !== 'lobby') return fail('Settings are locked once the match starts.', 'LOCKED');
  if (settings) {
    const merged = { ...room.settings, ...settings };
    const parsed = settingsSchema.safeParse(merged);
    if (!parsed.success) return fail(`${parsed.error.issues[0].path.join('.') || 'settings'}: ${parsed.error.issues[0].message}`);
    if (parsed.data.maxPlayers < Object.keys(room.players).length) return fail('Max players is below the current player count.');
    // any change of the area invalidates previous safety approvals of the confirmation flag
    room.settings = parsed.data;
  }
  if (checkpoints) {
    const parsed = checkpointsSchema.safeParse(checkpoints);
    if (!parsed.success) return fail(`checkpoint: ${parsed.error.issues[0].message}`);
    const area = room.settings.area;
    if (area) {
      for (const c of parsed.data) {
        if (!inShape(scaledShape(area, 1), c)) return fail(`"${c.name}" is outside the playable area.`);
      }
    }
    const ids = new Set(parsed.data.map((c) => c.id));
    if (ids.size !== parsed.data.length) return fail('Duplicate checkpoint ids.');
    room.checkpoints = parsed.data.map((c) => ({ ...c, name: cleanText(c.name, 40), description: cleanText(c.description, 200), missionType: c.kind === 'mission' ? c.missionType : null }));
  }
  // Safety confirmation is only valid for the exact area + checkpoints that existed when it was given.
  const sig = JSON.stringify([room.settings.area, room.checkpoints]);
  if (sig !== before) room.settings.hostSafetyConfirmed = false;
  room.dirty = true;
  out.persist(room, true);
  return ok();
}

export function addPlayer(room, user) {
  const existing = room.players[user.id];
  if (existing) { existing.avatar = user.avatar || user.photoUrl || existing.avatar; return ok({ rejoined: true }); }
  if (room.status !== 'lobby') return fail('This match has already started.', 'STARTED');
  if (Object.keys(room.players).length >= room.settings.maxPlayers) return fail('The lobby is full.', 'FULL');
  if (userRoom.has(user.id) && userRoom.get(user.id) !== room.code) return fail('You are already in another active game.', 'IN_GAME');
  room.players[user.id] = newPlayer(user);
  userRoom.set(user.id, room.code);
  ev(room, `${user.displayName} joined.`);
  room.dirty = true;
  out.persist(room, true);
  return ok();
}

export function setConnected(room, userId, connected) {
  const p = room.players[userId];
  if (!p) return;
  p.connected = connected;
  p.disconnectedAt = connected ? null : Date.now();
  room.dirty = true;
}

export function setReady(room, userId, ready) {
  const p = room.players[userId];
  if (!p || room.status !== 'lobby') return fail('Not available.');
  p.ready = !!ready || room.hostId === userId;
  room.dirty = true;
  return ok();
}

function transferHost(room) {
  const next = Object.values(room.players).filter((p) => p.status !== 'LEFT').sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0];
  if (!next) return false;
  room.hostId = next.id;
  next.ready = true;
  ev(room, `${next.name} is now the host.`);
  return true;
}

export function leaveRoom(room, userId, { kicked = false } = {}) {
  const p = room.players[userId];
  if (!p) return fail('Not in this game.');
  userRoom.delete(userId);
  if (room.status === 'lobby') {
    delete room.players[userId];
    ev(room, `${p.name} ${kicked ? 'was removed' : 'left'}.`);
    if (!Object.keys(room.players).length) { closeRoom(room, 'empty'); return ok({ closed: true }); }
    if (room.hostId === userId) transferHost(room);
  } else if (room.status === 'finished') {
    // nothing to do; result already stored
  } else {
    p.status = 'LEFT'; p.activity = null; p.connected = false;
    ev(room, `${p.name} left the match.`, { type: 'left' });
    if (room.hostId === userId) { if (!transferHost(room)) { finish(room, 'none', 'abandoned'); return ok({ closed: true }); } }
    checkWin(room);
  }
  room.dirty = true;
  out.persist(room, true);
  return ok();
}

export function closeRoom(room, why) {
  for (const id of Object.keys(room.players)) if (userRoom.get(id) === room.code) userRoom.delete(id);
  rooms.delete(room.code);
  out.closed(room, why);
}

// ---------------------------------------------------------------- readiness / start
export function readiness(room) {
  const s = room.settings, issues = [];
  const players = Object.values(room.players);
  if (!s.area) issues.push('Choose the playable area on the map.');
  if (players.length < 2) issues.push('At least 2 players are required.');
  if (s.zombieCount >= players.length) issues.push('There must be fewer zombies than players.');
  if (players.some((p) => !p.ready)) issues.push('Waiting for all players to be ready.');
  const active = room.checkpoints.filter((c) => c.active);
  if (active.some((c) => !c.approved)) issues.push('Some active checkpoints have not been safety-approved.');
  const live = active.filter((c) => c.approved);
  const types = new Set(live.filter((c) => c.kind === 'mission').map((c) => c.missionType));
  if (types.size < s.requiredMissions) issues.push(`Need at least ${s.requiredMissions} different mission types (have ${types.size}).`);
  const ex = live.filter((c) => c.kind === 'extraction');
  if (!ex.length) issues.push('Add and approve an extraction checkpoint.');
  if (s.area && ex.length) {
    const finalShape = scaledShape(s.area, s.shrink ? ZONE_STAGES.at(-1).f : 1);
    if (!ex.every((c) => inShape(finalShape, c))) issues.push('Extraction must be inside the final safe zone (closer to the centre).');
  }
  if (!s.hostSafetyConfirmed) issues.push('Confirm you reviewed every checkpoint for safety.');
  return { ok: issues.length === 0, issues };
}

export function startGame(room, userId) {
  if (room.hostId !== userId) return fail('Only the host can start.', 'FORBIDDEN');
  if (room.status !== 'lobby') return fail('Already started.');
  const r = readiness(room);
  if (!r.ok) return fail(r.issues[0], 'NOT_READY');
  const ids = Object.keys(room.players);
  const pool = ids.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const zset = new Set(pool.slice(0, room.settings.zombieCount));
  for (const id of ids) {
    const p = room.players[id];
    p.team = p.origin = zset.has(id) ? 'zombie' : 'survivor';
    p.status = 'ALIVE';
    p.lastLocEl = 0;
  }
  room.status = 'countdown';
  room.countdownEndsAt = Date.now() + room.settings.countdownSec * 1000;
  ev(room, 'Roles assigned. Stand by.');
  room.dirty = true;
  out.persist(room, true);
  return ok();
}

function beginRunning(room, now) {
  room.status = 'running';
  room.startedAt = now;
  room.pausedTotal = 0;
  room.hints = { at: 0, nextAt: room.settings.revealIntervalSec * 1000, zombie: [], survivor: [] };
  ev(room, 'Match started. Survivors: complete missions and reach extraction. Move calmly - no running.', { type: 'start', now });
  room.dirty = true;
  out.persist(room, true);
}

export function pause(room, byId, reason = 'Paused by host') {
  if (room.status !== 'running') return fail('Match is not running.');
  room.pausedAt = Date.now();
  room.status = 'paused';
  ev(room, `${reason}. All activity is frozen.`, { type: 'pause' });
  room.dirty = true;
  out.persist(room, true);
  return ok();
}
export function resume(room) {
  if (room.status !== 'paused') return fail('Match is not paused.');
  room.pausedTotal += Date.now() - room.pausedAt;
  room.pausedAt = 0;
  room.status = 'running';
  ev(room, 'Match resumed.', { type: 'resume' });
  room.dirty = true;
  out.persist(room, true);
  return ok();
}
export function terminate(room, reason = 'Ended by host') {
  if (room.status === 'finished') return fail('Already finished.');
  if (room.status === 'lobby') { closeRoom(room, 'terminated'); return ok({ closed: true }); }
  if (!room.startedAt) room.startedAt = Date.now();
  ev(room, reason, { type: 'end' });
  finish(room, 'none', 'aborted');
  return ok();
}

// ---------------------------------------------------------------- locations
const fresh = (room, p, ms = FIX_FRESH_MS, now = Date.now()) =>
  !!p.loc && now - p.loc.at <= ms && p.loc.acc <= room.settings.maxAccuracy && now - p.jumpAt > 8000;

export function updateLocation(room, userId, fix, now = Date.now()) {
  const p = room.players[userId];
  if (!p) return fail('Not in game.');
  const { lat, lng } = fix || {};
  let acc = Number(fix?.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail('Invalid location.');
  if (!Number.isFinite(acc) || acc < 0) acc = 999;
  const sim = !!fix.sim;
  if (sim && !room.settings.allowSimGps) return fail('Simulated GPS is disabled for this match.', 'SIM_DISABLED');
  if (sim) p.flags.sim = true;
  const prev = p.loc;
  if (prev && !sim && !prev.sim) {
    const dt = Math.max(0.5, (now - prev.at) / 1000);
    const d = haversine(prev, { lat, lng });
    if (dt < 120 && d > dt * 10 + acc + prev.acc + 40) { p.jumpAt = now; p.flags.jumps++; }
  }
  p.loc = { lat, lng, acc: Math.min(acc, 999), at: now, sim };
  p.lastLocEl = elapsed(room, now);
  room.dirty = true;
  return ok();
}

// ---------------------------------------------------------------- zone
export function zoneAt(room, el) {
  const s = room.settings;
  if (!s.area) return null;
  const dur = durationMs(room);
  const frac = Math.min(1, el / dur);
  let idx = 0;
  if (s.shrink && room.startedAt) for (let i = 0; i < ZONE_STAGES.length; i++) if (frac >= ZONE_STAGES[i].at) idx = i;
  const next = s.shrink && idx < ZONE_STAGES.length - 1 ? ZONE_STAGES[idx + 1] : null;
  return {
    idx, total: s.shrink ? ZONE_STAGES.length : 1,
    current: scaledShape(s.area, ZONE_STAGES[idx].f),
    next: next ? scaledShape(s.area, next.f) : null,
    nextInMs: next ? Math.max(0, next.at * dur - el) : null,
  };
}

// ---------------------------------------------------------------- activities (missions / extraction)
const missionsDoneCount = (room) => Object.keys(room.missionsDone).length;
const extractionOpen = (room, el) => el >= durationMs(room) - room.settings.extractionWindowMin * 60_000;
const holdMs = (room, p, base, el) => (p.energyUntil > el ? base / 2 : base);

function present(room, p, cp, now = Date.now()) {
  if (!fresh(room, p, FIX_FRESH_MS, now)) return false;
  return haversine(p.loc, cp) <= cp.radius + Math.min(p.loc.acc / 2, 10);
}

export function startActivity(room, userId, cpId) {
  const p = room.players[userId];
  if (!p) return fail('Not in game.');
  if (room.status !== 'running') return fail('Match is not running.');
  if (p.team !== 'survivor' || p.status !== 'ALIVE') return fail('Only active survivors can do this.');
  if (p.activity) return fail('You are already working on an objective.');
  const cp = room.checkpoints.find((c) => c.id === cpId && c.active && c.approved);
  if (!cp || cp.kind === 'supply') return fail('Unknown objective.');
  const el = elapsed(room);
  if (cp.kind === 'mission') {
    if (room.missionsDone[cp.missionType]) return fail('That mission is already complete.');
  } else {
    if (!extractionOpen(room, el)) return fail('Extraction is not open yet.');
    if (missionsDoneCount(room) < room.settings.requiredMissions) return fail(`Complete ${room.settings.requiredMissions} missions first.`);
  }
  if (!fresh(room, p)) return fail('Waiting for an accurate GPS fix. Move into the open.', 'GPS');
  if (!present(room, p, cp)) return fail(`Move closer - you must be inside the ${Math.round(cp.radius)} m checkpoint radius.`, 'RANGE');
  const base = (cp.kind === 'mission' ? room.settings.missionHoldSec : room.settings.extractionHoldSec) * 1000;
  p.activity = { kind: cp.kind, cpId: cp.id, startedEl: el, holdMs: holdMs(room, p, base, el) };
  room.dirty = true;
  return ok({ holdMs: p.activity.holdMs });
}

export function cancelActivity(room, userId, why) {
  const p = room.players[userId];
  if (!p?.activity) return fail('Nothing to cancel.');
  p.activity = null;
  if (why) out.toUser(room, userId, 'toast', { kind: 'warn', msg: why });
  room.dirty = true;
  return ok();
}

function completeActivity(room, p, el, now) {
  const a = p.activity;
  const cp = room.checkpoints.find((c) => c.id === a.cpId);
  p.activity = null;
  if (!cp) return;
  if (a.kind === 'mission') {
    if (room.missionsDone[cp.missionType]) return;
    const m = MISSIONS[cp.missionType];
    room.missionsDone[cp.missionType] = { by: p.id, byName: p.name, at: el, cpId: cp.id };
    p.score += m.points; p.credits += m.points; p.missions.push(cp.missionType);
    const n = missionsDoneCount(room);
    ev(room, `${p.name} completed "${m.name}" (+${m.points}). ${n}/${room.settings.requiredMissions} needed for extraction.`, { type: 'mission', now });
    if (n === room.settings.requiredMissions) ev(room, 'Extraction unlocked. Head to the extraction point once it opens.', { type: 'extraction', now });
    // cancel others working on the same mission
    for (const q of Object.values(room.players)) {
      if (q.activity?.kind === 'mission') {
        const qc = room.checkpoints.find((c) => c.id === q.activity.cpId);
        if (qc?.missionType === cp.missionType) { q.activity = null; out.toUser(room, q.id, 'toast', { kind: 'info', msg: 'Someone else completed that mission first.' }); }
      }
    }
  } else {
    p.extracted = true; p.score += 150;
    ev(room, `${p.name} reached extraction!`, { type: 'extraction', now });
    finish(room, 'survivors', 'extraction', now);
  }
}

// ---------------------------------------------------------------- supplies
export function buyItem(room, userId, cpId, item) {
  const p = room.players[userId];
  if (!p || room.status !== 'running') return fail('Not available.');
  if (p.team !== 'survivor' || p.status !== 'ALIVE') return fail('Only active survivors can collect supplies.');
  const def = ITEMS[item];
  const cp = room.checkpoints.find((c) => c.id === cpId && c.kind === 'supply' && c.active && c.approved);
  if (!def || !cp) return fail('Unknown supply.');
  if (!present(room, p, cp)) return fail('Move inside the supply checkpoint radius.', 'RANGE');
  const el = elapsed(room);
  if ((p.supplyCd[cpId] || 0) > el) return fail(`Supply point cooling down (${Math.ceil((p.supplyCd[cpId] - el) / 1000)}s).`);
  if (p.bought[item] >= def.limit) return fail(`Limit reached for ${def.name}.`);
  if (p.credits < def.cost) return fail('Not enough credits. Complete missions to earn more.');
  p.credits -= def.cost; p.bought[item]++; p.inventory[item]++;
  p.supplyCd[cpId] = el + SUPPLY_COOLDOWN_MS;
  room.dirty = true;
  return ok();
}

export function useItem(room, userId, item) {
  const p = room.players[userId];
  if (!p || room.status !== 'running') return fail('Not available.');
  if (p.team !== 'survivor' || p.status !== 'ALIVE') return fail('Only active survivors can use items.');
  if (!(p.inventory[item] > 0)) return fail('You do not have that item.');
  const el = elapsed(room);
  if (item === 'shield') { if (p.shieldUntil > el) return fail('Shield already active.'); p.shieldUntil = el + SHIELD_MS; }
  else if (item === 'energy') { if (p.energyUntil > el) return fail('Energy Pack already active.'); p.energyUntil = el + ENERGY_MS; }
  else if (item === 'radar') {
    if (!fresh(room, p)) return fail('Radar needs an accurate GPS fix.', 'GPS');
    const list = zombies(room).filter((z) => fresh(room, z, HINT_FRESH_MS) && haversine(z.loc, p.loc) <= RADAR_RANGE)
      .map((z) => ({ id: rid(4), ...randomPointNear(z.loc, 20), r: 35 }));
    p.radar = { until: el + RADAR_MS, list, at: el };
  } else return fail('That item is used automatically.');
  p.inventory[item]--;
  room.dirty = true;
  return ok();
}

// ---------------------------------------------------------------- infection (GPS proximity + one-time QR)
function effDist(a, b) {
  return haversine(a.loc, b.loc) - Math.min((a.loc.acc + b.loc.acc) / 2, 15);
}

export function requestInfection(room, zombieId, now = Date.now()) {
  const z = room.players[zombieId];
  if (!z || room.status !== 'running') return fail('Not available.');
  if (z.team !== 'zombie' || !isActive(z)) return fail('Only zombies can infect.');
  const existing = Object.values(room.tokens).find((t) => t.zombieId === zombieId && !t.used && t.expiresAt > now);
  if (existing) return fail('An infection attempt is already active. Scan the survivor\'s QR code.', 'ACTIVE');
  if (z.infectCd > now) return fail(`Wait ${Math.ceil((z.infectCd - now) / 1000)}s before trying again.`, 'COOLDOWN');
  if (!fresh(room, z, FIX_FRESH_MS, now)) return fail('Waiting for an accurate GPS fix. Move into the open.', 'GPS');
  const cands = survivorsAlive(room).filter((s) => fresh(room, s, 30_000, now))
    .map((s) => ({ s, d: effDist(z, s) })).filter((x) => x.d <= room.settings.infectionRange).sort((a, b) => a.d - b.d);
  z.infectCd = now + 4000;
  if (!cands.length) return fail('No survivor detected within infection range.', 'NO_TARGET');
  const el = elapsed(room, now);
  const target = cands.find((c) => !Object.values(room.tokens).some((t) => t.survivorId === c.s.id && !t.used && t.expiresAt > now))?.s;
  if (!target) return fail('Target is already being engaged. Try again shortly.', 'BUSY');
  if (target.shieldUntil > el) {
    out.toUser(room, target.id, 'toast', { kind: 'good', msg: 'Your shield blocked an infection attempt.' });
    ev(room, 'A shield blocked an infection attempt.', { type: 'block', aud: target.id, now });
    return fail('No survivor detected within infection range.', 'NO_TARGET'); // do not reveal protection to the zombie
  }
  const token = rid(12);
  const code = String(crypto.randomInt(100000, 1000000));
  const entry = { token, code, zombieId, survivorId: target.id, expiresAt: now + room.settings.qrTtlSec * 1000, used: false };
  room.tokens[token] = entry;
  out.toUser(room, target.id, 'infect:incoming', { qr: `OO1:${room.code}:${token}`, code, expiresAt: entry.expiresAt, serverNow: now });
  room.dirty = true;
  return ok({ expiresAt: entry.expiresAt, serverNow: now });
}

export function confirmInfection(room, zombieId, raw, now = Date.now()) {
  const z = room.players[zombieId];
  if (!z || room.status !== 'running') return fail('Not available.');
  if (z.team !== 'zombie' || !isActive(z)) return fail('Only zombies can infect.');
  if (z.lockUntil > now) return fail('Too many invalid scans. Wait a few seconds.', 'LOCKED');
  const text = String(raw || '').trim();
  let entry = null;
  if (text.startsWith('OO1:')) {
    const [, code, token] = text.split(':');
    if (code !== room.code) return fail('That QR code belongs to a different match.', 'WRONG_MATCH');
    entry = room.tokens[token];
  } else if (/^\d{6}$/.test(text)) {
    entry = Object.values(room.tokens).find((t) => t.code === text && t.zombieId === zombieId);
  }
  if (!entry || entry.zombieId !== zombieId) {
    if (++z.confirmFails >= 5) { z.lockUntil = now + 15_000; z.confirmFails = 0; }
    return fail('Invalid code.', 'INVALID');
  }
  if (entry.used) return fail('This code was already used.', 'USED');
  if (entry.expiresAt < now) return fail('This code expired. Request a new infection.', 'EXPIRED');
  entry.used = true;
  const s = room.players[entry.survivorId];
  if (!s || s.team !== 'survivor' || s.status !== 'ALIVE') return fail('The target is no longer a survivor.', 'GONE');
  if (!fresh(room, z, 30_000, now) || !fresh(room, s, 30_000, now)) return fail('GPS fix too old to verify proximity.', 'GPS');
  if (effDist(z, s) > room.settings.infectionRange * 2) return fail('You are no longer close enough to the survivor.', 'RANGE');
  const el = elapsed(room, now);
  if (s.shieldUntil > el) return fail('Infection blocked.', 'BLOCKED');
  if (s.inventory.medkit > 0) {
    s.inventory.medkit--; s.shieldUntil = el + ANTIDOTE_MS;
    out.toUser(room, s.id, 'toast', { kind: 'good', msg: 'Antidote used - infection cancelled!' });
    ev(room, `${s.name}'s antidote cancelled an infection.`, { type: 'block', now });
    room.dirty = true;
    return ok({ resisted: true });
  }
  infect(room, s, z, 'scan', now);
  return ok({ infected: true, name: s.name });
}

function infect(room, s, by, how, now = Date.now()) {
  s.status = 'INFECTED'; s.team = 'zombie'; s.activity = null; s.outSince = null; s.radar = null;
  if (by) { by.infections++; by.score += 100; }
  const msg = how === 'zone' ? `${s.name} was overcome outside the safe zone and is now infected.` : `${s.name} was infected.`;
  ev(room, msg, { type: 'infect', now });
  out.toUser(room, s.id, 'toast', { kind: 'danger', msg: 'You are infected. You now hunt for the zombies.' });
  room.dirty = true;
  checkWin(room, now);
  out.broadcast(room);
}

// ---------------------------------------------------------------- reveal
function reveal(room, el) {
  const s = room.settings;
  const hint = (p) => ({ id: rid(4), ...randomPointNear(p.loc, s.hintRadius * 0.6), r: s.hintRadius });
  const now = Date.now();
  const sv = survivorsAlive(room).filter((p) => fresh(room, p, HINT_FRESH_MS, now) || (p.loc && now - p.loc.at <= HINT_FRESH_MS));
  const zb = zombies(room).filter((p) => p.loc && now - p.loc.at <= HINT_FRESH_MS);
  room.hints = { at: el, nextAt: el + s.revealIntervalSec * 1000, zombie: sv.map(hint), survivor: zb.map(hint) };
  ev(room, 'Location scan complete. Hints updated.', { type: 'reveal', aud: 'zombie' });
  if (s.revealToSurvivors) ev(room, 'Threat scan complete. Zombie hints updated.', { type: 'reveal', aud: 'survivor' });
}

// ---------------------------------------------------------------- tick / win
export function checkWin(room, now = Date.now()) {
  if (room.status !== 'running' && room.status !== 'paused') return;
  if (survivorsAlive(room).length === 0) return finish(room, 'zombies', 'all_infected', now);
  if (room.status === 'running' && elapsed(room, now) >= durationMs(room)) return finish(room, 'survivors', 'time', now);
}

export function tick(room, now = Date.now()) {
  if (room.status === 'countdown') {
    if (now >= room.countdownEndsAt) beginRunning(room, now);
    return;
  }
  if (room.status !== 'running') return;
  const el = elapsed(room, now);
  const z = zoneAt(room, el);
  if (z.idx !== room.zoneIdx) {
    room.zoneIdx = z.idx;
    if (z.idx > 0) ev(room, 'The safe zone has shrunk. Stay inside the green boundary.', { type: 'zone', now });
  }
  if (!room.extractionAnnounced && extractionOpen(room, el)) {
    room.extractionAnnounced = true;
    ev(room, `Extraction is open for the final ${room.settings.extractionWindowMin} minutes.`, { type: 'extraction', now });
  }
  const s = room.settings;
  for (const p of Object.values(room.players)) {
    if (!isActive(p)) continue;
    if (p.radar && p.radar.until <= el) p.radar = null;
    // signal-loss forfeit
    if (s.forfeitSignalLossSec && p.team === 'survivor' && p.status === 'ALIVE' && el - p.lastLocEl > s.forfeitSignalLossSec * 1000) {
      p.status = 'OUT'; p.activity = null;
      ev(room, `${p.name} lost signal and was removed from the match.`, { type: 'left', now });
      continue;
    }
    // zone exposure (only with a fresh, accurate fix - never penalise on bad GPS)
    if (fresh(room, p, FIX_FRESH_MS, now)) {
      if (inShape(z.current, p.loc)) p.outSince = null;
      else {
        if (p.outSince == null) { p.outSince = el; out.toUser(room, p.id, 'toast', { kind: 'warn', msg: `Outside the safe zone! Return within ${s.graceSec}s.` }); }
        else if (el - p.outSince >= s.graceSec * 1000 && s.zonePenalty === 'infect' && p.team === 'survivor' && p.status === 'ALIVE') infect(room, p, null, 'zone', now);
      }
    }
    // activity progress
    const a = p.activity;
    if (a) {
      const cp = room.checkpoints.find((c) => c.id === a.cpId);
      if (!cp || !present(room, p, cp, now)) { p.activity = null; out.toUser(room, p.id, 'toast', { kind: 'warn', msg: 'You left the checkpoint. Progress lost.' }); }
      else if (el - a.startedEl >= a.holdMs) completeActivity(room, p, el, now);
    }
  }
  if (room.status !== 'running') return;
  if (el >= room.hints.nextAt) reveal(room, el);
  for (const [k, t] of Object.entries(room.tokens)) if (t.used || t.expiresAt < now - 60_000) delete room.tokens[k];
  checkWin(room, now);
}

function finish(room, winner, reason, now = Date.now()) {
  if (room.status === 'finished') return;
  const wasRunning = room.status === 'running' || room.status === 'paused';
  if (room.status === 'paused') { room.pausedTotal += now - room.pausedAt; room.pausedAt = 0; }
  room.status = 'finished'; room.endedAt = now; room.winner = winner; room.reason = reason;
  const players = Object.values(room.players).map((p) => {
    let bonus = 0;
    if (winner !== 'none' && p.team === (winner === 'survivors' ? 'survivor' : 'zombie') && p.status !== 'LEFT') bonus = 100;
    return {
      userId: p.id, name: p.name, avatar: p.avatar, startRole: p.origin, endRole: p.team, status: p.status,
      score: p.score + bonus, missions: p.missions.length, infections: p.infections, extracted: p.extracted,
    };
  });
  room.result = {
    gameId: room.id, code: room.code, name: room.settings.name, hostId: room.hostId, winner, reason,
    durationSec: Math.round(elapsed(room, now) / 1000), startedAt: room.startedAt ? new Date(room.startedAt) : null, endedAt: new Date(now),
    settings: { ...room.settings, area: undefined }, missionsDone: Object.keys(room.missionsDone), players,
    playerIds: players.map((p) => p.userId),
    events: room.events.filter((e) => e.aud === 'all').slice(-60).map((e) => ({ t: e.t, msg: e.msg })),
  };
  for (const id of Object.keys(room.players)) if (userRoom.get(id) === room.code) userRoom.delete(id);
  room.dirty = true;
  if (wasRunning) out.finished(room, room.result);
  out.persist(room, true);
  out.broadcast(room);
}

// ---------------------------------------------------------------- snapshot / restore
export function snapshot(room) {
  const { tokens, dirty, lastSnap, ...rest } = room;
  return JSON.parse(JSON.stringify(rest));
}
export function restoreRoom(state) {
  const room = { ...state, tokens: {}, dirty: true, lastSnap: 0 };
  for (const p of Object.values(room.players)) { p.connected = false; p.disconnectedAt = Date.now(); }
  if (room.status === 'running') { room.pausedAt = Date.now(); room.status = 'paused'; ev(room, 'Server restarted - match paused. Host: resume when ready.', { type: 'pause' }); }
  rooms.set(room.code, room);
  if (room.status !== 'finished') for (const id of Object.keys(room.players)) if (room.players[id].status !== 'LEFT') userRoom.set(id, room.code);
  return room;
}

// ---------------------------------------------------------------- janitor
export function janitor(now = Date.now()) {
  for (const room of rooms.values()) {
    const players = Object.values(room.players);
    const anyoneOnline = players.some((p) => p.connected);
    if (room.status === 'finished' && now - room.endedAt > GAME_RETENTION_MS) closeRoom(room, 'expired');
    else if (room.status === 'lobby') {
      for (const p of players) if (p.id !== room.hostId && !p.connected && p.disconnectedAt && now - p.disconnectedAt > 120_000) leaveRoom(room, p.id);
      if (rooms.has(room.code) && !anyoneOnline && now - room.createdAt > 30 * 60_000) closeRoom(room, 'idle');
    } else if ((room.status === 'running' || room.status === 'paused' || room.status === 'countdown') && !anyoneOnline) {
      const since = Math.max(...players.map((p) => p.disconnectedAt || 0), room.createdAt);
      if (now - since > 20 * 60_000) terminate(room, 'Everyone disconnected - match closed.');
    }
  }
}

// ---------------------------------------------------------------- views
const slimLoc = (p) => (p.loc ? { lat: p.loc.lat, lng: p.loc.lng, acc: Math.round(p.loc.acc), at: p.loc.at } : null);

export function viewFor(room, userId, { admin = false } = {}, now = Date.now()) {
  const s = room.settings;
  const me = room.players[userId];
  const el = elapsed(room, now);
  const finished = room.status === 'finished';
  const host = userId === room.hostId;
  const z = s.area ? zoneAt(room, el) : null;
  const myTeam = me?.team || null;
  const allowTeam = (p) => admin || finished || (myTeam && p.team === myTeam && (myTeam === 'zombie' || s.survivorsKnowTeam));

  const players = Object.values(room.players).map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, connected: p.connected, host: p.id === room.hostId,
    state: room.status === 'lobby' ? 'LOBBY' : p.status === 'INFECTED' || p.status === 'OUT' || p.status === 'LEFT' ? p.status : 'ALIVE',
    team: allowTeam(p) ? p.team : null,
    ...(admin ? { loc: slimLoc(p), score: p.score, origin: p.origin, status: p.status, flags: p.flags } : {}),
  }));

  const v = {
    code: room.code, status: room.status, hostId: room.hostId, serverNow: now, name: s.name,
    settings: s, players, isHost: host, isAdmin: admin,
    timer: {
      elapsedMs: el, durationMs: durationMs(room), paused: room.status === 'paused', countdownEndsAt: room.countdownEndsAt,
      extractionOpensInMs: Math.max(0, durationMs(room) - s.extractionWindowMin * 60_000 - el), extractionOpen: extractionOpen(room, el),
    },
    zone: z ? { ...z, area: s.area } : null,
    counts: {
      survivors: survivorsAlive(room).length, zombies: zombies(room).length,
      infected: Object.values(room.players).filter((p) => p.status === 'INFECTED').length,
      out: Object.values(room.players).filter((p) => p.status === 'OUT' || p.status === 'LEFT').length,
      total: Object.keys(room.players).length,
    },
  };
  const started = room.status !== 'lobby';
  v.checkpoints = (host && room.status === 'lobby') || admin ? room.checkpoints
    : started ? room.checkpoints.filter((c) => c.active && c.approved) : [];
  const types = new Set(room.checkpoints.filter((c) => c.active && c.approved && c.kind === 'mission').map((c) => c.missionType));
  v.missions = {
    required: s.requiredMissions, done: missionsDoneCount(room),
    list: started || admin ? [...types].map((t) => ({ type: t, ...MISSIONS[t], done: !!room.missionsDone[t], by: room.missionsDone[t]?.byName || null })) : [],
  };
  v.events = room.events.filter((e) => admin || e.aud === 'all' || e.aud === userId || e.aud === myTeam).slice(-40)
    .map((e) => ({ id: e.id, t: e.t, type: e.type, msg: e.msg }));
  if (host && room.status === 'lobby') v.readiness = readiness(room);

  if (me) {
    const team = [];
    if (started && myTeam) for (const p of Object.values(room.players)) {
      if (p.id !== me.id && p.team === myTeam && isActive(p) && p.loc && allowTeam(p)) team.push({ id: p.id, name: p.name, ...slimLoc(p), status: p.status });
    }
    const hints = myTeam === 'zombie' ? room.hints.zombie : s.revealToSurvivors ? room.hints.survivor : [];
    v.me = {
      id: me.id, team: myTeam, origin: me.origin, status: me.status, ready: me.ready, score: me.score, credits: me.credits,
      missions: me.missions, inventory: me.inventory, bought: me.bought, loc: slimLoc(me), extracted: me.extracted,
      shieldLeftMs: Math.max(0, me.shieldUntil - el), energyLeftMs: Math.max(0, me.energyUntil - el),
      graceLeftMs: me.outSince != null ? Math.max(0, s.graceSec * 1000 - (el - me.outSince)) : null,
      activity: me.activity ? { kind: me.activity.kind, cpId: me.activity.cpId, progressMs: el - me.activity.startedEl, holdMs: me.activity.holdMs } : null,
      radar: me.radar ? { list: me.radar.list, leftMs: me.radar.until - el } : null,
      supplyCd: Object.fromEntries(Object.entries(me.supplyCd).map(([k, t]) => [k, Math.max(0, t - el)])),
      jumpy: now - me.jumpAt < 8000, infections: me.infections,
    };
    v.team = team;
    v.hints = { at: room.hints.at, nextInMs: Math.max(0, room.hints.nextAt - el), list: started ? hints : [] };
  }
  if (admin) {
    v.hintsAll = room.hints;
    v.team = [];
  }
  if (finished) { v.winner = room.winner; v.reason = room.reason; v.result = { players: room.result?.players || [], durationSec: room.result?.durationSec || 0, missionsDone: Object.keys(room.missionsDone) }; }
  return v;
}

export const summary = (room) => ({
  code: room.code, name: room.settings.name, status: room.status, host: room.players[room.hostId]?.name,
  players: Object.keys(room.players).length, connected: Object.values(room.players).filter((p) => p.connected).length,
  max: room.settings.maxPlayers, elapsedMs: elapsed(room), durationMs: durationMs(room), createdAt: room.createdAt,
  survivors: survivorsAlive(room).length, zombies: zombies(room).length, missions: missionsDoneCount(room),
});
