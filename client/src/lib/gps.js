import { useEffect, useRef, useState } from 'react';

export function useGps(enabled) {
  const [fix, setFix] = useState(null);
  const [perm, setPerm] = useState('unknown'); // unknown | granted | denied | unsupported | error
  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) { setPerm('unsupported'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setPerm('granted'); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, at: Date.now() }); },
      (e) => setPerm(e.code === 1 ? 'denied' : 'error'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, perm };
}

export function askLocation() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, error: 'This browser has no location support.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, fix: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } }),
      (e) => resolve({ ok: false, error: e.code === 1 ? 'Location permission was denied. Enable it in your browser settings.' : 'Could not get a location fix. Move into the open and try again.' }),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// Keeps the screen awake during a match and reports whether it actually worked ('on' | 'off' | 'unsupported').
export function useWakeLock(active) {
  const [state, setState] = useState('unknown');
  useEffect(() => {
    if (!active) return;
    if (!('wakeLock' in navigator)) { setState('unsupported'); return; }
    let lock = null, dead = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen'); if (!dead) setState('on');
        lock.addEventListener('release', () => { if (!dead) setState('off'); });
      } catch { if (!dead) setState('off'); }
    };
    const vis = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire(); document.addEventListener('visibilitychange', vis);
    return () => { dead = true; document.removeEventListener('visibilitychange', vis); lock?.release?.().catch(() => {}); };
  }, [active]);
  return state;
}

// Calls back when the page comes back after being hidden (screen off / other app) so we can warn that GPS paused.
export function useResumeNotice(onResume) {
  const t = useRef(0); const cb = useRef(onResume); cb.current = onResume;
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'hidden') t.current = Date.now(); else if (t.current && Date.now() - t.current > 8000) { cb.current(Math.round((Date.now() - t.current) / 1000)); t.current = 0; } else t.current = 0; };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f);
  }, []);
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}
