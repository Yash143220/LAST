import { Link } from 'react-router-dom';

export const CONSENT_ITEMS = [
  { key: 'terms', node: <>I accept the <Link to="/terms" target="_blank" className="underline text-lime">Terms &amp; Conditions</Link>.</> },
  { key: 'privacy', node: <>I have read the <Link to="/privacy" target="_blank" className="underline text-lime">Privacy Policy</Link>.</> },
  { key: 'location', node: <>I agree that my phone's location is shared with other players in a match (approximately, for opponents) and that, if I use the push-to-talk radio, my live voice is relayed to my teammates only (never recorded).</> },
  { key: 'safety', node: <>I will follow the <Link to="/safety" target="_blank" className="underline text-lime">Safety Rules</Link>: walk, stay outdoors on public pedestrian ground, never enter buildings, roads or railways.</> },
  { key: 'age', node: <>I am 16 or older, or I play with a parent/guardian's permission.</> },
];
export const NO_CONSENT = { terms: false, privacy: false, location: false, safety: false, age: false };
export const allChecked = (v) => CONSENT_ITEMS.every((i) => v[i.key]);

export default function ConsentBoxes({ value, onChange }) {
  const all = allChecked(value);
  const setAll = (b) => onChange(Object.fromEntries(CONSENT_ITEMS.map((i) => [i.key, b])));
  return (
    <fieldset className="space-y-2.5">
      <legend className="sr-only">Required agreements</legend>
      <label className="flex gap-3 items-center pb-2 border-b border-line text-text font-medium">
        <input type="checkbox" className="size-5" checked={all} onChange={(e) => setAll(e.target.checked)} /> Select all
      </label>
      {CONSENT_ITEMS.map((i) => (
        <label key={i.key} className="flex gap-3 items-start text-sm text-sage">
          <input type="checkbox" className="size-5 mt-0.5 shrink-0" checked={!!value[i.key]} onChange={(e) => onChange({ ...value, [i.key]: e.target.checked })} />
          <span>{i.node}</span>
        </label>
      ))}
    </fieldset>
  );
}
