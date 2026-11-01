import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Crosshair, MapPin, Pencil, Plus, Save, Search, Sparkles, Trash2, Undo2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { askLocation } from '../lib/gps.js';
import { useSession } from '../lib/session.jsx';
import { haversine, inShape, polygonAreaM2, scaleShapeFactor, shapeBounds, areaCenter, fmtDist } from '../lib/geo.js';
import { MISSION_NAMES, MISSION_POINTS } from '../lib/theme.js';
import MapView from '../components/MapView.jsx';
import { CheckpointPin, SpotPin, MissionIcon } from '../components/Pins.jsx';
import { Badge, Banner, Button, Card, Field, Input, Segmented, Slider, Toggle } from '../components/ui.jsx';

const FINAL_F = 40 / 300;
const uid = () => `cp_${Math.random().toString(36).slice(2, 10)}`;
const MT = Object.keys(MISSION_NAMES);
const ISSUE_TEXT = { building: 'a building', road: 'a road', railway: 'a railway', water: 'water', airport: 'an airport' };

export default function Setup({ state }) {
  const nav = useNavigate();
  const { toast } = useSession();
  const mapRef = useRef(null);
  const [tab, setTab] = useState('area');
  const [draft, setDraft] = useState(() => ({ ...state.settings }));
  const [cps, setCps] = useState(() => state.checkpoints);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [areaMode, setAreaMode] = useState(state.settings.area?.type === 'polygon' ? 'draw' : 'circle');
  const [pts, setPts] = useState(null);             // polygon being drawn (null = not drawing)
  const [placing, setPlacing] = useState(null);     // {kind, missionType} waiting for a map tap
  const [sel, setSel] = useState(null);
  const [warn, setWarn] = useState({});             // checkpoint id -> {issues, known}
  const [start, setStart] = useState(null);

  useEffect(() => { if (!state.settings.area) askLocation().then((r) => r.ok && setStart(r.fix)); }, []); // eslint-disable-line
  const area = draft.area;
  const finalShape = useMemo(() => (area ? scaleShapeFactor(area, draft.shrink ? FINAL_F : 1) : null), [area, draft.shrink]);

  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const setArea = (a) => { setDraft((d) => ({ ...d, area: a, hostSafetyConfirmed: false })); setDirty(true); };
  const setCpList = (fn) => { setCps(fn); setDraft((d) => ({ ...d, hostSafetyConfirmed: false })); setDirty(true); };

  const inspect = (cp) => { const r = mapRef.current?.inspect(cp); if (r) setWarn((w) => ({ ...w, [cp.id]: r })); return r; };
  useEffect(() => { const t = setTimeout(() => cps.forEach(inspect), 1500); return () => clearTimeout(t); }, []); // eslint-disable-line

  const addCp = (p, kind, missionType) => {
    if (area && !inShape(scaleShapeFactor(area, 1), p)) return toast('Place it inside the play area.', 'warn');
    if (kind === 'extraction' && finalShape && !inShape(finalShape, p)) toast('Extraction should be inside the final safe zone (dashed blue).', 'warn');
    const n = cps.filter((c) => c.kind === kind).length + 1;
    const name = kind === 'mission' ? MISSION_NAMES[missionType] : kind === 'supply' ? `Supply point ${n}` : 'Extraction point';
    const cp = { id: uid(), kind, missionType: kind === 'mission' ? missionType : null, name, description: '', lat: p.lat, lng: p.lng, radius: 25, active: true, approved: false };
    setCpList((l) => [...l, cp]); setSel(cp.id); setTimeout(() => inspect(cp), 300);
  };

  const onMapClick = (p) => {
    if (tab === 'area') {
      if (areaMode === 'circle') setArea({ type: 'circle', center: p, radius: area?.type === 'circle' ? area.radius : 300 });
      else if (pts) setPts((l) => [...l, p]);
    } else if (tab === 'points' && placing) { addCp(p, placing.kind, placing.missionType); setPlacing(null); }
  };

  const updCp = (id, patch) => setCpList((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const dragCp = (id, p) => {
    if (area && !inShape(scaleShapeFactor(area, 1), p)) { toast('That spot is outside the play area.', 'warn'); setCps((l) => [...l]); return; }
    setCpList((l) => l.map((c) => (c.id === id ? { ...c, ...p, approved: false } : c))); setTimeout(() => inspect({ id, ...p }), 200);
  };

  const finishDraw = () => { if (pts.length < 3) return toast('Add at least 3 corners.', 'warn'); setArea({ type: 'polygon', points: pts }); setPts(null); mapRef.current?.fitShape({ type: 'polygon', points: pts }); };

  const autoPlace = () => {
    if (!area) return toast('Choose the play area first.', 'warn');
    const list = [...cps]; const bounds = mapRef.current?.bounds();
    const need = [];
    for (const t of MT) if (!list.some((c) => c.kind === 'mission' && c.missionType === t)) need.push({ kind: 'mission', missionType: t });
    for (let i = list.filter((c) => c.kind === 'supply').length; i < 2; i++) need.push({ kind: 'supply' });
    if (!list.some((c) => c.kind === 'extraction')) need.push({ kind: 'extraction' });
    if (!need.length) return toast('All objective types are already placed.', 'info');
    let unverified = 0;
    const added = [];
    for (const n of need) {
      const target = n.kind === 'extraction' ? finalShape : scaleShapeFactor(area, 0.92);
      const [[w, s], [e, no]] = shapeBounds(target);
      let chosen = null;
      for (let t = 0; t < 120 && !chosen; t++) {
        const p = { lat: s + Math.random() * (no - s), lng: w + Math.random() * (e - w) };
        if (!inShape(target, p) || [...list, ...added].some((c) => haversine(c, p) < 35)) continue;
        const inView = bounds && p.lng >= bounds.getWest() && p.lng <= bounds.getEast() && p.lat >= bounds.getSouth() && p.lat <= bounds.getNorth();
        const r = inView ? mapRef.current.inspect(p) : null;
        if (r?.known && r.issues.length) continue;
        if (!r?.known && t < 60) continue;           // prefer points we could verify against the map
        chosen = { p, known: !!r?.known };
      }
      if (!chosen) { toast('Could not find a safe-looking spot for every item. Zoom in on the area and try again, or place them by hand.', 'warn'); break; }
      if (!chosen.known) unverified++;
      const nth = [...list, ...added].filter((c) => c.kind === n.kind).length + 1;
      added.push({ id: uid(), kind: n.kind, missionType: n.missionType || null, name: n.kind === 'mission' ? MISSION_NAMES[n.missionType] : n.kind === 'supply' ? `Supply point ${nth}` : 'Extraction point', description: '', ...chosen.p, radius: 25, active: true, approved: false });
    }
    if (added.length) { setCpList((l) => [...l, ...added]); toast(`Placed ${added.length} draft checkpoints${unverified ? ` (${unverified} could not be map-checked)` : ''}. Review and approve each one.`, 'good'); setTimeout(() => added.forEach(inspect), 400); }
  };

  const save = async (extra = {}) => {
    setSaving(true);
    try {
      const body = { settings: { ...draft, ...extra }, checkpoints: cps };
      const r = await api(`/games/${state.code}/config`, { method: 'PATCH', body });
      setDirty(false); setDraft((d) => ({ ...d, hostSafetyConfirmed: r.state.settings.hostSafetyConfirmed })); toast('Saved.', 'good'); return true;
    } catch (e) { toast(e.message, 'bad'); return false; } finally { setSaving(false); }
  };
  const back = () => { if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return; nav(`/m/${state.code}`); };

  const items = [
    ...(area?.type === 'circle' && tab === 'area' ? [{ id: 'center', lat: area.center.lat, lng: area.center.lng, node: <SpotPin />, anchor: 'bottom', draggable: true, onDragEnd: (_, p) => setArea({ ...area, center: p }) }] : []),
    ...(pts || []).map((p, i) => ({ id: `dp${i}`, lat: p.lat, lng: p.lng, node: <div className="size-4 rounded-full bg-lime border-2 border-bg" />, draggable: true, onDragEnd: (_, q) => setPts((l) => l.map((x, j) => (j === i ? q : x))) })),
    ...cps.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, draggable: true, z: sel === c.id ? 5 : 2, onDragEnd: dragCp, onClick: (id) => { setSel(id); setTab('points'); },
      node: <CheckpointPin cp={c} selected={sel === c.id} unsafe={(warn[c.id]?.issues || []).length > 0} /> })),
  ];

  const areaInfo = area ? (area.type === 'circle' ? `${Math.round(Math.PI * area.radius ** 2 / 1000) / 10}k m² · ${area.radius * 2} m across` : `${Math.round(polygonAreaM2(area.points) / 100) / 10}k m² · ${area.points.length} corners`) : null;

  return (
    <div className="h-dvh flex flex-col safe-top">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-line/60">
        <button onClick={back} className="size-10 grid place-items-center rounded-xl text-sage hover:bg-raised" aria-label="Back"><ArrowLeft className="size-5" /></button>
        <div className="flex-1 min-w-0"><div className="text-xs text-sage">Configure · {state.code}</div><h1 className="font-display text-xl font-bold leading-none truncate">{draft.name}</h1></div>
        <Button size="sm" icon={Save} busy={saving} disabled={!dirty} onClick={() => save()}>{dirty ? 'Save' : 'Saved'}</Button>
      </header>
      <MapView ref={mapRef} className="h-[38dvh] shrink-0" center={start || (area ? areaCenter(area) : undefined)} fit={state.settings.area || undefined} area={area} nextZone={finalShape && draft.shrink ? finalShape : undefined} draft={pts} items={items} onClick={onMapClick} zoom={start ? 16 : 14} />
      <div className="px-3 pt-3"><Segmented value={tab} onChange={setTab} options={[{ value: 'area', label: 'Area' }, { value: 'points', label: 'Checkpoints' }, { value: 'rules', label: 'Rules' }, { value: 'review', label: 'Review' }]} /></div>
      <div className="flex-1 scroll-y px-3 py-3 pb-10 space-y-3">
        {tab === 'area' && <AreaTab {...{ area, areaMode, setAreaMode, pts, setPts, setArea, finishDraw, areaInfo, mapRef, toast, setStart }} />}
        {tab === 'points' && <PointsTab {...{ cps, area, sel, setSel, updCp, setCpList, placing, setPlacing, warn, autoPlace, mapRef, draft, toast, setDraft, setCps, setDirty, state }} />}
        {tab === 'rules' && <RulesTab draft={draft} set={set} />}
        {tab === 'review' && <ReviewTab {...{ state, draft, cps, dirty, save, saving, nav, warn }} />}
      </div>
    </div>
  );
}

function AreaTab({ area, areaMode, setAreaMode, pts, setPts, setArea, finishDraw, areaInfo, mapRef, toast, setStart }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 3) return; setBusy(true);
    try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': navigator.language } }); setRes(await r.json()); }
    catch { toast('Place search failed. Pan the map manually instead.', 'warn'); } finally { setBusy(false); }
  };
  const go = (r) => { const p = { lat: +r.lat, lng: +r.lon }; setStart(p); mapRef.current?.flyTo(p, 16); setRes([]); };
  const useMe = async () => { const r = await askLocation(); if (!r.ok) return toast(r.error, 'warn'); setStart(r.fix); mapRef.current?.flyTo(r.fix, 16); };
  return (
    <>
      <Card className="space-y-3">
        <div className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search a park, plaza or address" aria-label="Search place" /><Button variant="ghost" icon={Search} busy={busy} onClick={search} aria-label="Search" /></div>
        {res.length > 0 && <ul className="rounded-xl border border-line divide-y divide-line/60 text-sm">{res.map((r) => <li key={r.place_id}><button onClick={() => go(r)} className="w-full text-left p-2.5 hover:bg-raised">{r.display_name}</button></li>)}</ul>}
        <Button variant="ghost" size="sm" icon={Crosshair} onClick={useMe}>Go to my location</Button>
        <p className="text-xs text-sage">Search by <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> Nominatim.</p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-display text-2xl font-bold">Play area</h2>
        <Segmented value={areaMode} onChange={(m) => { setAreaMode(m); if (m === 'draw' && !pts) setPts([]); if (m === 'circle') setPts(null); }} options={[{ value: 'circle', label: 'Centre + radius' }, { value: 'draw', label: 'Draw path' }]} />
        {areaMode === 'circle' ? (
          <>
            <p className="text-sm text-sage">Tap the map to place the centre (drag the pin to fine-tune), then set the radius.</p>
            <Slider label="Radius" value={area?.type === 'circle' ? area.radius : 300} min={50} max={1500} step={10} unit=" m" disabled={!area || area.type !== 'circle'} onChange={(r) => setArea({ ...area, radius: r })} hint="Allowed range: 50 m to 1.5 km. Default 300 m." />
          </>
        ) : (
          <>
            <p className="text-sm text-sage">Tap the map to add corners around the area you want, in order. Corners must stay within 1 km of the centre and the path may not cross itself.</p>
            {pts ? (
              <div className="flex flex-wrap gap-2 items-center"><Badge tone="info">{pts.length} corners</Badge>
                <Button size="sm" variant="ghost" icon={Undo2} disabled={!pts.length} onClick={() => setPts((l) => l.slice(0, -1))}>Undo</Button>
                <Button size="sm" icon={Check} disabled={pts.length < 3} onClick={finishDraw}>Close shape</Button>
                <Button size="sm" variant="quiet" onClick={() => setPts([])}>Clear</Button></div>
            ) : <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setPts(area?.type === 'polygon' ? area.points : []); }}>Edit corners</Button>}
          </>
        )}
        {areaInfo && <div className="text-sm text-sage">Area: <span className="text-text">{areaInfo}</span></div>}
        <div className="text-xs text-sage space-y-1"><div><span className="inline-block w-3 h-0.5 bg-lime align-middle mr-2" />Safe zone (inside)</div><div><span className="inline-block w-3 h-3 bg-danger/40 align-middle mr-2" />Danger zone (outside the boundary)</div><div><span className="inline-block w-3 h-0.5 bg-info align-middle mr-2" />Final safe zone (extraction goes here)</div></div>
      </Card>
    </>
  );
}

function PointsTab({ cps, area, sel, setSel, updCp, setCpList, placing, setPlacing, warn, autoPlace, mapRef, draft, toast, setDraft, setCps, setDirty, state }) {
  const [presets, setPresets] = useState(null); const [pname, setPname] = useState('');
  useEffect(() => { api('/presets').then((r) => setPresets(r.presets)).catch(() => setPresets([])); }, []);
  const missions = MT.map((t) => ({ t, has: cps.some((c) => c.kind === 'mission' && c.missionType === t) }));
  const savePreset = async () => {
    try { await api('/presets', { method: 'POST', body: { name: pname, area, checkpoints: cps } }); setPname(''); setPresets((await api('/presets')).presets); toast('Preset saved.', 'good'); } catch (e) { toast(e.message, 'warn'); }
  };
  const loadPreset = (p) => { setDraft((d) => ({ ...d, area: p.area, hostSafetyConfirmed: false })); setCps(p.checkpoints.map((c) => ({ ...c, approved: false }))); setDirty(true); setTimeout(() => mapRef.current?.fitShape(p.area), 100); toast('Preset loaded. Re-approve every checkpoint on site.', 'info'); };
  const s = cps.find((c) => c.id === sel);
  const d = (c) => (area ? '' : '');
  return (
    <>
      {!area && <Banner tone="warn">Choose the play area first (Area tab).</Banner>}
      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display text-2xl font-bold">Add checkpoint</h2><Button size="sm" variant="ghost" icon={Sparkles} onClick={autoPlace}>Suggest spots</Button></div>
        <p className="text-sm text-sage">{placing ? <b className="text-lime">Tap the map to place: {placing.kind === 'mission' ? MISSION_NAMES[placing.missionType] : placing.kind}</b> : 'Choose a type, then tap the map. Drag any pin to adjust it. Suggested spots are only drafts and need your approval.'}</p>
        <div className="grid grid-cols-2 gap-2">
          {missions.map(({ t, has }) => (
            <Button key={t} size="sm" variant={placing?.missionType === t ? 'primary' : 'ghost'} onClick={() => setPlacing(placing?.missionType === t ? null : { kind: 'mission', missionType: t })} className="justify-start" icon={() => <MissionIcon type={t} className="size-4" />}>
              <span className="truncate">{MISSION_NAMES[t]}</span>{has && <Check className="size-3.5 text-lime ml-auto" />}
            </Button>
          ))}
          <Button size="sm" variant={placing?.kind === 'supply' ? 'primary' : 'ghost'} onClick={() => setPlacing(placing?.kind === 'supply' ? null : { kind: 'supply' })} icon={Plus}>Supply point</Button>
          <Button size="sm" variant={placing?.kind === 'extraction' ? 'primary' : 'ghost'} onClick={() => setPlacing(placing?.kind === 'extraction' ? null : { kind: 'extraction' })} icon={Plus}>Extraction</Button>
        </div>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-display text-2xl font-bold">Checkpoints ({cps.length})</h2>
        {cps.length === 0 && <p className="text-sm text-sage">None yet. You need at least 3 different missions and 1 extraction point.</p>}
        {cps.map((c) => {
          const w = warn[c.id]; const bad = w?.issues?.length > 0;
          return (
            <div key={c.id} className={`rounded-xl border ${sel === c.id ? 'border-lime' : 'border-line/70'} bg-bg/50`}>
              <button className="w-full flex items-center gap-3 p-2.5 text-left" onClick={() => { setSel(sel === c.id ? null : c.id); mapRef.current?.flyTo(c, 17); }}>
                <span className="size-8 rounded-full grid place-items-center bg-raised text-lime">{c.kind === 'mission' ? <MissionIcon type={c.missionType} className="size-4" /> : <MapPin className="size-4" />}</span>
                <span className="flex-1 min-w-0"><span className="block truncate">{c.name}</span><span className="block text-xs text-sage">{c.kind}{c.kind === 'mission' ? ` · ${MISSION_POINTS[c.missionType]} pts` : ''}</span></span>
                {bad && <TriangleAlert className="size-4 text-danger" aria-label="Safety warning" />}
                {c.approved ? <Badge tone="good">Approved</Badge> : <Badge tone="bad">Needs review</Badge>}
              </button>
              {sel === c.id && (
                <div className="p-3 pt-1 space-y-2 border-t border-line/60">
                  <Field label="Name"><Input value={c.name} maxLength={40} onChange={(e) => updCp(c.id, { name: e.target.value })} /></Field>
                  <Field label="Instructions for players"><Input value={c.description} maxLength={200} onChange={(e) => updCp(c.id, { description: e.target.value })} placeholder="e.g. Open lawn east of the fountain" /></Field>
                  <Slider label="Checkpoint radius" value={c.radius} min={10} max={80} step={5} unit=" m" onChange={(r) => updCp(c.id, { radius: r })} />
                  {bad && <Banner tone="bad">The map shows {w.issues.map((i) => ISSUE_TEXT[i]).join(', ')} at this spot. Move it to open pedestrian ground.</Banner>}
                  {w && !w.known && <Banner tone="info">Not auto-checked (zoom in to street level on the pin for a map check). Verify on site.</Banner>}
                  <label className="flex gap-3 items-start text-sm"><input type="checkbox" className="size-5 mt-0.5" checked={c.approved} onChange={(e) => updCp(c.id, { approved: e.target.checked })} /><span>I verified this is an <b>open, public, outdoor, pedestrian-safe</b> spot: not inside a building, not on a road or railway, not private or restricted property.</span></label>
                  <Toggle label="Active in this match" checked={c.active} onChange={(v) => updCp(c.id, { active: v })} />
                  <Button size="sm" variant="dangerGhost" icon={Trash2} onClick={() => { setCpList((l) => l.filter((x) => x.id !== c.id)); setSel(null); }}>Delete checkpoint</Button>
                </div>
              )}
            </div>
          );
        })}
      </Card>
      <Card className="space-y-2">
        <h2 className="font-display text-2xl font-bold">Saved presets</h2>
        <div className="flex gap-2"><Input value={pname} onChange={(e) => setPname(e.target.value)} placeholder="Preset name" maxLength={60} /><Button variant="ghost" disabled={!area || !cps.length || pname.trim().length < 2} onClick={savePreset}>Save</Button></div>
        {presets?.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{p.name} <span className="text-sage">· {p.checkpoints.length} points</span></span><Button size="sm" variant="ghost" onClick={() => loadPreset(p)}>Load</Button>
            <button className="p-2 text-sage hover:text-danger" aria-label="Delete preset" onClick={async () => { await api(`/presets/${p.id}`, { method: 'DELETE' }); setPresets((l) => l.filter((x) => x.id !== p.id)); }}><Trash2 className="size-4" /></button></div>
        ))}
        <p className="text-xs text-sage">Presets save the area and checkpoints. Approvals are never carried over: re-check every spot before each match.</p>
      </Card>
    </>
  );
}

function RulesTab({ draft: d, set }) {
  return (
    <>
      <Card><h2 className="font-display text-2xl font-bold">Match</h2>
        <Field label="Name"><Input value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Slider label="Max players" value={d.maxPlayers} min={2} max={30} onChange={(v) => set({ maxPlayers: v, zombieCount: Math.min(d.zombieCount, v - 1) })} />
        <Slider label="Starting zombies" value={d.zombieCount} min={1} max={Math.min(8, d.maxPlayers - 1)} onChange={(v) => set({ zombieCount: v })} hint="Guide: 6 players = 1-2, 10 = 2, 15 = 3, 20 = 4." />
        <Slider label="Match length" value={d.durationMin} min={5} max={90} step={5} unit=" min" onChange={(v) => set({ durationMin: v, extractionWindowMin: Math.min(d.extractionWindowMin, Math.floor(v / 2)) })} />
        <Slider label="Countdown after start" value={d.countdownSec} min={5} max={30} unit=" s" onChange={(v) => set({ countdownSec: v })} /></Card>
      <Card><h2 className="font-display text-2xl font-bold">Missions &amp; extraction</h2>
        <Slider label="Missions needed to unlock extraction" value={d.requiredMissions} min={1} max={5} onChange={(v) => set({ requiredMissions: v })} />
        <Slider label="Time to complete a mission" value={d.missionHoldSec} min={5} max={60} unit=" s" onChange={(v) => set({ missionHoldSec: v })} hint="Survivors must stay inside the checkpoint radius." />
        <Slider label="Extraction countdown" value={d.extractionHoldSec} min={10} max={60} unit=" s" onChange={(v) => set({ extractionHoldSec: v })} />
        <Slider label="Extraction opens in the last" value={d.extractionWindowMin} min={1} max={Math.max(1, Math.min(15, Math.floor(d.durationMin / 2)))} unit=" min" onChange={(v) => set({ extractionWindowMin: v })} /></Card>
      <Card><h2 className="font-display text-2xl font-bold">Infection</h2>
        <Slider label="Infection distance" value={d.infectionRange} min={5} max={25} unit=" m" onChange={(v) => set({ infectionRange: v })} hint="GPS is not exact. The QR scan on the survivor's screen is the real confirmation." />
        <Slider label="QR code lifetime" value={d.qrTtlSec} min={10} max={30} unit=" s" onChange={(v) => set({ qrTtlSec: v })} /></Card>
      <Card><h2 className="font-display text-2xl font-bold">Intel</h2>
        <Slider label="Location hint every" value={d.revealIntervalSec} min={30} max={300} step={10} unit=" s" onChange={(v) => set({ revealIntervalSec: v })} />
        <Slider label="Hint area radius" value={d.hintRadius} min={30} max={150} step={5} unit=" m" onChange={(v) => set({ hintRadius: v })} hint="Bigger = vaguer. The real position is somewhere inside the circle." />
        <Toggle label="Survivors also see zombie hints" checked={d.revealToSurvivors} onChange={(v) => set({ revealToSurvivors: v })} />
        <Toggle label="Survivors can identify teammates" hint="Also reveals who the starting zombies are by elimination." checked={d.survivorsKnowTeam} onChange={(v) => set({ survivorsKnowTeam: v })} /></Card>
      <Card><h2 className="font-display text-2xl font-bold">Safe zone</h2>
        <Toggle label="Zone shrinks during the match" checked={d.shrink} onChange={(v) => set({ shrink: v })} />
        <Slider label="Grace period outside the zone" value={d.graceSec} min={15} max={180} step={5} unit=" s" onChange={(v) => set({ graceSec: v })} />
        <Field label="Penalty after grace"><Segmented value={d.zonePenalty} onChange={(v) => set({ zonePenalty: v })} options={[{ value: 'infect', label: 'Survivor infected' }, { value: 'warn', label: 'Warning only' }]} /></Field></Card>
      <Card><h2 className="font-display text-2xl font-bold">GPS &amp; fairness</h2>
        <Slider label="Required GPS accuracy" value={d.maxAccuracy} min={10} max={60} step={5} unit=" m" onChange={(v) => set({ maxAccuracy: v })} hint="Actions and penalties are ignored when accuracy is worse than this." />
        <Slider label="Drop players with no signal for" value={d.forfeitSignalLossSec} min={0} max={900} step={60} unit=" s" onChange={(v) => set({ forfeitSignalLossSec: v === 60 ? 60 : v })} hint="0 = never. Stops survivors hiding with their phone off." />
        <Toggle label="Allow simulated GPS (practice mode)" hint="Players can move with on-screen controls. For testing only - never for real matches." checked={d.allowSimGps} onChange={(v) => set({ allowSimGps: v })} /></Card>
    </>
  );
}

function ReviewTab({ state, draft, cps, dirty, save, saving, nav }) {
  const rd = state.readiness;
  const live = cps.filter((c) => c.active);
  return (
    <>
      <Card className="space-y-2">
        <h2 className="font-display text-2xl font-bold">Readiness</h2>
        {dirty && <Banner tone="warn">You have unsaved changes. Save before confirming.</Banner>}
        {rd?.ok ? <Banner tone="good">Everything checks out.</Banner> : <ul className="text-sm space-y-1.5 text-sage list-disc pl-5">{(rd?.issues || ['Save your changes to see what is missing.']).map((i) => <li key={i}>{i}</li>)}</ul>}
        <div className="text-sm text-sage">{live.length} active checkpoints · {live.filter((c) => c.approved).length} approved</div>
      </Card>
      <Card className="space-y-3 border-lime/40">
        <h2 className="font-display text-2xl font-bold">Host safety confirmation</h2>
        <label className="flex gap-3 items-start text-sm"><input type="checkbox" className="size-5 mt-0.5" disabled={dirty} checked={!!draft.hostSafetyConfirmed} onChange={(e) => save({ hostSafetyConfirmed: e.target.checked })} />
          <span>I reviewed every active checkpoint and the play area. All are outdoors, publicly accessible and pedestrian-safe. No task requires entering a building, road, railway or private property.</span></label>
        <p className="text-xs text-sage">Changing the area or any checkpoint clears this confirmation.</p>
        <Button className="w-full" variant="ghost" busy={saving} onClick={() => nav(`/m/${state.code}`)}>Back to lobby</Button>
      </Card>
    </>
  );
}
