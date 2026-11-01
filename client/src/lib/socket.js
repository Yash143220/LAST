import { io } from 'socket.io-client';
export const socket = io({ autoConnect: false, withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
export const emit = (ev, payload) => new Promise((resolve) => {
  if (!socket.connected) return resolve({ ok: false, error: 'Offline - reconnecting…' });
  socket.timeout(8000).emit(ev, payload || {}, (err, res) => resolve(err ? { ok: false, error: 'No response from the server.' } : res));
});
