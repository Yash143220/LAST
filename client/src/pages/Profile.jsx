import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Download, LogOut, Trash2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Avatar, Banner, Button, Card, Field, Input, Sheet } from '../components/ui.jsx';

// Crops to a square and shrinks to 128 px WebP (JPEG fallback): a few KB per picture.
function resizeToBlob(file, px = 128) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Use a JPEG, PNG or WebP image.'));
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = px;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, px, px);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/webp', 0.8);
    };
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = url;
  });
}

export default function Profile() {
  const { user, setUser, logout, toast } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState('');
  const file = useRef(null);

  const patch = async (body, label) => {
    setBusy(label);
    try { const r = await api('/me', { method: 'PATCH', body }); setUser(r.user); toast('Saved.', 'good'); } catch (e) { toast(e.message, 'warn'); } finally { setBusy(''); }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setBusy('avatar');
    try {
      const blob = await resizeToBlob(f);
      const r = await fetch('/api/me/avatar', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Upload failed.');
      setUser(j.user); toast('Picture saved.', 'good');
    } catch (er) { toast(er.message, 'warn'); } finally { setBusy(''); }
  };
  const removeAvatar = async () => { setBusy('avatar'); try { const r = await api('/me/avatar', { method: 'DELETE' }); setUser(r.user); } catch (er) { toast(er.message, 'warn'); } finally { setBusy(''); } };
  const exportData = async () => {
    const r = await fetch('/api/me/export', { credentials: 'same-origin' });
    if (!r.ok) return toast('Export failed.', 'warn');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'humans-the-last-alive-my-data.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  const deleteAccount = async () => {
    setBusy('del');
    try { await api('/me', { method: 'DELETE', body: { confirm: 'DELETE' } }); toast('Your account has been deleted.', 'good'); await logout(); nav('/login'); }
    catch (e) { toast(e.message, 'bad'); setBusy(''); }
  };
  const signOutAll = async () => { try { await api('/auth/logout-all', { method: 'POST' }); } catch { /* ignore */ } await logout(); nav('/login'); };
  const c = user.consents || {};
  const dirty = name.trim() !== user.displayName;

  return (
    <main className="max-w-xl mx-auto px-4 pb-20 safe-top">
      <header className="py-4 flex items-center gap-2"><Link to="/" className="size-10 grid place-items-center rounded-xl text-sage hover:bg-raised" aria-label="Back"><ArrowLeft className="size-5" /></Link><h1 className="font-display text-3xl font-bold">Profile &amp; settings</h1></header>
      <div className="space-y-4">
        <Card className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar || user.photoUrl} name={user.displayName} size={80} ring="ring-lime" />
            <div className="flex flex-col gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
              <Button size="sm" variant="ghost" icon={Camera} busy={busy === 'avatar'} onClick={() => file.current.click()}>Upload picture</Button>
              {user.avatar && <Button size="sm" variant="quiet" onClick={removeAvatar}>{user.photoUrl ? 'Use Google photo' : 'Remove picture'}</Button>}
            </div>
          </div>
          <Field label="Callsign" hint="2-20 characters. Other players see this name."><Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></Field>
          <Button disabled={!dirty || name.trim().length < 2} busy={busy === 'name'} onClick={() => patch({ displayName: name }, 'name')}>Save callsign</Button>
        </Card>

        <Card className="space-y-1 text-sm">
          <h2 className="font-display text-2xl font-bold mb-1">Account</h2>
          <div className="flex justify-between gap-4"><span className="text-sage">Email</span><span className="truncate">{user.email}</span></div>
          {user.name && <div className="flex justify-between gap-4"><span className="text-sage">Google name</span><span className="truncate">{user.name}</span></div>}
          <div className="flex justify-between gap-4"><span className="text-sage">Member since</span><span>{new Date(user.createdAt).toLocaleDateString()}</span></div>
          <div className="flex justify-between gap-4"><span className="text-sage">Matches played</span><span>{user.stats.games}</span></div>
          <p className="text-xs text-sage pt-2">Your email and Google name are private. Only your callsign and picture are shown to other players.</p>
        </Card>

        <Card className="space-y-2">
          <h2 className="font-display text-2xl font-bold flex items-center gap-2"><ShieldCheck className="size-5 text-lime" />Agreements</h2>
          <p className="text-sm text-sage">Accepted {c.acceptedAt ? new Date(c.acceptedAt).toLocaleString() : '-'} (version {c.version}).</p>
          <ul className="text-sm space-y-1">{[['terms', 'Terms & Conditions', '/terms'], ['privacy', 'Privacy Policy', '/privacy'], ['safety', 'Safety Rules', '/safety']].map(([k, l, to]) => <li key={k} className="flex justify-between"><Link to={to} className="text-lime underline">{l}</Link><span className="text-sage">{c[k] ? 'accepted' : 'not accepted'}</span></li>)}
            <li className="flex justify-between"><span>Location sharing in matches</span><span className="text-sage">{c.location ? 'accepted' : 'not accepted'}</span></li></ul>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-display text-2xl font-bold">Your data</h2>
          <Button variant="ghost" icon={Download} onClick={exportData} className="w-full">Download my data (JSON)</Button>
          <Button variant="ghost" icon={LogOut} onClick={async () => { await logout(); nav('/login'); }} className="w-full">Sign out</Button>
          <Button variant="quiet" onClick={signOutAll} className="w-full">Sign out of all devices</Button>
        </Card>

        <Card className="space-y-3 border-danger/50">
          <h2 className="font-display text-2xl font-bold text-danger">Delete account</h2>
          <p className="text-sm text-sage">Permanently removes your profile, picture, saved map presets and statistics. Past matches stay in other players' history with your name replaced by "Deleted player". This cannot be undone.</p>
          <Button variant="dangerGhost" icon={Trash2} onClick={() => { setTyped(''); setDel(true); }}>Delete my account</Button>
        </Card>
      </div>

      <Sheet open={del} onClose={() => setDel(false)} title="Delete your account?">
        <div className="space-y-3">
          <Banner tone="bad">This is permanent. If you are in a match you will be removed from it.</Banner>
          <Field label='Type DELETE to confirm'><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setDel(false)}>Keep account</Button><Button variant="danger" disabled={typed !== 'DELETE'} busy={busy === 'del'} onClick={deleteAccount}>Delete forever</Button></div>
        </div>
      </Sheet>
    </main>
  );
}
