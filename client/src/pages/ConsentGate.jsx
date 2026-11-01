import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import ConsentBoxes, { NO_CONSENT, allChecked } from '../components/Consent.jsx';
import { Banner, Button } from '../components/ui.jsx';

export default function ConsentGate() {
  const { setUser, logout } = useSession();
  const [v, setV] = useState(NO_CONSENT);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const r = await api('/me/consent', { method: 'POST', body: { consents: v } }); setUser(r.user); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <main className="min-h-dvh safe-top grid place-items-center p-5">
      <div className="max-w-md w-full space-y-4">
        <h1 className="font-display text-4xl font-bold">Updated agreements</h1>
        <p className="text-sage">Please review and accept the current terms to keep playing.</p>
        <div className="bg-surface border border-line rounded-2xl p-5"><ConsentBoxes value={v} onChange={setV} /></div>
        {err && <Banner tone="bad">{err}</Banner>}
        <div className="flex gap-2"><Button className="flex-1" disabled={!allChecked(v)} busy={busy} onClick={go}>Accept and continue</Button><Button variant="ghost" onClick={logout}>Sign out</Button></div>
      </div>
    </main>
  );
}
