import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Activity, Ban, Eye, Megaphone, Pause, Play, RefreshCw, Search, Skull, Trash2, Users, Siren, ScrollText, Gamepad2, Gauge, CircleCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { socket, emit } from '../lib/socket.js';
import { useSession } from '../lib/session.jsx';
import { fmtClock, areaCenter } from '../lib/geo.js';
import { C } from '../lib/theme.js';
import MapView from '../components/MapView.jsx';
import { CheckpointPin } from '../components/Pins.jsx';
import { Avatar, Badge, Banner, Button, Card, Confirm, Empty, Input, Sheet, Spinner, Toggle, cx } from '../components/ui.jsx';
import { ResultDetail } from './Home.jsx';

const TABS = [['overview', 'Overview', Gauge], ['live', 'Live games', Activity], ['users', 'Players', Users], ['matches', 'Match history', Gamepad2], ['reports', 'Reports', Siren], ['audit', 'Audit log', ScrollText]];

function usePoll(fn, ms, deps = []) {
  const [data, set] = useState(null); const [err, setErr] = useState('');
  const run = useCallback(async () => { try { set(await fn()); setErr(''); } catch (e) { setErr(e.message); } }, deps); // eslint-disable-line
  useEffect(() => { run(); if (!ms) return; const i = setInterval(run, ms); return () => clearInterval(i); }, [run, ms]);
  return [data, err, run];
}

export default function Admin() {
  const { user } = useSession();
  const [tab, setTab] = useState('overview');
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <div className="min-h-dvh safe-top">
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b border-line/60">
        <div className="max-w-5xl mx-auto px-3 py-2 flex items-center gap-2">
          <Link to="/" className="size-10 grid place-items-center rounded-xl text-sage hover:bg-raised" aria-label="Back to game"><ArrowLeft className="size-5" /></Link>
          <div className="flex-1"><div className="text-xs text-sage">Developer console</div><h1 className="font-display text-2xl font-bold leading-none">Operations</h1></div>
        </div>
        <nav className="max-w-5xl mx-auto px-2 flex gap-1 overflow-x-auto pb-1" aria-label="Admin sections">
          {TABS.map(([id, l, Icon]) => <button key={id} onClick={() => setTab(id)} className={cx('shrink-0 h-10 px-3 rounded-lg flex items-center gap-1.5 text-sm', tab === id ? 'bg-raised text-lime' : 'text-sage hover:text-text')}><Icon className="size-4" />{l}</button>)}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-3 py-4 pb-20">
        {tab === 'overview' && <Overview />}{tab === 'live' && <Live />}{tab === 'users' && <UsersTab />}{tab === 'matches' && <Matches />}{tab === 'reports' && <Reports />}{tab === 'audit' && <Audit />}
      </main>
    </div>
  );
}

const Stat = ({ label, value, tone }) => <Card className="py-3"><div className={cx('font-display text-4xl font-bold leading-none', tone === 'bad' ? 'text-danger' : 'text-lime')}>{value}</div><div className="text-xs text-sage mt-1">{label}</div></Card>;

function Overview() {
  const { toast } = useSession();
  const [o, err, reload] = usePoll(() => api('/admin/overview'), 5000);
  const [msg, setMsg] = useState('');
  if (!o) return err ? <Banner tone="bad">{err}</Banner> : <Spinner />;
  const send = async () => { try { await api('/admin/broadcast', { method: 'POST', body: { message: msg } }); setMsg(''); toast('Announcement sent to everyone online.', 'good'); } catch (e) { toast(e.message, 'warn'); } };
  const setApp = async (patch) => { try { await api('/admin/settings', { method: 'PATCH', body: patch }); reload(); } catch (e) { toast(e.message, 'warn'); } };
  return (
    <div className="space-y-5">
      <section><h2 className="font-display text-2xl font-bold mb-2">Right now</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat label="Rooms in memory" value={o.live.rooms} /><Stat label="Players connected" value={o.live.playersConnected} /><Stat label="Matches running" value={o.live.running + o.live.paused} /><Stat label="Open lobbies" value={o.live.lobby} /></div></section>
      <section><h2 className="font-display text-2xl font-bold mb-2">Players</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat label="Registered" value={o.users.total} /><Stat label="New (24 h)" value={o.users.new24h} /><Stat label="Active (7 d)" value={o.users.active7d} /><Stat label="Suspended" value={o.users.suspended} tone={o.users.suspended ? 'bad' : undefined} /></div></section>
      <section><h2 className="font-display text-2xl font-bold mb-2">Matches</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat label="Finished (24 h)" value={o.games.finished24h} /><Stat label="Finished total" value={o.games.finishedTotal} /><Stat label="Survivor wins" value={o.games.winners.survivors || 0} /><Stat label="Zombie wins" value={o.games.winners.zombies || 0} /></div></section>
      <section><h2 className="font-display text-2xl font-bold mb-2">System</h2>
        <Card className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 text-sm">
          {[['Database', o.system.mongo], ['Sockets', o.system.sockets], ['Uptime', `${Math.floor(o.system.uptimeSec / 3600)}h ${Math.floor((o.system.uptimeSec % 3600) / 60)}m`], ['Memory (RSS)', `${o.system.rssMB} MB`], ['Heap', `${o.system.heapMB} MB`], ['Load 1m', o.system.load], ['Node', o.system.node], ['Open reports', o.reports.open]].map(([k, v]) => <div key={k}><div className="text-sage text-xs">{k}</div><div>{v}</div></div>)}
        </Card></section>
      <section className="grid sm:grid-cols-2 gap-3">
        <Card className="space-y-3"><h2 className="font-display text-2xl font-bold">Controls</h2>
          <Toggle label="Maintenance mode" hint="Blocks creating new matches. Running matches continue." checked={o.app.maintenance} onChange={(v) => setApp({ maintenance: v })} />
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload}>Refresh</Button></Card>
        <Card className="space-y-2"><h2 className="font-display text-2xl font-bold flex items-center gap-2"><Megaphone className="size-5" />Announcement</h2>
          <Input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="Message shown to everyone online" />
          <div className="flex gap-2"><Button size="sm" disabled={!msg.trim()} onClick={send}>Broadcast now</Button><Button size="sm" variant="ghost" onClick={() => setApp({ announcement: msg })} disabled={!msg.trim()}>Pin banner</Button>{o.app.announcement && <Button size="sm" variant="quiet" onClick={() => setApp({ announcement: '' })}>Clear pinned</Button>}</div>
          {o.app.announcement && <div className="text-xs text-sage">Pinned: {o.app.announcement}</div>}</Card>
      </section>
    </div>
  );
}

function Live() {
  const { toast } = useSession();
  const [d, err, reload] = usePoll(() => api('/admin/rooms'), 3000);
  const [watch, setWatch] = useState(null);
  const [conf, setConf] = useState(null);
  const act = async (code, a) => { try { await api(`/admin/rooms/${code}/${a}`, { method: 'POST' }); reload(); } catch (e) { toast(e.message, 'warn'); } };
  if (!d) return err ? <Banner tone="bad">{err}</Banner> : <Spinner />;
  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl font-bold">Live games ({d.rooms.length})</h2>
      {d.rooms.length === 0 && <Card><Empty title="Nothing running">Matches appear here the moment a host opens a lobby.</Empty></Card>}
      {d.rooms.map((r) => (
        <Card key={r.code} className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-display text-2xl font-bold tracking-widest text-lime">{r.code}</span><Badge tone={r.status === 'running' ? 'good' : r.status === 'paused' ? 'bad' : 'neutral'}>{r.status}</Badge><span className="text-sm text-sage truncate">{r.name} · host {r.host}</span></div>
          <div className="text-sm text-sage">{r.connected}/{r.players} online (max {r.max}) · {r.survivors} survivors · {r.zombies} zombies · {r.missions} missions · {fmtClock(r.elapsedMs)} / {fmtClock(r.durationMs)}</div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="ghost" icon={Eye} onClick={() => setWatch(r.code)}>Spectate</Button>
            {(r.status === 'running') && <Button size="sm" variant="ghost" icon={Pause} onClick={() => act(r.code, 'pause')}>Pause</Button>}
            {r.status === 'paused' && <Button size="sm" variant="ghost" icon={Play} onClick={() => act(r.code, 'resume')}>Resume</Button>}
            {r.status !== 'finished' && <Button size="sm" variant="dangerGhost" onClick={() => setConf(r.code)}>Terminate</Button>}
          </div>
        </Card>
      ))}
      <Confirm open={!!conf} danger title={`Terminate ${conf}?`} body="Ends the match for every player immediately. This is logged." confirmLabel="Terminate" onClose={() => setConf(null)} onConfirm={async () => { await act(conf, 'terminate'); setConf(null); }} />
      {watch && <Spectate code={watch} onClose={() => setWatch(null)} />}
    </div>
  );
}

function Spectate({ code, onClose }) {
  const [st, setSt] = useState(null);
  const mapRef = useRef(null);
  useEffect(() => {
    const on = (s) => s.code === code && setSt(s);
    socket.on('admin:state', on); socket.on('admin:closed', onClose);
    const watch = () => emit('admin:watch', { code });
    watch(); socket.on('connect', watch);
    return () => { socket.off('admin:state', on); socket.off('admin:closed', onClose); socket.off('connect', watch); emit('admin:unwatch'); };
  }, [code]); // eslint-disable-line
  const items = st ? [
    ...st.checkpoints.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, node: <CheckpointPin cp={c} /> })),
    ...st.players.filter((p) => p.loc).map((p) => ({ id: `p${p.id}`, lat: p.loc.lat, lng: p.loc.lng, z: 5, node: <div className="flex flex-col items-center"><div className="size-4 rounded-full border-2 border-white" style={{ background: p.team === 'zombie' ? C.danger : p.team === 'survivor' ? C.lime : C.sage }} /><span className="text-[10px] px-1 rounded bg-bg/85 mt-0.5">{p.name}</span></div> })),
  ] : [];
  return (
    <Sheet open onClose={onClose} title={`Spectating ${code}`} tall>
      {!st ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap"><Badge>{st.status}</Badge><Badge tone="good">{st.counts.survivors} survivors</Badge><Badge tone="bad">{st.counts.zombies} zombies</Badge><Badge>{fmtClock(st.timer.elapsedMs)} / {fmtClock(st.timer.durationMs)}</Badge></div>
          {st.settings.area && <MapView ref={mapRef} className="h-72 rounded-xl overflow-hidden" center={areaCenter(st.settings.area)} zoom={16} fit={st.settings.area} area={st.zone?.area} zone={st.zone?.current} nextZone={st.zone?.next} items={items} />}
          <div className="divide-y divide-line/60 text-sm">{st.players.map((p) => <div key={p.id} className="py-1.5 flex items-center gap-2"><Avatar src={p.avatar} name={p.name} size={26} /><span className="flex-1 truncate">{p.name}</span><span className="text-sage">{p.origin || '-'} → {p.team || '-'} · {p.status}</span><span className="text-lime w-10 text-right">{p.score}</span>{p.flags?.sim && <Badge tone="bad">SIM</Badge>}{p.flags?.jumps > 0 && <Badge tone="bad">jumps {p.flags.jumps}</Badge>}</div>)}</div>
          <ul className="text-xs text-sage space-y-1">{[...st.events].reverse().slice(0, 12).map((e) => <li key={e.id}>{fmtClock(e.t)} · {e.msg}</li>)}</ul>
        </div>
      )}
    </Sheet>
  );
}

function UsersTab() {
  const { toast, user: me } = useSession();
  const [q, setQ] = useState(''); const [filter, setFilter] = useState(''); const [page, setPage] = useState(1);
  const [d, err, reload] = usePoll(() => api(`/admin/users?q=${encodeURIComponent(q)}&filter=${filter}&page=${page}`), 0, [q, filter, page]);
  const [detail, setDetail] = useState(null); const [del, setDel] = useState(null); const [sus, setSus] = useState(null); const [reason, setReason] = useState('');
  const open = async (u) => { try { setDetail(await api(`/admin/users/${u.id}`)); } catch (e) { toast(e.message, 'warn'); } };
  const doSuspend = async (u, v) => { try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { suspended: v, reason } }); toast(v ? 'Player suspended.' : 'Player restored.', 'good'); setSus(null); setReason(''); reload(); } catch (e) { toast(e.message, 'warn'); } };
  const doDelete = async (u) => { try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('Account deleted.', 'good'); setDel(null); reload(); } catch (e) { toast(e.message, 'warn'); } };
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><div className="relative flex-1"><Search className="size-4 absolute left-3 top-3.5 text-sage" /><Input className="pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or email" aria-label="Search players" /></div>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="h-11 rounded-xl bg-bg border border-line px-2" aria-label="Filter"><option value="">All</option><option value="suspended">Suspended</option><option value="admin">Admins</option></select></div>
      {!d ? (err ? <Banner tone="bad">{err}</Banner> : <Spinner />) : (
        <>
          <div className="text-sm text-sage">{d.total} players</div>
          <div className="rounded-2xl bg-surface border border-line/70 divide-y divide-line/60">
            {d.rows.map((u) => (
              <div key={u.id} className="p-3 flex items-center gap-3">
                <button onClick={() => open(u)} className="flex items-center gap-3 flex-1 min-w-0 text-left"><Avatar src={u.photoUrl} name={u.displayName} size={38} />
                  <div className="min-w-0"><div className="truncate flex items-center gap-1.5">{u.displayName}{u.role === 'admin' && <Badge tone="info">admin</Badge>}{u.suspended && <Badge tone="bad">suspended</Badge>}{u.inGame && <Badge tone="good">in {u.inGame}</Badge>}</div>
                    <div className="text-xs text-sage truncate">{u.email} · {u.stats.games} games · joined {new Date(u.createdAt).toLocaleDateString()}</div></div></button>
                {u.role !== 'admin' && <div className="flex gap-1">
                  <button onClick={() => (u.suspended ? doSuspend(u, false) : setSus(u))} className="p-2 text-sage hover:text-[#f2c14e]" aria-label={u.suspended ? 'Restore player' : 'Suspend player'}>{u.suspended ? <CircleCheck className="size-4" /> : <Ban className="size-4" />}</button>
                  <button onClick={() => setDel(u)} className="p-2 text-sage hover:text-danger" aria-label="Delete player"><Trash2 className="size-4" /></button></div>}
              </div>
            ))}
            {d.rows.length === 0 && <Empty title="No players found" />}
          </div>
          <div className="flex justify-between"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={page * 25 >= d.total} onClick={() => setPage(page + 1)}>Next</Button></div>
        </>
      )}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.user.displayName || ''}>
        {detail && <div className="space-y-2 text-sm"><div className="text-sage">{detail.user.email}</div>
          <div className="grid grid-cols-3 gap-2 text-center">{[['Games', detail.user.stats.games], ['Wins', detail.user.stats.wins], ['Points', detail.user.stats.points]].map(([l, v]) => <div key={l} className="rounded-xl bg-bg/60 py-2"><div className="font-display text-2xl text-lime">{v}</div><div className="text-xs text-sage">{l}</div></div>)}</div>
          <div className="text-sage">Joined {new Date(detail.user.createdAt).toLocaleString()} · last login {detail.user.lastLoginAt ? new Date(detail.user.lastLoginAt).toLocaleString() : '-'}</div>
          {detail.user.suspended && <Banner tone="bad">Suspended: {detail.user.suspendedReason || 'no reason given'}</Banner>}
          <h3 className="font-display text-xl font-bold pt-2">Recent matches</h3>{detail.games.length === 0 && <div className="text-sage">None.</div>}
          {detail.games.map((g) => <div key={g.id} className="flex justify-between"><span>{g.name} <span className="text-sage">({g.code})</span></span><span className="text-sage">{g.me?.endRole} · {g.me?.score}</span></div>)}</div>}
      </Sheet>
      <Sheet open={!!sus} onClose={() => setSus(null)} title={`Suspend ${sus?.displayName}?`}><div className="space-y-3"><p className="text-sage text-sm">They are signed out and removed from any match. They cannot sign in until restored.</p><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason (shown to the player)" /><div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setSus(null)}>Cancel</Button><Button variant="danger" onClick={() => doSuspend(sus, true)}>Suspend</Button></div></div></Sheet>
      <Confirm open={!!del} danger title={`Delete ${del?.displayName}?`} body="Permanently deletes this account and its personal data. Match history is anonymised. This cannot be undone." confirmLabel="Delete account" onClose={() => setDel(null)} onConfirm={() => doDelete(del)} />
      {me && null}
    </div>
  );
}

function Matches() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const [d, err] = usePoll(() => api(`/admin/games?q=${encodeURIComponent(q)}&page=${page}`), 0, [q, page]);
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by room code or match name" aria-label="Search matches" />
      {!d ? (err ? <Banner tone="bad">{err}</Banner> : <Spinner />) : (
        <>
          <div className="rounded-2xl bg-surface border border-line/70 divide-y divide-line/60">
            {d.rows.map((g) => <button key={g.id} onClick={() => setOpen(g)} className="w-full text-left p-3 flex items-center gap-3 hover:bg-raised"><span className="font-display text-xl tracking-wider text-lime w-20">{g.code}</span><span className="flex-1 min-w-0"><span className="block truncate">{g.name}</span><span className="block text-xs text-sage">{new Date(g.endedAt).toLocaleString()} · {g.players} players · {Math.round(g.durationSec / 60)} min</span></span><Badge tone={g.winner === 'zombies' ? 'bad' : g.winner === 'none' ? 'neutral' : 'good'}>{g.winner}</Badge></button>)}
            {d.rows.length === 0 && <Empty title="No matches yet" />}
          </div>
          <div className="flex justify-between"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={page * 25 >= d.total} onClick={() => setPage(page + 1)}>Next</Button></div>
        </>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name || ''} tall>{open && <ResultDetail id={open.id} />}</Sheet>
    </div>
  );
}

function Reports() {
  const { toast } = useSession();
  const [status, setStatus] = useState('open');
  const [d, err, reload] = usePoll(() => api(`/admin/reports?status=${status}`), 10000, [status]);
  const resolve = async (id) => { try { await api(`/admin/reports/${id}`, { method: 'PATCH' }); reload(); } catch (e) { toast(e.message, 'warn'); } };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">{['open', 'resolved', 'all'].map((s) => <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'} onClick={() => setStatus(s)}>{s}</Button>)}</div>
      {!d ? (err ? <Banner tone="bad">{err}</Banner> : <Spinner />) : d.rows.length === 0 ? <Card><Empty title="No reports">Safety and hazard reports from players show up here.</Empty></Card> : d.rows.map((r) => (
        <Card key={r.id} className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap"><Badge tone={r.kind === 'hazard' || r.kind === 'medical' ? 'bad' : 'neutral'}>{r.kind}</Badge><span className="text-sm">{r.reporterName}</span><span className="text-xs text-sage">room {r.gameCode} · {new Date(r.createdAt).toLocaleString()}</span></div>
          {r.note && <p className="text-sm">{r.note}</p>}
          {r.loc && <a className="text-xs text-lime underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${r.loc.lat}&mlon=${r.loc.lng}#map=18/${r.loc.lat}/${r.loc.lng}`}>View location on OpenStreetMap</a>}
          {r.status === 'open' ? <div><Button size="sm" variant="ghost" onClick={() => resolve(r.id)}>Mark resolved</Button></div> : <div className="text-xs text-sage">Resolved by {r.resolvedBy}</div>}
        </Card>
      ))}
    </div>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const [d, err] = usePoll(() => api(`/admin/audit?page=${page}`), 0, [page]);
  if (!d) return err ? <Banner tone="bad">{err}</Banner> : <Spinner />;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-surface border border-line/70 divide-y divide-line/60 text-sm">
        {d.rows.map((a) => <div key={a._id} className="p-3"><div><b className="text-lime">{a.action}</b> {a.target && <span>→ {a.target}</span>}</div><div className="text-xs text-sage">{a.actorEmail} · {new Date(a.at).toLocaleString()}{a.meta && Object.keys(a.meta).length ? ` · ${JSON.stringify(a.meta)}` : ''}</div></div>)}
        {d.rows.length === 0 && <Empty title="No admin actions yet" />}
      </div>
      <div className="flex justify-between"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={page * 40 >= d.total} onClick={() => setPage(page + 1)}>Next</Button></div>
    </div>
  );
}
