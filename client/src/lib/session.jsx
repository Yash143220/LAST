import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { socket } from './socket.js';

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const [boot, setBoot] = useState({ loading: true, config: null, user: null, activeGame: null, error: null });
  const [toasts, setToasts] = useState([]);
  const [conn, setConn] = useState('connecting');
  const [banner, setBanner] = useState(null);
  const tid = useRef(0);

  const toast = useCallback((msg, kind = 'info') => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'announce' ? 10000 : kind === 'danger' ? 7000 : 4500);
  }, []);

  const load = useCallback(async () => {
    try {
      const config = await api('/config');
      let user = null, activeGame = null;
      try { const m = await api('/me'); user = m.user; activeGame = m.activeGame; } catch (e) { if (e.status !== 401) throw e; }
      setBoot({ loading: false, config, user, activeGame, error: null });
    } catch (e) { setBoot((b) => ({ ...b, loading: false, error: e.message })); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // socket lifecycle follows sign-in state
  useEffect(() => {
    if (!boot.user) { socket.disconnect(); return; }
    const on = (e, f) => socket.on(e, f);
    const onC = () => setConn('online'), onD = () => setConn('offline');
    const onErr = () => setConn('offline');
    const onToast = (t) => toast(t.msg, t.kind);
    const onAnn = (a) => { setBanner(a.message); toast(a.message, 'announce'); };
    const onEnd = () => { toast('Your session ended. Please sign in again.', 'danger'); setBoot((b) => ({ ...b, user: null })); };
    on('connect', onC); on('disconnect', onD); on('connect_error', onErr); on('toast', onToast); on('announce', onAnn); on('session:ended', onEnd);
    socket.connect();
    return () => { socket.off('connect', onC); socket.off('disconnect', onD); socket.off('connect_error', onErr); socket.off('toast', onToast); socket.off('announce', onAnn); socket.off('session:ended', onEnd); };
  }, [boot.user, toast]);

  const value = useMemo(() => ({
    ...boot, conn, toasts, banner, dismissBanner: () => setBanner(null), toast, reload: load,
    setUser: (user) => setBoot((b) => ({ ...b, user })),
    setActiveGame: (activeGame) => setBoot((b) => ({ ...b, activeGame })),
    logout: async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } socket.disconnect(); setBoot((b) => ({ ...b, user: null, activeGame: null })); },
  }), [boot, conn, toasts, banner, toast, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Live match state from the server, with automatic (re)join.
export function useMatch(code) {
  const { toast } = useSession();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(null);
  const [offset, setOffset] = useState(0);
  const [incoming, setIncoming] = useState(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    const join = () => socket.emit('game:join', { code }, (r) => { if (alive && r && !r.ok) setError(r); });
    const onState = (s) => { if (!alive || s.code !== code.toUpperCase()) return; setError(null); setState(s); setOffset(s.serverNow - Date.now()); };
    const onClosed = (c) => { if (c.code === code.toUpperCase()) setClosed(c.why); };
    const onInc = (p) => { setIncoming({ ...p, offset: p.serverNow - Date.now() }); };
    socket.on('game:state', onState); socket.on('game:closed', onClosed); socket.on('infect:incoming', onInc); socket.on('connect', join);
    if (socket.connected) join();
    return () => { alive = false; socket.off('game:state', onState); socket.off('game:closed', onClosed); socket.off('infect:incoming', onInc); socket.off('connect', join); };
  }, [code, toast]);

  return { state, error, closed, offset, incoming, clearIncoming: () => setIncoming(null) };
}

export function useTicker(ms = 500) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(i); }, [ms]);
}
