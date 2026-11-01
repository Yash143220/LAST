import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { config } from './config.js';
import { COOKIE, userFromToken, isAdminUser } from './auth.js';
import {
  rooms, userRoom, out, addPlayer, setConnected, setReady, leaveRoom, startGame, pause, resume, terminate, updateLocation,
  startActivity, cancelActivity, buyItem, useItem, requestInfection, confirmInfection, tick, janitor, viewFor,
} from './engine.js';
import { persist, onFinish, saveRoom, createReport } from './services.js';
import { cleanText } from './schemas.js';

let io;
const userSockets = new Map();   // userId -> Set<socket>
const watchers = new Map();      // room code -> Set<socket> (admin spectators)

export const socketCount = () => io?.engine?.clientsCount ?? 0;
export const broadcastAnnouncement = (message) => io?.emit('announce', { message });
export function disconnectUser(userId) {
  for (const s of userSockets.get(userId) || []) { s.emit('session:ended'); s.disconnect(true); }
}

const emitUser = (userId, event, payload) => { for (const s of userSockets.get(userId) || []) s.emit(event, payload); };

function broadcast(room) {
  const now = Date.now();
  for (const id of Object.keys(room.players)) if (userSockets.has(id)) emitUser(id, 'game:state', viewFor(room, id, {}, now));
  const w = watchers.get(room.code);
  if (w?.size) { const v = viewFor(room, null, { admin: true }, now); for (const s of w) s.emit('admin:state', v); }
  room.dirty = false; room.lastBroadcast = now;
}

out.broadcast = broadcast;
out.toUser = (room, userId, event, payload) => emitUser(userId, event, payload);
out.persist = persist;
out.finished = (room, result) => onFinish(room, result);
out.closed = (room, why) => {
  for (const id of Object.keys(room.players)) emitUser(id, 'game:closed', { code: room.code, why });
  for (const s of watchers.get(room.code) || []) s.emit('admin:closed', { code: room.code });
  watchers.delete(room.code);
};

const allowedOrigin = (origin, host) => {
  if (!origin) return true;
  try { return new URL(origin).host === host || config.allowedOrigins.includes(origin); } catch { return false; }
};

function bucket(socket, key, perSec, burst) {
  const b = (socket.data.buckets ||= {});
  const now = Date.now();
  const s = (b[key] ||= { tokens: burst, at: now });
  s.tokens = Math.min(burst, s.tokens + ((now - s.at) / 1000) * perSec); s.at = now;
  if (s.tokens < 1) return false;
  s.tokens -= 1; return true;
}

export function initSockets(httpServer) {
  io = new Server(httpServer, {
    maxHttpBufferSize: 16_000, pingInterval: 15_000, pingTimeout: 20_000,
    cors: { origin: config.allowedOrigins.length ? config.allowedOrigins : false, credentials: true },
    allowRequest: (req, cb) => cb(null, allowedOrigin(req.headers.origin, req.headers.host)),
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const user = await userFromToken(cookies[COOKIE]);
      if (!user) return next(new Error('unauthorized'));
      if (user.suspended) return next(new Error('suspended'));
      socket.data.user = { id: String(user._id), displayName: user.displayName, avatar: user.avatar, photoUrl: user.photoUrl, admin: isAdminUser(user) };
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(socket);

    const room = () => rooms.get(socket.data.code);
    const on = (event, fn, [rate, burst] = [10, 20]) => socket.on(event, async (payload, cb) => {
      const ack = typeof cb === 'function' ? cb : () => {};
      try {
        if (!bucket(socket, event, rate, burst)) return ack({ ok: false, error: 'Slow down.', code: 'RATE' });
        const r = await fn(payload && typeof payload === 'object' ? payload : {});
        ack(r ?? { ok: true });
      } catch (e) { console.error('[socket]', event, e); ack({ ok: false, error: 'Server error.' }); }
    });
    const needRoom = (fn) => (p) => { const r = room(); if (!r) return { ok: false, error: 'You are not in a match.', code: 'NO_ROOM' }; return fn(r, p); };
    const sync = (r, res) => { if (r.dirty || res?.ok) { r.dirty = true; } return res; };

    function attach(r, rejoined) {
      socket.data.code = r.code;
      socket.join(`g:${r.code}`);
      setConnected(r, user.id, true);
      socket.emit('game:state', viewFor(r, user.id));
      if (!rejoined) broadcast(r);
    }

    on('game:join', ({ code }) => {
      const r = rooms.get(String(code || '').toUpperCase());
      if (!r) return { ok: false, error: 'No match with that code.', code: 'NOT_FOUND' };
      const res = addPlayer(r, user);
      if (!res.ok) return res;
      attach(r, res.rejoined);
      if (res.rejoined) broadcast(r);
      return { ok: true, code: r.code };
    }, [2, 6]);

    on('game:resume-session', () => {
      const code = userRoom.get(user.id); const r = code && rooms.get(code);
      if (!r) return { ok: true, code: null };
      attach(r, true); broadcast(r);
      return { ok: true, code: r.code };
    }, [2, 6]);

    on('game:leave', needRoom((r) => {
      socket.leave(`g:${r.code}`);
      const res = leaveRoom(r, user.id);
      socket.data.code = null;
      if (!res.closed) broadcast(r);
      return res;
    }));

    on('lobby:ready', needRoom((r, { ready }) => sync(r, setReady(r, user.id, !!ready))));
    on('host:start', needRoom((r) => { const res = startGame(r, user.id); if (res.ok) broadcast(r); return res; }), [1, 3]);
    on('host:pause', needRoom((r) => { if (r.hostId !== user.id) return { ok: false, error: 'Host only.' }; const res = pause(r, user.id, 'Paused by host'); if (res.ok) broadcast(r); return res; }), [1, 3]);
    on('host:resume', needRoom((r) => { if (r.hostId !== user.id) return { ok: false, error: 'Host only.' }; const res = resume(r); if (res.ok) broadcast(r); return res; }), [1, 3]);
    on('host:terminate', needRoom((r) => {
      if (r.hostId !== user.id) return { ok: false, error: 'Host only.' };
      const res = terminate(r, 'Ended by host'); if (res.ok && !res.closed) broadcast(r); return res;
    }), [1, 3]);
    on('host:kick', needRoom((r, { userId }) => {
      if (r.hostId !== user.id || r.status !== 'lobby' || userId === user.id || !r.players[userId]) return { ok: false, error: 'Not allowed.' };
      leaveRoom(r, userId, { kicked: true });
      emitUser(userId, 'game:closed', { code: r.code, why: 'kicked' });
      for (const s of userSockets.get(userId) || []) { s.leave(`g:${r.code}`); s.data.code = null; }
      broadcast(r); return { ok: true };
    }), [2, 6]);

    on('loc:update', needRoom((r, fix) => updateLocation(r, user.id, fix)), [2, 6]);
    on('activity:start', needRoom((r, { cpId }) => { const res = startActivity(r, user.id, String(cpId)); if (res.ok) broadcast(r); return res; }), [2, 6]);
    on('activity:cancel', needRoom((r) => { const res = cancelActivity(r, user.id); if (res.ok) broadcast(r); return res; }));
    on('supply:buy', needRoom((r, { cpId, item }) => { const res = buyItem(r, user.id, String(cpId), String(item)); if (res.ok) broadcast(r); return res; }), [2, 6]);
    on('item:use', needRoom((r, { item }) => { const res = useItem(r, user.id, String(item)); if (res.ok) broadcast(r); return res; }), [2, 6]);
    on('infect:request', needRoom((r) => requestInfection(r, user.id)), [1, 3]);
    on('infect:confirm', needRoom((r, { token }) => { const res = confirmInfection(r, user.id, token); if (res.ok) broadcast(r); return res; }), [1, 4]);

    on('report:hazard', needRoom(async (r, { kind, note, pause: wantPause }) => {
      const kinds = ['hazard', 'medical', 'harassment', 'trespass', 'bug', 'other'];
      if (!kinds.includes(kind)) return { ok: false, error: 'Pick a report type.' };
      const p = r.players[user.id];
      if (p.reportAt && Date.now() - p.reportAt < 20_000) return { ok: false, error: 'Please wait before sending another report.' };
      p.reportAt = Date.now();
      await createReport(r, user, { kind, note: cleanText(note, 500), loc: p.loc });
      emitUser(r.hostId, 'toast', { kind: 'danger', msg: `Safety report from ${p.name}: ${kind}.` });
      let paused = false;
      if (wantPause && r.status === 'running' && (!p.pauseAt || Date.now() - p.pauseAt > 180_000)) {
        p.pauseAt = Date.now(); paused = pause(r, user.id, `Safety pause requested by ${p.name}`).ok;
      }
      broadcast(r);
      return { ok: true, paused };
    }), [1, 3]);

    // admin spectator
    on('admin:watch', ({ code }) => {
      if (!user.admin) return { ok: false, error: 'Forbidden.' };
      const r = rooms.get(String(code || '').toUpperCase());
      if (!r) return { ok: false, error: 'Room not found.' };
      for (const [, set] of watchers) set.delete(socket);
      if (!watchers.has(r.code)) watchers.set(r.code, new Set());
      watchers.get(r.code).add(socket);
      socket.emit('admin:state', viewFor(r, null, { admin: true }));
      return { ok: true };
    }, [2, 6]);
    on('admin:unwatch', () => { for (const [, set] of watchers) set.delete(socket); });

    socket.on('disconnect', () => {
      const set = userSockets.get(user.id);
      set?.delete(socket);
      for (const [, w] of watchers) w.delete(socket);
      if (set && set.size === 0) {
        userSockets.delete(user.id);
        const r = room();
        if (r && r.players[user.id]) { setConnected(r, user.id, false); }
      }
    });

    // restore session automatically on (re)connect
    const code = userRoom.get(user.id); const r = code && rooms.get(code);
    if (r) attach(r, true);
  });
  return io;
}

// Global 1 Hz loop: advances every room's clock, broadcasts state, snapshots running rooms.
let n = 0;
export function startLoop() {
  return setInterval(() => {
    const now = Date.now(); n++;
    for (const room of [...rooms.values()]) {
      try {
        tick(room, now);
        const running = room.status === 'running';
        if (room.dirty && (!running || now - (room.lastBroadcast || 0) >= 1900)) broadcast(room);
        if ((running || room.status === 'paused') && now - room.lastSnap > 15_000) { room.lastSnap = now; saveRoom(room); }
      } catch (e) { console.error('[loop] room', room.code, e); }
    }
    if (n % 20 === 0) janitor(now);
  }, 1000);
}
