import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Crown, LogIn, Plus, Settings, Trophy, Skull, ShieldCheck, History, Gauge } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Avatar, Badge, Banner, Button, Card, Empty, Field, Input, Sheet, Slider, Spinner } from '../components/ui.jsx';

function Stat({ label, value }) {
  return <div className="rounded-xl bg-bg/60 border border-line/70 px-3 py-3"><div className="font-display text-3xl font-bold text-lime leading-none">{value}</div><div className="text-xs text-sage mt-1">{label}</div></div>;
}

export default function Home() {
  const { user, activeGame, setActiveGame, config, toast } = useSession();
  const nav = useNavigate();
  const { code: urlCode } = useParams();
  const [code, setCode] = useState(urlCode || '');
  const [joining, setJoining] = useState(false);
  const [host, setHost] = useState(false);
  const [games, setGames] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => { api('/me/games').then((r) => setGames(r.games)).catch(() => setGames([])); }, []);
  useEffect(() => { if (urlCode) setCode(urlCode.toUpperCase()); }, [urlCode]);

  const join = async (c = code) => {
    const cc = c.trim().toUpperCase();
    if (cc.length < 4) return toast('Enter the 6-character room code.', 'warn');
    setJoining(true);
    try { const p = await api(`/games/${cc}/preview`); if (p.status !== 'lobby' && !p.joined) throw new Error('That match has already started.'); nav(`/m/${p.code}`); }
    catch (e) { toast(e.message, 'warn'); } finally { setJoining(false); }
  };
  const s = user.stats;

  return (
    <main className="max-w-xl mx-auto px-4 pb-24 safe-top">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={user.avatar || user.photoUrl} name={user.displayName} size={44} />
          <div className="min-w-0"><div className="text-xs text-sage">Callsign</div><div className="font-display text-2xl font-bold leading-none truncate">{user.displayName}</div></div>
        </div>
        <div className="flex gap-1">
          {user.role === 'admin' && <Link to="/admin" className="size-11 grid place-items-center rounded-xl text-sage hover:text-lime hover:bg-raised" aria-label="Admin console"><Gauge className="size-5" /></Link>}
          <Link to="/settings" className="size-11 grid place-items-center rounded-xl text-sage hover:text-text hover:bg-raised" aria-label="Profile and settings"><Settings className="size-5" /></Link>
        </div>
      </header>

      {config?.maintenance && <Banner tone="warn" className="mb-3">New matches are paused for maintenance. You can still join an existing match.</Banner>}
      {activeGame && (
        <Card className="mb-4 border-lime/50 bg-brand/15">
          <div className="flex items-center justify-between gap-3">
            <div><div className="font-display text-xl font-bold">Match in progress</div><div className="text-sm text-sage">Room {activeGame}</div></div>
            <Button onClick={() => nav(`/m/${activeGame}`)}>Return</Button>
          </div>
        </Card>
      )}

      <section className="grid gap-3">
        <Card className="space-y-3">
          <h2 className="font-display text-2xl font-bold">Join a match</h2>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="ROOM CODE" aria-label="Room code" autoCapitalize="characters" autoComplete="off" className="text-center font-display text-2xl tracking-[0.3em] h-14" />
            <Button size="lg" icon={LogIn} busy={joining} onClick={() => join()}>Join</Button>
          </div>
        </Card>
        <Button variant="ghost" size="lg" icon={Plus} onClick={() => setHost(true)} disabled={config?.maintenance} className="justify-start"><span className="flex-1 text-left">Host a new match</span><Crown className="size-5 text-lime" /></Button>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-2xl font-bold mb-2">Your record</h2>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Matches" value={s.games} /><Stat label="Wins" value={s.wins} /><Stat label="Win rate" value={s.games ? `${Math.round((s.wins / s.games) * 100)}%` : '–'} />
          <Stat label="Infections" value={s.infections} /><Stat label="Missions" value={s.missions} /><Stat label="Points" value={s.points} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-2xl font-bold mb-2 flex items-center gap-2"><History className="size-5 text-sage" />Previous matches</h2>
        {games === null ? <Spinner /> : games.length === 0 ? <Card><Empty title="No matches yet">Join a room or host one to start your record.</Empty></Card> : (
          <div className="space-y-2">
            {games.map((g) => {
              const won = g.winner !== 'none' && ((g.winner === 'survivors') === (g.me?.endRole === 'survivor'));
              return (
                <button key={g.id} onClick={() => setDetail(g)} className="w-full text-left rounded-xl bg-surface border border-line/70 p-3 flex items-center gap-3 hover:bg-raised">
                  <div className={`size-10 rounded-lg grid place-items-center ${g.winner === 'none' ? 'bg-raised text-sage' : won ? 'bg-brand/25 text-lime' : 'bg-danger/15 text-danger'}`}>{g.winner === 'none' ? <ShieldCheck className="size-5" /> : won ? <Trophy className="size-5" /> : <Skull className="size-5" />}</div>
                  <div className="flex-1 min-w-0"><div className="font-medium truncate">{g.name}</div><div className="text-xs text-sage">{new Date(g.endedAt).toLocaleDateString()} · {Math.round(g.durationSec / 60)} min · {g.players} players</div></div>
                  <div className="text-right"><div className="font-display text-xl text-lime leading-none">{g.me?.score ?? 0}</div><div className="text-xs text-sage">{g.winner === 'none' ? 'ended early' : won ? 'won' : 'lost'}</div></div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <HostSheet open={host} onClose={() => setHost(false)} onDone={(c) => { setActiveGame(c); nav(`/m/${c}/setup`); }} />
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ''} tall>{detail && <ResultDetail id={detail.id} />}</Sheet>
    </main>
  );
}

export function ResultDetail({ id }) {
  const [r, setR] = useState(null);
  useEffect(() => { api(`/results/${id}`).then((x) => setR(x.result)).catch(() => setR(false)); }, [id]);
  if (r === null) return <Spinner />;
  if (!r) return <Empty title="Not available">This result could not be loaded.</Empty>;
  const w = r.winner === 'none' ? 'Match ended early' : r.winner === 'survivors' ? 'Survivors won' : 'Zombies won';
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap"><Badge tone={r.winner === 'zombies' ? 'bad' : 'good'}>{w}</Badge><Badge>{r.reason?.replace('_', ' ')}</Badge><Badge>{Math.round(r.durationSec / 60)} min</Badge><Badge>{r.missionsDone?.length || 0} missions</Badge></div>
      <div className="divide-y divide-line/60">
        {[...r.players].sort((a, b) => b.score - a.score).map((p, i) => (
          <div key={i} className="py-2 flex items-center gap-3"><Avatar src={p.avatar} name={p.name} size={32} /><div className="flex-1 min-w-0"><div className="truncate">{p.name}</div><div className="text-xs text-sage">{p.startRole} → {p.endRole} · {p.status.toLowerCase()}</div></div><div className="font-display text-xl text-lime">{p.score}</div></div>
        ))}
      </div>
    </div>
  );
}

function HostSheet({ open, onClose, onDone }) {
  const { toast } = useSession();
  const [s, setS] = useState({ name: 'Operation Outbreak', maxPlayers: 10, zombieCount: 2, durationMin: 30 });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const go = async () => {
    setBusy(true);
    try { const r = await api('/games', { method: 'POST', body: { settings: s } }); onDone(r.code); }
    catch (e) { toast(e.message, 'warn'); if (e.data?.activeGame) onDone(e.data.activeGame); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Host a match" tall>
      <div className="space-y-2">
        <Field label="Match name"><Input value={s.name} onChange={(e) => set('name', e.target.value)} maxLength={40} /></Field>
        <Slider label="Max players" value={s.maxPlayers} min={2} max={30} onChange={(v) => setS((x) => ({ ...x, maxPlayers: v, zombieCount: Math.min(x.zombieCount, Math.max(1, v - 1)) }))} />
        <Slider label="Starting zombies" value={s.zombieCount} min={1} max={Math.min(8, s.maxPlayers - 1)} onChange={(v) => set('zombieCount', v)} hint="Suggested: 1 per 5 players. Roles are assigned randomly when the match starts." />
        <Slider label="Match length" value={s.durationMin} min={5} max={90} step={5} unit=" min" onChange={(v) => set('durationMin', v)} />
        <p className="text-sm text-sage">Next you will choose the play area on the map, place checkpoints and set the rules.</p>
        <Button className="w-full" size="lg" busy={busy} onClick={go}>Create lobby</Button>
      </div>
    </Sheet>
  );
}
