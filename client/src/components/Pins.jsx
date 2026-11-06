import { Antenna, Cross, Zap, Radio, LifeBuoy, Package, Flag, Skull, User, MapPin, Check } from 'lucide-react';
import { C } from '../lib/theme.js';

const MI = { comms: Antenna, medical: Cross, power: Zap, signal: Radio, rescue: LifeBuoy };
export const MissionIcon = ({ type, ...p }) => { const I = MI[type] || Flag; return <I {...p} />; };

const base = 'grid place-items-center rounded-full border-2 shadow-lg';
export function CheckpointPin({ cp, done, selected, unsafe, dim, busy, pct = 0, tone }) {
  const color = cp.kind === 'extraction' ? C.info : cp.kind === 'supply' ? '#f2c14e' : C.lime;
  const bg = !cp.active || dim ? '#3a4f47' : done ? '#2c5646' : C.bg;
  const t = tone || C.info;
  return (
    <div className="flex flex-col items-center" style={{ opacity: cp.active ? 1 : 0.55 }}>
      <div className={busy ? 'pin-busy rounded-full p-1' : ''} style={busy ? { '--glow': t, background: `conic-gradient(${t} ${Math.round(pct * 360)}deg, rgba(14,35,30,.9) 0)` } : undefined}>
      <div className={base} style={{ width: selected ? 40 : 34, height: selected ? 40 : 34, background: bg, borderColor: unsafe ? C.danger : selected ? '#fff' : color, borderStyle: cp.approved ? 'solid' : 'dashed', color }}>
        {done ? <Check size={18} /> : cp.kind === 'mission' ? <MissionIcon type={cp.missionType} size={17} /> : cp.kind === 'supply' ? <Package size={17} /> : <Flag size={17} />}
      </div>
      </div>
    </div>
  );
}
export const MePin = ({ team, acc }) => (
  <div className="relative size-5 rounded-full border-[3px] border-white shadow-lg pulse-ring" style={{ background: team === 'zombie' ? C.danger : C.lime }} title={acc ? `±${Math.round(acc)} m` : ''} />
);
export const MatePin = ({ name, team }) => (
  <div className="flex flex-col items-center -mt-3">
    <div className="size-7 rounded-full grid place-items-center border-2" style={{ background: C.bg, borderColor: team === 'zombie' ? C.danger : C.lime, color: team === 'zombie' ? C.danger : C.lime }}>{team === 'zombie' ? <Skull size={15} /> : <User size={15} />}</div>
    <span className="mt-0.5 text-[10px] leading-none px-1 py-0.5 rounded bg-bg/85 text-text max-w-20 truncate">{name}</span>
  </div>
);
export const SpotPin = () => <MapPin className="text-lime drop-shadow" size={34} fill="#0E231E" />;
