import crypto from 'node:crypto';
import { Game, GameResult, User, Report, Audit, Preset, Setting, Avatar } from './models.js';
import { rooms, userRoom, out, snapshot, restoreRoom, leaveRoom } from './engine.js';

const log = (...a) => console.log('[svc]', ...a);

export async function saveRoom(room) {
  try {
    const finished = room.status === 'finished';
    const set = {
      hostId: room.hostId, name: room.settings.name, status: room.status, playerIds: Object.keys(room.players),
      playerCount: Object.keys(room.players).length,
      startedAt: room.startedAt ? new Date(room.startedAt) : undefined, endedAt: room.endedAt ? new Date(room.endedAt) : undefined,
    };
    const update = { $set: set };
    if (finished) update.$unset = { state: 1 }; else set.state = snapshot(room);
    await Game.updateOne({ code: room.code }, update, { upsert: true });
    room.lastSnap = Date.now();
  } catch (e) { console.error('[svc] saveRoom failed', room.code, e.message); }
}

const pending = new Map();
export function persist(room, force) {
  if (!force) return;
  if (pending.has(room.code)) return; // coalesce bursts within 400 ms
  pending.set(room.code, setTimeout(() => { pending.delete(room.code); if (rooms.has(room.code) || room.status === 'finished') saveRoom(room); }, 400));
}

export async function flushAll() {
  await Promise.allSettled([...rooms.values()].filter((r) => r.status !== 'finished').map(saveRoom));
}

export async function onFinish(room, result) {
  try {
    await GameResult.create(result);
    const ops = result.players.filter((p) => p.userId).map((p) => {
      const won = !!p.won;
      const counted = result.winner !== 'none';
      return {
        updateOne: {
          filter: { _id: p.userId },
          update: { $inc: {
            'stats.games': counted ? 1 : 0, 'stats.wins': won ? 1 : 0,
            'stats.asSurvivor': counted && p.startRole === 'survivor' ? 1 : 0, 'stats.asZombie': counted && p.startRole === 'zombie' ? 1 : 0,
            'stats.infections': p.infections, 'stats.missions': p.missions, 'stats.extractions': p.extracted ? 1 : 0,
            'stats.points': p.score, 'stats.secondsPlayed': counted ? result.durationSec : 0,
          } },
        },
      };
    });
    if (ops.length) await User.bulkWrite(ops, { ordered: false });
    log('finished', room.code, result.winner, result.reason);
  } catch (e) { console.error('[svc] onFinish failed', room.code, e.message); }
}

export async function restoreRooms() {
  const docs = await Game.find({ status: { $in: ['lobby', 'countdown', 'running', 'paused'] }, state: { $ne: null } }).lean();
  let n = 0;
  for (const d of docs) { try { restoreRoom(d.state); n++; } catch (e) { console.error('restore failed', d.code, e.message); } }
  const stale = await Game.updateMany({ status: { $in: ['lobby', 'countdown', 'running', 'paused'] }, state: null }, { $set: { status: 'finished' } });
  log(`restored ${n} room(s); closed ${stale.modifiedCount} orphan record(s)`);
}

export const audit = (actor, action, target, meta) =>
  Audit.create({ actorId: String(actor._id), actorEmail: actor.email, action, target: String(target ?? ''), meta }).catch(() => {});

export async function createReport(room, user, { kind, note, loc }) {
  return Report.create({ gameCode: room?.code, reporterId: user.id, reporterName: user.displayName, kind, note, loc: loc ? { lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5) } : undefined });
}

// Fully removes a user and anonymises anything that must survive (match history, safety reports).
export async function deleteAccount(userId, disconnect) {
  const code = userRoom.get(userId);
  const room = code && rooms.get(code);
  if (room) { leaveRoom(room, userId); }
  await Promise.all([
    GameResult.updateMany({ playerIds: userId }, { $set: { 'players.$[p].name': 'Deleted player', 'players.$[p].avatar': '', 'players.$[p].userId': null }, $pull: { playerIds: userId } }, { arrayFilters: [{ 'p.userId': userId }] }),
    GameResult.updateMany({ hostId: userId }, { $set: { hostId: null } }),
    Game.updateMany({ playerIds: userId }, { $pull: { playerIds: userId } }),
    Game.updateMany({ hostId: userId, status: 'finished' }, { $set: { hostId: null } }),
    Preset.deleteMany({ ownerId: userId }),
    Avatar.deleteOne({ _id: userId }),
    Report.updateMany({ reporterId: userId }, { $set: { reporterId: null, reporterName: 'Deleted player' } }),
  ]);
  await User.deleteOne({ _id: userId });
  disconnect?.(userId);
}

let appSettings = { maintenance: false, announcement: '' };
export const getAppSettings = () => appSettings;
export async function loadAppSettings() { const d = await Setting.findById('app').lean(); if (d) appSettings = { ...appSettings, ...d.value }; }
export async function setAppSettings(patch) {
  appSettings = { ...appSettings, ...patch };
  await Setting.updateOne({ _id: 'app' }, { $set: { value: appSettings } }, { upsert: true });
  return appSettings;
}

// ---- avatars: stored once (small WebP/JPEG/PNG), served by URL with long cache headers
const MAGIC = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/webp', (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
];
export const sniffImage = (buf) => MAGIC.find(([, f]) => f(buf))?.[0] || null;

export async function saveAvatar(userId, buf) {
  const mime = sniffImage(buf);
  if (!mime) throw Object.assign(new Error('Use a JPEG, PNG or WebP image.'), { status: 400 });
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  await Avatar.updateOne({ _id: userId }, { $set: { mime, hash, data: buf, updatedAt: new Date() } }, { upsert: true });
  await User.updateOne({ _id: userId }, { $set: { avatarVer: hash }, $unset: { avatar: 1 } });
  return hash;
}
export async function removeAvatar(userId) {
  await Avatar.deleteOne({ _id: userId });
  await User.updateOne({ _id: userId }, { $set: { avatarVer: '' }, $unset: { avatar: 1 } });
}

// One-time migration of legacy inline data-URL avatars into the Avatar collection.
export async function migrateAvatars() {
  const legacy = await User.find({ avatar: { $nin: ['', null] } }).select('avatar').lean();
  let n = 0;
  for (const u of legacy) {
    const m = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/.exec(u.avatar || '');
    try { if (m) { await saveAvatar(String(u._id), Buffer.from(m[1], 'base64')); n++; } else await User.updateOne({ _id: u._id }, { $unset: { avatar: 1 } }); } catch { /* skip bad record */ }
  }
  if (legacy.length) log(`migrated ${n}/${legacy.length} legacy avatars`);
}
