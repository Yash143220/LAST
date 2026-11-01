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

// Keeps the screen awake during a match (best effort; not supported everywhere).
export function useWakeLock(active) {
  const lock = useRef(null);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    const acquire = async () => { try { lock.current = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } };
    const vis = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire(); document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock.current?.release?.().catch(() => {}); };
  }, [active]);
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}
