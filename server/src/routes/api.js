import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { COOKIE, cookieOpts, signSession, verifyGoogleCredential, requireAuth, publicUser, sanitizeName } from '../auth.js';
import { User, GameResult, Preset } from '../models.js';
import { rooms, userRoom, createRoom, applyConfig, viewFor } from '../engine.js';
import { areaSchema, checkpointsSchema, cleanText } from '../schemas.js';
import { deleteAccount, getAppSettings } from '../services.js';
import { disconnectUser } from '../sockets.js';

export const api = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
const createLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => String(req.user?._id || req.ip), validate: { keyGeneratorIpFallback: false } });

const consentsSchema = z.object({
  terms: z.literal(true), privacy: z.literal(true), location: z.literal(true), safety: z.literal(true), age: z.literal(true),
});
const consentDoc = (c) => ({ version: config.consentVersion, acceptedAt: new Date(), ...c });

// ------------------------------------------------------------ public
api.get('/config', (req, res) => {
  const s = getAppSettings();
  res.json({
    googleClientId: config.googleClientId, devLogin: config.allowDevLogin, consentVersion: config.consentVersion,
    maintenance: s.maintenance, announcement: s.announcement,
  });
});

// ------------------------------------------------------------ auth
async function startSession(res, user) {
  user.lastLoginAt = new Date();
  user.role = config.adminEmails.includes(user.email) ? 'admin' : 'player';
  await user.save();
  res.cookie(COOKIE, signSession(user), cookieOpts());
}

api.post('/auth/google', authLimiter, wrap(async (req, res) => {
  const { credential, consents } = req.body || {};
  if (typeof credential !== 'string' || credential.length > 4000) return res.status(400).json({ error: 'Missing credential.' });
  let p;
  try { p = await verifyGoogleCredential(credential); } catch (e) { return res.status(e.status || 401).json({ error: e.status ? e.message : 'Google sign-in failed. Try again.' }); }
  if (!p.email_verified) return res.status(403).json({ error: 'Your Google email is not verified.' });
  let user = await User.findOne({ $or: [{ googleId: p.sub }, { email: p.email.toLowerCase() }] });
  if (!user) {
    const c = consentsSchema.safeParse(consents);
    if (!c.success) return res.status(400).json({ error: 'Accept every box to create your account.', code: 'CONSENT_REQUIRED' });
    user = new User({
      googleId: p.sub, email: p.email.toLowerCase(), emailVerified: true, name: p.name || '',
      displayName: sanitizeName(p.given_name || p.name || p.email.split('@')[0]) || 'Survivor', photoUrl: p.picture || '',
      consents: consentDoc(c.data),
    });
  } else {
    if (user.suspended) return res.status(403).json({ error: 'Account suspended.', code: 'SUSPENDED' });
    user.googleId ||= p.sub; user.photoUrl = p.picture || user.photoUrl; user.name = p.name || user.name; user.emailVerified = true;
    const c = consentsSchema.safeParse(consents);
    if (c.success) user.consents = consentDoc(c.data);
  }
  await startSession(res, user);
  res.json({ user: publicUser(user) });
}));

api.post('/auth/dev', authLimiter, wrap(async (req, res) => {
  if (!config.allowDevLogin) return res.status(404).json({ error: 'Not found.' });
  const name = sanitizeName(req.body?.name);
  const c = consentsSchema.safeParse(req.body?.consents);
  if (name.length < 2) return res.status(400).json({ error: 'Pick a name (2-20 characters).' });
  if (!c.success) return res.status(400).json({ error: 'Accept every box to continue.', code: 'CONSENT_REQUIRED' });
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dev.local`;
  let user = await User.findOne({ email });
  if (!user) user = new User({ email, emailVerified: true, name, displayName: name, isDev: true, googleId: `dev:${email}` });
  user.consents = consentDoc(c.data);
  await startSession(res, user);
  res.json({ user: publicUser(user) });
}));

api.post('/auth/logout', (req, res) => { res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined }); res.json({ ok: true }); });

// everything below requires a session
api.use(requireAuth);

api.post('/auth/logout-all', wrap(async (req, res) => {
  req.user.tokenVersion++; await req.user.save();
  disconnectUser(String(req.user._id));
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ profile
api.get('/me', (req, res) => res.json({ user: publicUser(req.user), activeGame: userRoom.get(String(req.user._id)) || null }));

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
api.patch('/me', wrap(async (req, res) => {
  const { displayName, avatar } = req.body || {};
  if (displayName !== undefined) {
    const n = sanitizeName(displayName);
    if (n.length < 2) return res.status(400).json({ error: 'Callsign must be 2-20 characters.' });
    req.user.displayName = n;
  }
  if (avatar !== undefined) {
    if (avatar === '') req.user.avatar = '';
    else if (typeof avatar === 'string' && avatar.length <= config.limits.avatarBytes && AVATAR_RE.test(avatar)) req.user.avatar = avatar;
    else return res.status(400).json({ error: 'Profile picture must be a JPEG/PNG/WebP under ~64 KB.' });
  }
  await req.user.save();
  const code = userRoom.get(String(req.user._id)); const room = code && rooms.get(code);
  if (room?.players[String(req.user._id)]) {
    const p = room.players[String(req.user._id)];
    if (room.status === 'lobby') { p.name = req.user.displayName; }
    p.avatar = req.user.avatar || req.user.photoUrl || ''; room.dirty = true;
  }
  res.json({ user: publicUser(req.user) });
}));

api.post('/me/consent', wrap(async (req, res) => {
  const c = consentsSchema.safeParse(req.body?.consents);
  if (!c.success) return res.status(400).json({ error: 'Accept every box to continue.' });
  req.user.consents = consentDoc(c.data); await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

api.get('/me/export', wrap(async (req, res) => {
  const id = String(req.user._id);
  const results = await GameResult.find({ playerIds: id }).lean();
  const u = req.user.toObject();
  delete u.tokenVersion; delete u.__v;
  res.setHeader('Content-Disposition', 'attachment; filename="operation-outbreak-my-data.json"');
  res.json({ exportedAt: new Date(), account: u, matches: results.map((r) => ({ ...r, players: r.players.filter((p) => p.userId === id) })) });
}));

api.delete('/me', wrap(async (req, res) => {
  if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });
  await deleteAccount(String(req.user._id), disconnectUser);
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.json({ ok: true });
}));

api.get('/me/games', wrap(async (req, res) => {
  const id = String(req.user._id);
  const rows = await GameResult.find({ playerIds: id }).sort({ endedAt: -1 }).limit(30).lean();
  res.json({
    games: rows.map((r) => {
      const me = r.players.find((p) => p.userId === id);
      return { id: String(r._id), code: r.code, name: r.name, winner: r.winner, reason: r.reason, durationSec: r.durationSec, endedAt: r.endedAt, players: r.players.length, me };
    }),
  });
}));

api.get('/results/:id', wrap(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Not found.' });
  const r = await GameResult.findById(req.params.id).lean();
  const id = String(req.user._id);
  if (!r || (!r.playerIds.includes(id) && req.user.role !== 'admin')) return res.status(404).json({ error: 'Not found.' });
  res.json({ result: r });
}));

// ------------------------------------------------------------ games
api.post('/games', createLimiter, wrap(async (req, res) => {
  if (getAppSettings().maintenance) return res.status(503).json({ error: 'New matches are paused for maintenance.' });
  if (!req.user.consents?.terms || req.user.consents.version !== config.consentVersion) return res.status(403).json({ error: 'Please accept the latest terms first.', code: 'CONSENT_REQUIRED' });
  const body = req.body?.settings || {};
  const allowed = ['name', 'maxPlayers', 'zombieCount', 'durationMin'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (patch.name) patch.name = cleanText(patch.name, 40);
  const r = createRoom({ id: String(req.user._id), displayName: req.user.displayName, avatar: req.user.avatar, photoUrl: req.user.photoUrl }, patch);
  if (!r.ok) return res.status(r.code === 'IN_GAME' ? 409 : 400).json({ error: r.error, code: r.code, activeGame: userRoom.get(String(req.user._id)) });
  res.json({ code: r.room.code });
}));

const codeOf = (req) => String(req.params.code || '').toUpperCase();
api.get('/games/:code/preview', (req, res) => {
  const room = rooms.get(codeOf(req));
  if (!room) return res.status(404).json({ error: 'No match with that code.' });
  res.json({ code: room.code, name: room.settings.name, status: room.status, players: Object.keys(room.players).length, max: room.settings.maxPlayers, host: room.players[room.hostId]?.name, joined: !!room.players[String(req.user._id)] });
});

api.patch('/games/:code/config', wrap(async (req, res) => {
  const room = rooms.get(codeOf(req));
  if (!room) return res.status(404).json({ error: 'No match with that code.' });
  const { settings, checkpoints } = req.body || {};
  if (settings && typeof settings !== 'object') return res.status(400).json({ error: 'Bad settings.' });
  if (settings?.area) { const a = areaSchema.safeParse(settings.area); if (!a.success) return res.status(400).json({ error: a.error.issues[0].message }); }
  if (settings?.name) settings.name = cleanText(settings.name, 40);
  const r = applyConfig(room, String(req.user._id), { settings, checkpoints });
  if (!r.ok) return res.status(r.code === 'FORBIDDEN' ? 403 : 400).json({ error: r.error });
  res.json({ state: viewFor(room, String(req.user._id)) });
}));

// ------------------------------------------------------------ presets (saved areas + checkpoints)
api.get('/presets', wrap(async (req, res) => {
  const list = await Preset.find({ ownerId: String(req.user._id) }).sort({ updatedAt: -1 }).limit(20).lean();
  res.json({ presets: list.map((p) => ({ id: String(p._id), name: p.name, area: p.area, checkpoints: p.checkpoints, updatedAt: p.updatedAt })) });
}));
api.post('/presets', wrap(async (req, res) => {
  const name = cleanText(req.body?.name, 60);
  const a = areaSchema.safeParse(req.body?.area); const c = checkpointsSchema.safeParse(req.body?.checkpoints);
  if (name.length < 2 || !a.success || !c.success) return res.status(400).json({ error: 'Preset needs a name, a valid area and valid checkpoints.' });
  const ownerId = String(req.user._id);
  if ((await Preset.countDocuments({ ownerId })) >= 20) return res.status(400).json({ error: 'Preset limit reached (20). Delete one first.' });
  // approvals are never inherited: a loaded preset must be re-reviewed on site
  const p = await Preset.create({ ownerId, name, area: a.data, checkpoints: c.data.map((x) => ({ ...x, approved: false })) });
  res.json({ id: String(p._id) });
}));
api.delete('/presets/:id', wrap(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Not found.' });
  await Preset.deleteOne({ _id: req.params.id, ownerId: String(req.user._id) });
  res.json({ ok: true });
}));

