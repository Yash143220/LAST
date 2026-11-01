import os from 'node:os';
import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireAdmin, isAdminUser } from '../auth.js';
import { User, Game, GameResult, Report, Audit } from '../models.js';
import { rooms, summary, viewFor, pause, resume, terminate, leaveRoom, userRoom } from '../engine.js';
import { audit, deleteAccount, getAppSettings, setAppSettings } from '../services.js';
import { disconnectUser, broadcastAnnouncement, socketCount } from '../sockets.js';

export const admin = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
admin.use(requireAuth, requireAdmin);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const page = (req, def = 25) => ({ page: Math.max(1, +req.query.page || 1), limit: Math.min(100, Math.max(1, +req.query.limit || def)) });

admin.get('/overview', wrap(async (req, res) => {
  const d1 = new Date(Date.now() - 86400_000), d7 = new Date(Date.now() - 7 * 86400_000);
  const [users, new1, new7, suspended, finished24, finishedAll, openReports, wins, activeUsers7] = await Promise.all([
    User.countDocuments(), User.countDocuments({ createdAt: { $gte: d1 } }), User.countDocuments({ createdAt: { $gte: d7 } }),
    User.countDocuments({ suspended: true }), GameResult.countDocuments({ endedAt: { $gte: d1 } }), GameResult.countDocuments(),
    Report.countDocuments({ status: 'open' }),
    GameResult.aggregate([{ $group: { _id: '$winner', n: { $sum: 1 } } }]),
    User.countDocuments({ lastLoginAt: { $gte: d7 } }),
  ]);
  const live = [...rooms.values()];
  const by = (s) => live.filter((r) => r.status === s).length;
  res.json({
    users: { total: users, new24h: new1, new7d: new7, suspended, active7d: activeUsers7 },
    games: { finished24h: finished24, finishedTotal: finishedAll, winners: Object.fromEntries(wins.map((w) => [w._id, w.n])) },
    live: { rooms: live.length, lobby: by('lobby'), countdown: by('countdown'), running: by('running'), paused: by('paused'), finishedInMemory: by('finished'),
      playersConnected: live.reduce((n, r) => n + Object.values(r.players).filter((p) => p.connected).length, 0) },
    reports: { open: openReports },
    system: { uptimeSec: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      load: os.loadavg()[0].toFixed(2), sockets: socketCount(), mongo: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState], node: process.version },
    app: getAppSettings(),
  });
}));

admin.get('/rooms', (req, res) => res.json({ rooms: [...rooms.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt) }));
admin.get('/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  res.json({ state: viewFor(room, null, { admin: true }) });
});
admin.post('/rooms/:code/:action', wrap(async (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const a = req.params.action;
  let r;
  if (a === 'pause') r = pause(room, null, 'Paused by operations');
  else if (a === 'resume') r = resume(room);
  else if (a === 'terminate') r = terminate(room, 'Ended by operations');
  else return res.status(400).json({ error: 'Unknown action.' });
  audit(req.user, `room.${a}`, room.code);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
}));

admin.get('/games', wrap(async (req, res) => {
  const { page: pg, limit } = page(req);
  const q = req.query.q ? { $or: [{ code: new RegExp('^' + esc(req.query.q), 'i') }, { name: new RegExp(esc(req.query.q), 'i') }] } : {};
  const [rows, total] = await Promise.all([GameResult.find(q).sort({ endedAt: -1 }).skip((pg - 1) * limit).limit(limit).select('-events').lean(), GameResult.countDocuments(q)]);
  res.json({ total, page: pg, rows: rows.map((r) => ({ id: String(r._id), code: r.code, name: r.name, winner: r.winner, reason: r.reason, durationSec: r.durationSec, endedAt: r.endedAt, players: r.players.length, missions: r.missionsDone?.length || 0 })) });
}));

admin.get('/users', wrap(async (req, res) => {
  const { page: pg, limit } = page(req);
  const q = {};
  if (req.query.q) { const r = new RegExp(esc(req.query.q), 'i'); q.$or = [{ email: r }, { displayName: r }, { name: r }]; }
  if (req.query.filter === 'suspended') q.suspended = true;
  if (req.query.filter === 'admin') q.role = 'admin';
  const [rows, total] = await Promise.all([User.find(q).sort({ createdAt: -1 }).skip((pg - 1) * limit).limit(limit).select('-avatar').lean(), User.countDocuments(q)]);
  res.json({ total, page: pg, rows: rows.map((u) => ({ id: String(u._id), email: u.email, name: u.name, displayName: u.displayName, photoUrl: u.photoUrl, role: u.role, suspended: u.suspended, suspendedReason: u.suspendedReason, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, stats: u.stats, inGame: userRoom.get(String(u._id)) || null, isDev: u.isDev })) });
}));
admin.get('/users/:id', wrap(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Not found.' });
  const u = await User.findById(req.params.id).select('-avatar').lean();
  if (!u) return res.status(404).json({ error: 'Not found.' });
  const games = await GameResult.find({ playerIds: String(u._id) }).sort({ endedAt: -1 }).limit(10).select('code name winner endedAt players').lean();
  res.json({ user: { ...u, id: String(u._id) }, games: games.map((g) => ({ id: String(g._id), code: g.code, name: g.name, winner: g.winner, endedAt: g.endedAt, me: g.players.find((p) => p.userId === String(u._id)) })) });
}));
admin.patch('/users/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found.' });
  if (isAdminUser(u)) return res.status(400).json({ error: 'Administrators cannot be suspended here.' });
  u.suspended = !!req.body?.suspended;
  u.suspendedReason = u.suspended ? String(req.body?.reason || '').slice(0, 200) : '';
  if (u.suspended) u.tokenVersion++;
  await u.save();
  if (u.suspended) { const code = userRoom.get(String(u._id)); const room = code && rooms.get(code); if (room) leaveRoom(room, String(u._id), { kicked: true }); disconnectUser(String(u._id)); }
  audit(req.user, u.suspended ? 'user.suspend' : 'user.unsuspend', u.email, { reason: u.suspendedReason });
  res.json({ ok: true });
}));
admin.delete('/users/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found.' });
  if (isAdminUser(u)) return res.status(400).json({ error: 'Administrators cannot be deleted here.' });
  await deleteAccount(String(u._id), disconnectUser);
  audit(req.user, 'user.delete', u.email);
  res.json({ ok: true });
}));

admin.get('/reports', wrap(async (req, res) => {
  const q = req.query.status === 'all' ? {} : { status: req.query.status || 'open' };
  const rows = await Report.find(q).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ rows: rows.map((r) => ({ ...r, id: String(r._id) })) });
}));
admin.patch('/reports/:id', wrap(async (req, res) => {
  await Report.updateOne({ _id: req.params.id }, { $set: { status: 'resolved', resolvedBy: req.user.email, resolvedAt: new Date() } });
  audit(req.user, 'report.resolve', req.params.id);
  res.json({ ok: true });
}));

admin.get('/audit', wrap(async (req, res) => {
  const { page: pg, limit } = page(req, 40);
  const [rows, total] = await Promise.all([Audit.find().sort({ at: -1 }).skip((pg - 1) * limit).limit(limit).lean(), Audit.countDocuments()]);
  res.json({ total, rows });
}));

admin.post('/broadcast', wrap(async (req, res) => {
  const message = String(req.body?.message || '').replace(/[<>]/g, '').trim().slice(0, 200);
  if (!message) return res.status(400).json({ error: 'Message required.' });
  broadcastAnnouncement(message);
  audit(req.user, 'broadcast', '', { message });
  res.json({ ok: true });
}));
admin.patch('/settings', wrap(async (req, res) => {
  const patch = {};
  if (typeof req.body?.maintenance === 'boolean') patch.maintenance = req.body.maintenance;
  if (typeof req.body?.announcement === 'string') patch.announcement = req.body.announcement.replace(/[<>]/g, '').slice(0, 200);
  const s = await setAppSettings(patch);
  audit(req.user, 'settings.update', '', patch);
  res.json({ settings: s });
}));
