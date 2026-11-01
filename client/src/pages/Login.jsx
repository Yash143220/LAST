import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import ConsentBoxes, { NO_CONSENT, allChecked } from '../components/Consent.jsx';
import { Banner, Button, Field, Input } from '../components/ui.jsx';

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
}

export default function Login() {
  const { user, config, setUser, reload } = useSession();
  const loc = useLocation();
  const [consents, setConsents] = useState(NO_CONSENT);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [devName, setDevName] = useState('');
  const btn = useRef(null);
  const consentsRef = useRef(consents);
  consentsRef.current = consents;
  const ok = allChecked(consents);

  useEffect(() => {
    if (!config?.googleClientId) return;
    let dead = false;
    loadGsi().then(() => {
      if (dead) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId, ux_mode: 'popup', auto_select: false,
        callback: async (resp) => {
          setBusy(true); setErr('');
          try { const r = await api('/auth/google', { method: 'POST', body: { credential: resp.credential, consents: consentsRef.current } }); setUser(r.user); await reload(); }
          catch (e) { setErr(e.message); } finally { setBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(btn.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 300, logo_alignment: 'left' });
    }).catch((e) => setErr(e.message));
    return () => { dead = true; };
  }, [config?.googleClientId, setUser, reload]);

  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const devLogin = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/auth/dev', { method: 'POST', body: { name: devName, consents } }); setUser(r.user); await reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <main className="min-h-dvh safe-top flex flex-col items-center px-5 pb-10">
      <div className="w-full max-w-md pt-10">
        <svg viewBox="0 0 120 120" className="size-24 mb-4" aria-hidden="true">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#2c5646" strokeWidth="2" /><circle cx="60" cy="60" r="36" fill="none" stroke="#26a62d" strokeWidth="3" strokeDasharray="7 5" />
          <circle cx="60" cy="60" r="18" fill="none" stroke="#85d950" strokeWidth="3" /><circle cx="60" cy="60" r="5" fill="#ed6760" />
          <path d="M60 60 L104 36" stroke="#85d950" strokeWidth="2" opacity=".7" />
        </svg>
        <h1 className="font-display font-bold text-5xl leading-[0.95] text-text">Operation:<br /><span className="text-lime">Outbreak</span></h1>
        <p className="mt-3 text-sage text-lg max-w-sm">A real-world survival game for your phone. Survivors race between outdoor checkpoints. Zombies hunt them down. Walk, don't run.</p>

        <div className="mt-8 rounded-2xl bg-surface border border-line p-5 space-y-5">
          <ConsentBoxes value={consents} onChange={setConsents} />
          {err && <Banner tone="bad">{err}</Banner>}
          {config?.googleClientId ? (
            <div className="relative h-[44px] flex justify-center">
              <div ref={btn} className={ok ? '' : 'opacity-40'} />
              {!ok && <button aria-label="Accept all agreements first" onClick={() => setErr('Tick every box above to continue.')} className="absolute inset-0 cursor-not-allowed" />}
            </div>
          ) : (!config?.devLogin && <Banner tone="warn">Google sign-in is not configured on this server.</Banner>)}
          {busy && <p className="text-sm text-sage text-center">Signing you in…</p>}
          {config?.devLogin && (
            <div className="pt-4 border-t border-line space-y-3">
              <Banner tone="warn">Development login is enabled on this server. It is disabled automatically in production.</Banner>
              <Field label="Test callsign"><Input value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="e.g. Rook" maxLength={20} /></Field>
              <Button className="w-full" variant="ghost" disabled={!ok || devName.trim().length < 2} busy={busy} onClick={devLogin}>Continue as test player</Button>
            </div>
          )}
        </div>
        <p className="mt-4 text-xs text-sage flex gap-2"><ShieldAlert className="size-4 shrink-0 mt-0.5" />We only ask for your Google name, email and photo. Your location is used live during matches and is not kept afterwards.</p>
      </div>
    </main>
  );
}
