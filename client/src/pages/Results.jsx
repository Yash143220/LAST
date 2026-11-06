import { Link } from 'react-router-dom';
import { Trophy, Skull, ShieldCheck, Clock, Target, Home } from 'lucide-react';
import { fmtClock } from '../lib/geo.js';
import { MISSION_NAMES } from '../lib/theme.js';
import { Avatar, Badge, Button, Card, cx } from '../components/ui.jsx';

const REASON = { extraction: 'Enough survivors escaped through extraction.', time: 'Enough survivors escaped or survived until time ran out.', all_infected: 'Every survivor was infected.', too_few: 'Too few survivors escaped or survived.', aborted: 'The match was ended early.', abandoned: 'The match was abandoned.' };
const OUT = { ESCAPED: 'escaped', SURVIVED: 'survived', TURNED: 'turned zombie', ZOMBIE: 'zombie', OUT: 'out (signal lost)', LEFT: 'left' };

export default function Results({ state }) {
  const me = state.me;
  const win = state.winner;
  const players = [...state.result.players].sort((a, b) => b.score - a.score);
  const mine = players.find((p) => p.userId === me?.id);
  const youWon = win !== 'none' && !!mine?.won;
  const mvp = players[0]?.score > 0 ? players[0] : null;
  const head = win === 'none' ? 'Match ended' : win === 'survivors' ? 'Survivors win' : 'Zombies win';

  return (
    <main className="max-w-xl mx-auto px-4 pb-16 safe-top">
      <section className={cx('rounded-3xl p-6 mt-4 border', win === 'zombies' ? 'bg-[#2a1210] border-danger/60' : 'bg-brand/20 border-brand')}>
        <div className="flex items-center gap-2 text-sm text-sage">{win === 'zombies' ? <Skull className="size-4 text-danger" /> : <ShieldCheck className="size-4 text-lime" />}{state.name}</div>
        <h1 className={cx('reveal font-display font-bold text-6xl leading-none mt-2', win === 'zombies' ? 'text-danger' : 'text-lime')}>{head}</h1>
        <p className="mt-3 text-text/90">{REASON[state.reason] || ''}</p>
        {win !== 'none' && mine && <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-bg/60 px-3 py-2"><Trophy className={cx('size-5', youWon ? 'text-lime' : 'text-sage')} /><span>{youWon ? 'You are on the winning side' : mine?.outcome === 'ESCAPED' || mine?.outcome === 'SURVIVED' ? 'You made it, but your team fell short' : 'Your team lost'}</span></div>}
      </section>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <Card className="text-center py-3"><Clock className="size-4 mx-auto text-sage" /><div className="font-display text-2xl font-bold">{fmtClock(state.result.durationSec * 1000)}</div><div className="text-xs text-sage">duration</div></Card>
        <Card className="text-center py-3"><Target className="size-4 mx-auto text-sage" /><div className="font-display text-2xl font-bold">{state.result.missionsDone.length}</div><div className="text-xs text-sage">missions done</div></Card>
        <Card className="text-center py-3"><div className="font-display text-2xl font-bold text-lime">{mine?.score ?? 0}</div><div className="text-xs text-sage">your points</div></Card>
      </div>

      {state.result.missionsDone.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{state.result.missionsDone.map((m) => <Badge key={m} tone="good">{MISSION_NAMES[m]}</Badge>)}</div>}

      <h2 className="font-display text-2xl font-bold mt-6 mb-2">Final standings</h2>
      <div className="rounded-2xl bg-surface border border-line/70 divide-y divide-line/60">
        {players.map((p, i) => (
          <div key={p.userId || i} className={cx('flex items-center gap-3 p-3', p.userId === me?.id && 'bg-raised/60')}>
            <span className="font-display text-xl text-sage w-5 text-center">{i + 1}</span>
            <Avatar src={p.avatar} name={p.name} size={36} />
            <div className="flex-1 min-w-0"><div className="truncate flex items-center gap-1.5">{p.name}{mvp && p.userId === mvp.userId && <Badge tone="good">MVP</Badge>}</div><div className="text-xs text-sage">{p.startRole}{p.startRole !== p.endRole ? ` → ${p.endRole}` : ''} · {OUT[p.outcome] || p.status.toLowerCase()}{p.bonus ? ` · +${p.bonus} bonus` : ''}{p.missions ? ` · ${p.missions} mission${p.missions > 1 ? 's' : ''}` : ''}{p.infections ? ` · ${p.infections} infection${p.infections > 1 ? 's' : ''}` : ''}{p.extracted ? ' · extracted' : ''}</div></div>
            <div className="font-display text-2xl text-lime">{p.score}</div>
          </div>
        ))}
      </div>

      <h2 className="font-display text-2xl font-bold mt-6 mb-2">Timeline</h2>
      <ul className="space-y-1.5 text-sm">{state.events.filter((e) => e.type !== 'reveal').slice(-14).map((e) => <li key={e.id} className="flex gap-2"><span className="text-sage tabular-nums w-10 shrink-0">{fmtClock(e.t)}</span><span>{e.msg}</span></li>)}</ul>
      <Link to="/" className="block mt-8"><Button size="lg" className="w-full" icon={Home}>Back to base</Button></Link>
    </main>
  );
}
