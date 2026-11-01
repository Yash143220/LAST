import { Game, GameResult, User, Report, Audit, Preset, Setting } from './models.js';
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
      const won = result.winner !== 'none' && ((result.winner === 'survivors' && p.endRole === 'survivor') || (result.winner === 'zombies' && p.endRole === 'zombie'));
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
