import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Crosshair, Crown, MapPin, Settings2, Share2, UserX, CheckCircle2, Circle } from 'lucide-react';
import { emit } from '../lib/socket.js';
import { askLocation } from '../lib/gps.js';
import { useSession } from '../lib/session.jsx';
import { Avatar, Badge, Banner, Button, Card, Confirm } from '../components/ui.jsx';

export default function Lobby({ state }) {
  const nav = useNavigate();
  const { user, toast, setActiveGame } = useSession();
  const s = state.settings;
  const me = state.players.find((p) => p.id === user.id);
  const [gps, setGps] = useState(null);
  const [leave, setLeave] = useState(false);
  const [busy, setBusy] = useState('');
  const link = `${location.origin}/join/${state.code}`;

  const act = async (ev, payload, label) => { setBusy(label || ev); const r = await emit(ev, payload); setBusy(''); if (!r.ok) toast(r.error, 'warn'); return r; };
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: 'Humans: The Last Alive', text: `Join my match with code ${state.code}`, url: link }); else { await navigator.clipboard.writeText(link); toast('Invite link copied.', 'good'); } } catch { /* cancelled */ }
  };
  const check = async () => { setBusy('gps'); setGps(await askLocation()); setBusy(''); };
  const doLeave = async () => { const r = await emit('game:leave'); if (r.ok) { setActiveGame(null); nav('/'); } else toast(r.error, 'warn'); };

  const rd = state.readiness;
  const area = s.area ? (s.area.type === 'circle' ? `Circle · ${s.area.radius} m radius` : `Drawn area · ${s.area.points.length} corners`) : 'Not chosen yet';

  return (
    <main className="max-w-xl mx-auto px-4 pb-28 safe-top">
      <header className="py-3 flex items-center gap-2">
        <button onClick={() => setLeave(true)} className="size-10 grid place-items-center rounded-xl text-sage hover:bg-raised" aria-label="Leave lobby"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0"><div className="text-xs text-sage">Lobby</div><h1 className="font-display text-2xl font-bold leading-none truncate">{s.name}</h1></div>
      </header>

      <Card className="text-center">
        <div className="text-sm text-sage">Room code</div>
        <button onClick={() => { navigator.clipboard?.writeText(state.code); toast('Code copied.', 'good'); }} className="font-display text-6xl font-bold tracking-[0.2em] text-lime my-1 pl-[0.2em]" aria-label={`Room code ${state.code.split('').join(' ')}. Tap to copy`}>{state.code}</button>
        <div className="flex gap-2 justify-center mt-2"><Button size="sm" variant="ghost" icon={Share2} onClick={share}>Invite</Button><Button size="sm" variant="ghost" icon={Copy} onClick={() => { navigator.clipboard?.writeText(link); toast('Invite link copied.', 'good'); }}>Copy link</Button></div>
      </Card>

      <section className="mt-5">
        <div className="flex items-baseline justify-between mb-2"><h2 className="font-display text-2xl font-bold">Players</h2><span className="text-sage text-sm">{state.players.length} / {s.maxPlayers}</span></div>
        <div className="rounded-2xl bg-surface border border-line/70 divide-y divide-line/60">
          {state.players.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <Avatar src={p.avatar} name={p.name} size={38} />
              <div className="flex-1 min-w-0"><div className="truncate flex items-center gap-1.5">{p.name}{p.host && <Crown className="size-4 text-lime" aria-label="Host" />}{p.id === user.id && <span className="text-xs text-sage">(you)</span>}</div>
                <div className="text-xs text-sage">{p.connected ? 'connected' : 'reconnecting…'}</div></div>
              {p.ready ? <Badge tone="good">Ready</Badge> : <Badge>Not ready</Badge>}
              {state.isHost && p.id !== user.id && <button onClick={() => act('host:kick', { userId: p.id })} className="p-2 text-sage hover:text-danger" aria-label={`Remove ${p.name}`}><UserX className="size-4" /></button>}
            </div>
          ))}
        </div>
        <p className="text-xs text-sage mt-2">Roles are secret. The server assigns {s.zombieCount} zombie{s.zombieCount > 1 ? 's' : ''} at random when the host starts.</p>
      </section>

      <Card className="mt-5 space-y-2">
        <h2 className="font-display text-2xl font-bold">Location check</h2>
        <p className="text-sm text-sage">The game uses your phone's GPS while a match runs. Teammates see your position; opponents only get a rough area every {Math.round(s.revealIntervalSec / 60 * 10) / 10} min. Keep the screen on and play outdoors.</p>
        <Button variant="ghost" icon={Crosshair} busy={busy === 'gps'} onClick={check}>Test my GPS</Button>
        {gps && (gps.ok
          ? <Banner tone={gps.fix.acc <= s.maxAccuracy ? 'good' : 'warn'}>GPS works. Accuracy ±{Math.round(gps.fix.acc)} m{gps.fix.acc > s.maxAccuracy ? ` - this match needs ±${s.maxAccuracy} m or better. Move into the open.` : '.'}</Banner>
          : <Banner tone="bad">{gps.error}</Banner>)}
        {s.allowSimGps && <Banner tone="warn">Practice mode: simulated GPS is allowed in this match.</Banner>}
      </Card>

      <Card className="mt-5 space-y-1 text-sm">
        <h2 className="font-display text-2xl font-bold mb-1">Match rules</h2>
        <div className="flex justify-between"><span className="text-sage">Length</span><span>{s.durationMin} min</span></div>
        <div className="flex justify-between"><span className="text-sage">Play area</span><span className="flex items-center gap-1"><MapPin className="size-4 text-lime" />{area}</span></div>
        {s.hideSec > 0 && <div className="flex justify-between"><span className="text-sage">Zombie waiting time</span><span>{s.hideSec} s</span></div>}
        <div className="flex justify-between"><span className="text-sage">Missions needed to extract</span><span>{s.requiredMissions}</span></div>
        <div className="flex justify-between"><span className="text-sage">Infection range</span><span>~{s.infectionRange} m + QR scan</span></div>
        <div className="flex justify-between"><span className="text-sage">Safe zone</span><span>{s.shrink ? 'shrinks over time' : 'fixed'}</span></div>
      </Card>

      {state.isHost && (
        <Card className="mt-5 space-y-3 border-lime/40">
          <h2 className="font-display text-2xl font-bold flex items-center gap-2"><Crown className="size-5 text-lime" />Host controls</h2>
          <Button variant="ghost" icon={Settings2} onClick={() => nav(`/m/${state.code}/setup`)} className="w-full">Configure area, checkpoints &amp; rules</Button>
          {rd && (rd.ok ? <Banner tone="good">Everything is ready. You can start the match.</Banner> : (
            <ul className="space-y-1.5 text-sm">{rd.issues.map((i) => <li key={i} className="flex gap-2 items-start text-sage"><Circle className="size-4 mt-0.5 shrink-0" />{i}</li>)}</ul>
          ))}
          {rd?.ok && <div className="flex items-center gap-2 text-sm text-lime"><CheckCircle2 className="size-4" />All checkpoints approved · host safety confirmation recorded</div>}
          <Button size="lg" className="w-full" disabled={!rd?.ok} busy={busy === 'host:start'} onClick={() => act('host:start')}>Start match</Button>
        </Card>
      )}

      {!state.isHost && (
        <div className="fixed bottom-0 inset-x-0 p-4 safe-bottom bg-gradient-to-t from-bg via-bg to-transparent">
          <div className="max-w-xl mx-auto"><Button size="lg" variant={me?.ready ? 'ghost' : 'primary'} className="w-full" busy={busy === 'lobby:ready'} onClick={() => act('lobby:ready', { ready: !me?.ready })}>{me?.ready ? 'Ready - tap to cancel' : "I'm ready"}</Button></div>
        </div>
      )}
      <Confirm open={leave} title="Leave this lobby?" body={state.isHost ? 'Hosting passes to another player. If you are alone, the lobby closes.' : 'You can rejoin with the room code while the lobby is open.'} confirmLabel="Leave" onClose={() => setLeave(false)} onConfirm={doLeave} />
    </main>
  );
}
