import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Map as MapIcon, Target, Package, ScanLine, Users, Menu as MenuIcon, Skull, ShieldCheck, Crosshair, Pause, Play, LogOut, Siren, ChevronUp, ChevronDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Check, Lock, Flag, CameraOff } from 'lucide-react';
import { emit } from '../lib/socket.js';
import { useSession, useTicker } from '../lib/session.jsx';
import { useGps, useWakeLock, askLocation } from '../lib/gps.js';
import { haversine, inShape, fmtDist, fmtClock, areaCenter } from '../lib/geo.js';
import { C, ITEMS, MISSION_NAMES, MISSION_POINTS } from '../lib/theme.js';
import MapView from '../components/MapView.jsx';
import Scanner from '../components/QrScanner.jsx';
import { CheckpointPin, MePin, MatePin, MissionIcon } from '../components/Pins.jsx';
import { Avatar, Badge, Banner, Button, Card, Confirm, Field, Input, Progress, Sheet, cx } from '../components/ui.jsx';

const TABS = [['map', 'Map', MapIcon], ['missions', 'Objectives', Target], ['supplies', 'Supplies', Package], ['infect', 'Infect', ScanLine], ['team', 'Team', Users], ['menu', 'Menu', MenuIcon]];

export default function Game({ state, offset, incoming, clearIncoming }) {
  const nav = useNavigate();
  const { toast, setActiveGame } = useSession();
  useTicker(250);
  const s = state.settings, me = state.me;
  const mapRef = useRef(null);
  const [tab, setTab] = useState('map');
  const [sim, setSim] = useState(false);
  const [simPos, setSimPos] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [report, setReport] = useState(false);
  const [leave, setLeave] = useState(false);
  const gps = useGps(!sim);
  useWakeLock(true);

  const age = Date.now() - (state.serverNow - offset);
  const running = state.status === 'running';
  const elapsed = running ? state.timer.elapsedMs + age : state.timer.elapsedMs;
  const left = Math.max(0, state.timer.durationMs - elapsed);
  const isSurv = me.team === 'survivor', isZomb = me.team === 'zombie', alive = me.status === 'ALIVE' || me.status === 'INFECTED';

  // position: real GPS or simulated
  const startPos = useMemo(() => areaCenter(s.area), [s.area]);
  const fix = sim ? (simPos ? { ...simPos, acc: 5, at: Date.now(), sim: true } : null) : gps.fix;
  const pos = fix || (me.loc ? { lat: me.loc.lat, lng: me.loc.lng, acc: me.loc.acc } : null);
  const fixRef = useRef(fix); fixRef.current = fix;
  useEffect(() => {
    const send = () => { const f = fixRef.current; if (!f || Date.now() - f.at > 30000) return; emit('loc:update', { lat: f.lat, lng: f.lng, acc: f.acc, sim: !!f.sim }).then((r) => { if (!r.ok && r.code === 'SIM_DISABLED') setSim(false); }); };
    send(); const i = setInterval(send, 2000); return () => clearInterval(i);
  }, [state.code]);
  useEffect(() => { if (sim && !simPos) setSimPos(gps.fix || pos || startPos); }, [sim]); // eslint-disable-line

  // incoming infection QR -> jump to the QR tab
  const qrLeft = incoming ? incoming.expiresAt - (Date.now() + incoming.offset) : 0;
  useEffect(() => { if (incoming) { setTab('infect'); navigator.vibrate?.([200, 100, 200]); } }, [incoming]);
  useEffect(() => { if (incoming && qrLeft <= 0) clearIncoming(); });
  useEffect(() => { if (me.status === 'INFECTED') clearIncoming(); }, [me.status]); // eslint-disable-line

  const dist = (p) => (pos ? haversine(pos, p) : null);
  const inRange = (cp) => pos && haversine(pos, cp) <= cp.radius + Math.min((pos.acc || 0) / 2, 10);
  const zoneNow = state.zone?.current;
  const insideZone = pos && zoneNow ? inShape(zoneNow, pos) : true;
  const graceLeft = me.graceLeftMs != null ? Math.max(0, me.graceLeftMs - (running ? age : 0)) : null;
  const gpsBad = pos && pos.acc > s.maxAccuracy;
  const nextIn = state.zone?.nextInMs != null ? Math.max(0, state.zone.nextInMs - (running ? age : 0)) : null;

  const done = new Set(state.missions.list.filter((m) => m.done).map((m) => m.type));
  const hintColor = isZomb ? C.lime : C.danger;
  const items = [
    ...state.checkpoints.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, z: 2, node: <CheckpointPin cp={c} done={c.kind === 'mission' && done.has(c.missionType)} />, onClick: () => setTab('missions') })),
    ...state.team.map((t) => ({ id: `t${t.id}`, lat: t.lat, lng: t.lng, z: 3, node: <MatePin name={t.name} team={me.team} /> })),
    ...(pos ? [{ id: 'me', lat: pos.lat, lng: pos.lng, z: 6, node: <MePin team={me.team} acc={pos.acc} /> }] : []),
  ];
  const hints = [...state.hints.list.map((h) => ({ ...h, color: hintColor })), ...(me.radar?.list || []).map((h) => ({ ...h, color: C.info }))];

  const move = (dx, dy) => setSimPos((p) => p && ({ lat: p.lat + (dy * 4) / 110540, lng: p.lng + (dx * 4) / (111320 * Math.cos((p.lat * Math.PI) / 180)) }));
  const doLeave = async () => { const r = await emit('game:leave'); if (r.ok) { setActiveGame(null); nav('/'); } else toast(r.error, 'warn'); };

  const showReveal = state.status === 'countdown' || (!revealed && elapsed < 6000 && running);
  const cdLeft = Math.max(0, state.timer.countdownEndsAt - (Date.now() + offset));

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      <MapView ref={mapRef} className="flex-1" center={pos || startPos} zoom={17} area={state.zone.area} zone={state.zone.current} nextZone={state.zone.next} hints={hints} items={items} onClick={sim ? (p) => setSimPos(p) : undefined} />

      {/* HUD */}
      <div className="absolute top-0 inset-x-0 safe-top p-2 pointer-events-none">
        <div className="flex items-stretch gap-2 pointer-events-auto">
          <div className={cx('rounded-xl px-3 py-1.5 border flex flex-col justify-center', isZomb ? 'bg-danger/20 border-danger/60 text-danger' : 'bg-brand/25 border-brand text-lime')}>
            <span className="text-[11px] leading-none opacity-80">{me.status === 'INFECTED' ? 'Infected' : me.status === 'OUT' ? 'Out' : 'You are'}</span>
            <span className="font-display text-xl font-bold leading-tight flex items-center gap-1">{isZomb ? <Skull className="size-4" /> : <ShieldCheck className="size-4" />}{isZomb ? 'Zombie' : 'Survivor'}</span>
          </div>
          <div className="flex-1 rounded-xl bg-bg/90 border border-line px-3 py-1.5 text-center">
            <div className="font-display text-3xl font-bold leading-none tabular-nums">{fmtClock(left)}</div>
            <div className="text-[11px] text-sage leading-tight">{state.timer.paused ? 'PAUSED' : state.timer.extractionOpen ? 'Extraction open' : nextIn != null ? `Zone shrinks in ${fmtClock(nextIn)}` : 'Final zone'}</div>
          </div>
          <div className="rounded-xl bg-bg/90 border border-line px-3 py-1.5 text-right text-xs leading-tight flex flex-col justify-center">
            <span className="text-lime">{state.counts.survivors} survivors</span><span className="text-danger">{state.counts.zombies} zombies</span>
          </div>
        </div>
        <div className="mt-2 space-y-1.5 max-w-md pointer-events-auto">
          {graceLeft != null && alive && <div className="rounded-xl bg-danger text-bg px-3 py-2 font-semibold flex items-center gap-2"><Siren className="size-5" />Outside the safe zone. Return within {Math.ceil(graceLeft / 1000)} s{s.zonePenalty === 'infect' && isSurv ? ' or you are infected' : ''}.</div>}
          {graceLeft == null && !insideZone && alive && <div className="rounded-xl bg-danger/90 text-bg px-3 py-1.5 text-sm font-semibold">You are outside the safe zone (waiting for a clear GPS fix).</div>}
          {me.jumpy && <Banner tone="warn">GPS jumped. Actions pause for a few seconds.</Banner>}
          {!sim && gps.perm === 'denied' && <Banner tone="bad">Location is blocked. Enable location for this site in your browser settings to play.</Banner>}
          {!sim && gps.perm === 'unknown' && <Banner tone="info">Waiting for GPS… keep this screen open outdoors.</Banner>}
          {gpsBad && <Banner tone="warn">GPS accuracy ±{Math.round(pos.acc)} m. Needs ±{s.maxAccuracy} m to complete objectives. Move into the open.</Banner>}
          {me.status === 'INFECTED' && <Banner tone="bad">You were infected. You are now a zombie: hunt the remaining survivors.</Banner>}
          {me.status === 'OUT' && <Banner tone="bad">You were removed from the match (signal lost).</Banner>}
          {sim && <Banner tone="warn">SIMULATED GPS · tap the map or use the pad to move</Banner>}
        </div>
      </div>

      <button onClick={() => pos && mapRef.current?.flyTo(pos, 17.5)} className="absolute right-3 top-[40%] size-11 rounded-xl grid place-items-center bg-surface/95 border border-line shadow" aria-label="Centre on me"><Crosshair className="size-5" /></button>

      {sim && (
        <div className="absolute left-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] grid grid-cols-3 gap-1 w-36 z-10">
          {[[null], [ArrowUp, 0, 1], [null], [ArrowLeft, -1, 0], [null], [ArrowRight, 1, 0], [null], [ArrowDown, 0, -1], [null]].map((b, i) => b[0]
            ? <HoldBtn key={i} Icon={b[0]} onStep={() => move(b[1], b[2])} /> : <span key={i} />)}
        </div>
      )}

      {/* panel */}
      {tab !== 'map' && (
        <section className="sheet-in absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] max-h-[58dvh] bg-surface/98 backdrop-blur border-t border-line rounded-t-3xl flex flex-col" aria-label={tab}>
          <button onClick={() => setTab('map')} className="mx-auto mt-1.5 mb-0.5 text-sage" aria-label="Collapse panel"><ChevronDown className="size-6" /></button>
          <div className="scroll-y px-4 pb-4 space-y-3">
            {tab === 'missions' && <Objectives {...{ state, me, isSurv, inRange, dist, toast, age: running ? age : 0 }} />}
            {tab === 'supplies' && <Supplies {...{ state, me, isSurv, inRange, dist, toast }} />}
            {tab === 'infect' && <Infect {...{ state, me, isZomb, isSurv, incoming, qrLeft, clearIncoming, toast, offset }} />}
            {tab === 'team' && <Team {...{ state, me, pos }} />}
            {tab === 'menu' && <MenuPanel {...{ state, sim, setSim, setReport, setLeave, toast }} />}
          </div>
        </section>
      )}

      <nav className="relative z-20 bg-bg border-t border-line safe-bottom grid grid-cols-6" aria-label="Game sections">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(tab === id ? 'map' : id)} aria-current={tab === id} className={cx('relative py-2 flex flex-col items-center gap-0.5 text-[11px]', tab === id ? 'text-lime' : 'text-sage')}>
            <Icon className="size-5" />{label}
            {id === 'infect' && incoming && <span className="absolute top-1.5 right-[28%] size-2.5 rounded-full bg-danger" />}
          </button>
        ))}
      </nav>

      {showReveal && <RoleReveal me={me} s={s} cdLeft={cdLeft} counting={state.status === 'countdown'} onClose={() => setRevealed(true)} />}
      {state.status === 'paused' && (
        <div className="absolute inset-0 z-30 bg-bg/85 grid place-items-center p-6 text-center"><div><Pause className="size-12 text-lime mx-auto mb-2" /><h2 className="font-display text-4xl font-bold">Match paused</h2><p className="text-sage my-2">Stop where you are and stay safe. {state.events.at(-1)?.msg}</p>
          {state.isHost && <Button size="lg" icon={Play} onClick={async () => { const r = await emit('host:resume'); if (!r.ok) toast(r.error, 'warn'); }}>Resume match</Button>}
          <div className="mt-3"><Button variant="ghost" onClick={() => setLeave(true)}>Leave match</Button></div></div></div>
      )}
      <ReportSheet open={report} onClose={() => setReport(false)} toast={toast} />
      <Confirm open={leave} danger title="Leave the match?" body="You cannot rejoin once you leave. Your team continues without you." confirmLabel="Leave match" onClose={() => setLeave(false)} onConfirm={doLeave} />
    </div>
  );
}

function HoldBtn({ Icon, onStep }) {
  const t = useRef(null);
  const stop = () => { clearInterval(t.current); t.current = null; };
  const go = (e) => { e.preventDefault(); onStep(); stop(); t.current = setInterval(onStep, 400); };
  useEffect(() => stop, []);
  return <button onPointerDown={go} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} className="size-11 rounded-xl bg-surface/95 border border-line grid place-items-center active:bg-raised touch-none" aria-label="Move"><Icon className="size-5" /></button>;
}

function RoleReveal({ me, s, cdLeft, counting, onClose }) {
  const z = me.team === 'zombie';
  return (
    <div className={cx('absolute inset-0 z-40 flex flex-col justify-center p-8 safe-top', z ? 'bg-[#2a1210]' : 'bg-bg')}>
      <div className="text-sage text-lg">Your role</div>
      <h1 className={cx('reveal font-display font-bold text-[22vw] sm:text-9xl leading-[0.9]', z ? 'text-danger' : 'text-lime')}>{z ? 'Zombie' : 'Survivor'}</h1>
      <p className="mt-5 text-lg text-text/90 max-w-md">{z
        ? `Hunt the survivors. Every ${Math.round(s.revealIntervalSec / 60 * 10) / 10} min you get a rough area for each one. Get within ~${s.infectionRange} m, tap Infect, then scan the QR on their screen. Walk, never run.`
        : `Complete ${s.requiredMissions} missions at the outdoor checkpoints, then reach extraction in the last ${s.extractionWindowMin} min, or survive until time runs out. If a zombie asks, show your QR code.`}</p>
      <p className="mt-3 text-sm text-sage">Stay outdoors on public pedestrian ground. Never enter buildings, roads or railways.</p>
      <div className="mt-8">{counting ? <div className="font-display text-7xl font-bold tabular-nums">{Math.ceil(cdLeft / 1000)}</div> : <Button size="lg" variant={z ? 'danger' : 'primary'} onClick={onClose}>Go</Button>}</div>
    </div>
  );
}

function Objectives({ state, me, isSurv, inRange, dist, toast, age }) {
  const s = state.settings;
  const nearest = (list) => list.map((c) => ({ c, d: dist(c) })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9))[0];
  const act = async (cp) => { const r = await emit('activity:start', { cpId: cp.id }); if (!r.ok) toast(r.error, 'warn'); };
  const a = me.activity;
  const ex = nearest(state.checkpoints.filter((c) => c.kind === 'extraction'));
  const need = Math.max(0, state.missions.required - state.missions.done);
  return (
    <>
      <div className="flex items-baseline justify-between"><h2 className="font-display text-2xl font-bold">Objectives</h2><span className="text-sm text-sage">{state.missions.done}/{state.missions.required} needed</span></div>
      {a && <Card className="border-lime/60 space-y-2"><div className="font-medium">{a.kind === 'mission' ? 'Working on objective' : 'Extracting'}…</div><Progress value={(a.progressMs + age) / a.holdMs} /><div className="text-xs text-sage">Stay inside the checkpoint radius. Leaving cancels progress.</div><Button size="sm" variant="ghost" onClick={() => emit('activity:cancel')}>Cancel</Button></Card>}
      {!isSurv && <Banner tone="info">Survivors complete these to unlock extraction. As a zombie, watch these locations: survivors must visit them.</Banner>}
      <div className="space-y-2">
        {state.missions.list.map((m) => {
          const n = nearest(state.checkpoints.filter((c) => c.kind === 'mission' && c.missionType === m.type));
          const can = isSurv && !m.done && !a && n && inRange(n.c) && me.status === 'ALIVE';
          return (
            <div key={m.type} className="rounded-xl border border-line/70 bg-bg/50 p-3 flex items-center gap-3">
              <span className={cx('size-10 rounded-full grid place-items-center', m.done ? 'bg-brand/30 text-lime' : 'bg-raised text-lime')}>{m.done ? <Check className="size-5" /> : <MissionIcon type={m.type} className="size-5" />}</span>
              <div className="flex-1 min-w-0"><div className="font-medium">{m.name} <span className="text-lime text-sm">+{m.points}</span></div>
                <div className="text-xs text-sage">{m.done ? `Done by ${m.by}` : n ? `${n.c.name} · ${n.d != null ? fmtDist(n.d) : 'locating…'}${n.c.description ? ` · ${n.c.description}` : ''}` : m.text}</div></div>
              {can && <Button size="sm" onClick={() => act(n.c)}>Start</Button>}
            </div>
          );
        })}
      </div>
      <div className="rounded-xl border border-info/40 bg-info/10 p-3 flex items-center gap-3">
        <span className="size-10 rounded-full grid place-items-center bg-raised text-info">{need > 0 || !state.timer.extractionOpen ? <Lock className="size-5" /> : <Flag className="size-5" />}</span>
        <div className="flex-1 min-w-0"><div className="font-medium">Extraction</div>
          <div className="text-xs text-sage">{need > 0 ? `Complete ${need} more mission${need > 1 ? 's' : ''} first.` : !state.timer.extractionOpen ? `Opens in ${fmtClock(state.timer.extractionOpensInMs)}.` : ex ? `Go to ${ex.c.name} · ${ex.d != null ? fmtDist(ex.d) : '…'}. Hold for ${s.extractionHoldSec}s to win.` : 'No extraction point.'}</div></div>
        {isSurv && ex && need === 0 && state.timer.extractionOpen && !a && inRange(ex.c) && me.status === 'ALIVE' && <Button size="sm" onClick={() => act(ex.c)}>Extract</Button>}
      </div>
    </>
  );
}

function Supplies({ state, me, isSurv, inRange, dist, toast }) {
  const sup = state.checkpoints.filter((c) => c.kind === 'supply');
  const here = sup.find(inRange);
  const buy = async (item) => { const r = await emit('supply:buy', { cpId: here.id, item }); if (!r.ok) toast(r.error, 'warn'); else toast(`${ITEMS[item].name} added.`, 'good'); };
  const use = async (item) => { const r = await emit('item:use', { item }); if (!r.ok) toast(r.error, 'warn'); };
  const cd = here ? me.supplyCd[here.id] : 0;
  return (
    <>
      <div className="flex items-baseline justify-between"><h2 className="font-display text-2xl font-bold">Supplies</h2><span className="text-sm">Credits <b className="text-lime text-lg font-display">{me.credits}</b></span></div>
      {!isSurv && <Banner tone="info">Only survivors can collect supplies.</Banner>}
      <div className="text-sm text-sage">{here ? <span className="text-lime">You are at {here.name}. {cd > 0 ? `Cooling down ${Math.ceil(cd / 1000)}s.` : 'You can collect now.'}</span> : sup.length ? `Nearest supply: ${fmtDist(Math.min(...sup.map((c) => dist(c) ?? 1e9)))} away. Walk inside its radius to collect.` : 'No supply points in this match.'}</div>
      <div className="grid gap-2">
        {Object.entries(ITEMS).map(([k, it]) => (
          <div key={k} className="rounded-xl border border-line/70 bg-bg/50 p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="font-medium">{it.name} <span className="text-sage text-sm">· {it.cost} cr</span></div><div className="text-xs text-sage">{it.text}</div><div className="text-xs text-sage mt-0.5">Owned {me.inventory[k]} · bought {me.bought[k]}/{it.limit}</div></div>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="ghost" disabled={!isSurv || !here || cd > 0 || me.credits < it.cost || me.bought[k] >= it.limit || me.status !== 'ALIVE'} onClick={() => buy(k)}>Collect</Button>
              {k !== 'medkit' && <Button size="sm" disabled={!me.inventory[k] || !isSurv || me.status !== 'ALIVE'} onClick={() => use(k)}>Use</Button>}
            </div>
          </div>
        ))}
      </div>
      {me.shieldLeftMs > 0 && <Badge tone="good">Shield active {Math.ceil(me.shieldLeftMs / 1000)}s</Badge>}{me.energyLeftMs > 0 && <Badge tone="info">Energy active {Math.ceil(me.energyLeftMs / 1000)}s</Badge>}
    </>
  );
}

function Infect({ state, me, isZomb, isSurv, incoming, qrLeft, toast }) {
  const s = state.settings;
  const [phase, setPhase] = useState('idle');   // idle | scanning
  const [msg, setMsg] = useState(null);
  const [manual, setManual] = useState('');
  const [camErr, setCamErr] = useState('');
  const [exp, setExp] = useState(0);
  const busy = useRef(false);
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((n) => n + 1), 500); return () => clearInterval(i); }, []);

  const request = async () => {
    setMsg(null); const r = await emit('infect:request');
    if (!r.ok) return setMsg({ tone: 'warn', text: r.error });
    setExp(r.expiresAt - r.serverNow + Date.now()); setPhase('scanning'); setCamErr('');
  };
  const confirm = async (token) => {
    if (busy.current) return; busy.current = true;
    const r = await emit('infect:confirm', { token });
    busy.current = false;
    if (r.ok) { setPhase('idle'); setMsg(r.resisted ? { tone: 'warn', text: 'The survivor resisted with an antidote. The scan is used up.' } : { tone: 'good', text: `${r.name} is infected! +100` }); }
    else { setMsg({ tone: 'bad', text: r.error }); if (r.code !== 'INVALID') setPhase('idle'); }
  };
  useEffect(() => { if (phase === 'scanning' && Date.now() > exp) { setPhase('idle'); setMsg({ tone: 'warn', text: 'The attempt timed out. Get close and try again.' }); } });

  if (isSurv && me.status === 'ALIVE') {
    return (
      <>
        <h2 className="font-display text-2xl font-bold">Zombie contact</h2>
        {incoming && qrLeft > 0 ? (
          <Card className="text-center space-y-3 border-danger/60">
            <div className="text-danger font-semibold">A zombie is within range and asked to scan you.</div>
            <div className="mx-auto bg-white p-3 rounded-2xl w-fit"><QRCodeSVG value={incoming.qr} size={216} bgColor="#FFFFFF" fgColor="#0E231E" level="M" /></div>
            <div className="text-sm text-sage">Or tell them this code</div>
            <div className="font-display text-5xl font-bold tracking-[0.25em] pl-[0.25em] text-lime">{incoming.code}</div>
            <div className="text-sm">Expires in <b>{Math.ceil(qrLeft / 1000)}s</b>. One use only.</div>
            <p className="text-xs text-sage">Not ready to be tagged? Use a Shield from Supplies or move away. The code expires by itself.</p>
          </Card>
        ) : <Banner tone="info">Nothing yet. If a zombie gets within about {s.infectionRange} m and tries to infect you, a one-time QR code appears here.</Banner>}
        {me.shieldLeftMs > 0 && <Badge tone="good">Shield active {Math.ceil(me.shieldLeftMs / 1000)}s</Badge>}
      </>
    );
  }
  if (isZomb && me.status !== 'OUT') {
    return (
      <>
        <h2 className="font-display text-2xl font-bold">Infect</h2>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        {phase === 'idle' ? (
          <Card className="space-y-3">
            <p className="text-sm text-sage">Get within about {s.infectionRange} m of a survivor, then tap below. The server checks both GPS positions. If you are close enough, the survivor's screen shows a QR code for {s.qrTtlSec} seconds. Scan it. No touching, no chasing.</p>
            <Button size="lg" variant="danger" className="w-full" icon={ScanLine} onClick={request}>Initiate infection</Button>
          </Card>
        ) : (
          <Card className="space-y-3">
            <div className="flex justify-between text-sm"><span>Scan the survivor's QR code</span><b className="text-danger">{Math.max(0, Math.ceil((exp - Date.now()) / 1000))}s</b></div>
            {camErr ? <Banner tone="warn"><CameraOff className="size-4 inline mr-1" />Camera unavailable ({camErr}). Ask the survivor for their 6-digit code instead.</Banner> : <Scanner onResult={confirm} onError={setCamErr} />}
            <div className="flex gap-2"><Input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} aria-label="Manual code" /><Button variant="ghost" disabled={manual.length !== 6} onClick={() => confirm(manual)}>Confirm</Button></div>
          </Card>
        )}
      </>
    );
  }
  return <Banner tone="info">Infection is only available to zombies. You are not in play.</Banner>;
}

function Team({ state, me, pos }) {
  const allies = state.players.filter((p) => p.team && p.team === me.team && p.id !== me.id);
  const tmap = new Map(state.team.map((t) => [t.id, t]));
  return (
    <>
      <h2 className="font-display text-2xl font-bold">Team &amp; intel</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Survivors', state.counts.survivors, 'text-lime'], ['Zombies', state.counts.zombies, 'text-danger'], ['Infected', state.counts.infected, 'text-sage']].map(([l, v, c]) => <div key={l} className="rounded-xl bg-bg/60 border border-line/70 py-2"><div className={cx('font-display text-3xl font-bold', c)}>{v}</div><div className="text-xs text-sage">{l}</div></div>)}
      </div>
      <div className="text-sm text-sage">Next location scan in <b className="text-text">{fmtClock(state.hints.nextInMs)}</b>. Dashed circles show a rough area only.</div>
      {allies.length > 0 ? (
        <div className="rounded-xl border border-line/70 divide-y divide-line/60">{allies.map((p) => { const t = tmap.get(p.id); return (
          <div key={p.id} className="flex items-center gap-3 p-2.5"><Avatar src={p.avatar} name={p.name} size={32} /><span className="flex-1 truncate">{p.name}</span><span className="text-xs text-sage">{p.state !== 'ALIVE' ? p.state.toLowerCase() : t && pos ? fmtDist(haversine(pos, t)) : p.connected ? 'no fix' : 'offline'}</span></div>); })}</div>
      ) : <p className="text-sm text-sage">{me.team === 'survivor' && !state.settings.survivorsKnowTeam ? 'Teammate identities are hidden in this match.' : 'No teammates in view.'}</p>}
      <h3 className="font-display text-xl font-bold pt-1">Activity</h3>
      <ul className="space-y-1.5 text-sm">{[...state.events].reverse().slice(0, 14).map((e) => <li key={e.id} className="flex gap-2"><span className="text-sage tabular-nums w-10 shrink-0">{fmtClock(e.t)}</span><span className={cx(e.type === 'infect' && 'text-danger', e.type === 'mission' && 'text-lime')}>{e.msg}</span></li>)}</ul>
    </>
  );
}

function MenuPanel({ state, sim, setSim, setReport, setLeave, toast }) {
  const s = state.settings;
  const host = async (ev) => { const r = await emit(ev); if (!r.ok) toast(r.error, 'warn'); };
  return (
    <>
      <h2 className="font-display text-2xl font-bold">Menu</h2>
      <Button variant="dangerGhost" icon={Siren} className="w-full" onClick={() => setReport(true)}>Report a hazard / safety pause</Button>
      {s.allowSimGps && <Card className="space-y-2"><div className="font-medium">Simulated GPS (practice)</div><p className="text-xs text-sage">Move without walking. Allowed because the host enabled practice mode.</p><Button variant={sim ? 'primary' : 'ghost'} size="sm" onClick={() => setSim(!sim)}>{sim ? 'Using simulated GPS - tap to use real GPS' : 'Switch to simulated GPS'}</Button></Card>}
      {state.isHost && <Card className="space-y-2 border-lime/40"><div className="font-medium">Host controls</div><div className="flex gap-2"><Button size="sm" variant="ghost" icon={Pause} onClick={() => host('host:pause')}>Emergency pause</Button><Button size="sm" variant="dangerGhost" onClick={async () => { if (confirm('End the match for everyone now?')) host('host:terminate'); }}>End match</Button></div></Card>}
      <Card className="text-sm text-sage space-y-1"><div className="font-medium text-text">Reminders</div><div>Walk, never run. Stay outdoors on public pedestrian ground. No buildings, roads or railways. Look up from your phone.</div></Card>
      <Button variant="ghost" icon={LogOut} className="w-full" onClick={() => setLeave(true)}>Leave match</Button>
    </>
  );
}

function ReportSheet({ open, onClose, toast }) {
  const [kind, setKind] = useState('hazard'); const [note, setNote] = useState(''); const [pause, setPause] = useState(true); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); const r = await emit('report:hazard', { kind, note, pause }); setBusy(false); if (r.ok) { toast(r.paused ? 'Reported. The match is paused for everyone.' : 'Report sent to the host and operators.', 'good'); setNote(''); onClose(); } else toast(r.error, 'warn'); };
  return (
    <Sheet open={open} onClose={onClose} title="Report a problem">
      <div className="space-y-3">
        <Banner tone="warn">In an emergency call your local emergency number first.</Banner>
        <Field label="What is happening?"><select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full h-11 rounded-xl bg-bg border border-line px-3"><option value="hazard">Unsafe area / hazard</option><option value="medical">Medical issue</option><option value="harassment">Harassment or unsafe behaviour</option><option value="trespass">Checkpoint on restricted property</option><option value="bug">Game problem</option><option value="other">Other</option></select></Field>
        <Field label="Details (optional)"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex gap-3 items-center text-sm"><input type="checkbox" className="size-5" checked={pause} onChange={(e) => setPause(e.target.checked)} />Pause the match for everyone</label>
        <Button variant="danger" className="w-full" busy={busy} onClick={send}>Send report</Button>
      </div>
    </Sheet>
  );
}
