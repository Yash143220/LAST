// Turns any light MapLibre style (e.g. OpenFreeMap "liberty") into a dark, low-glare one that matches the game's palette.
// Pure function: walks every colour in every layer's paint (including colours inside expressions/stops) and remaps
// its lightness according to what the colour is used for. Hue is kept so water stays bluish and parks stay green.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const [h, sat, l] = [+m[1], +m[2] / 100, +m[3] / 100];
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    const k = (n) => (n + h / 30) % 12, f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
  }
  return null;
}

export function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const hsla = (h, s, l, a) => `hsla(${Math.round(h)}, ${Math.round(clamp(s) * 100)}%, ${Math.round(clamp(l) * 1000) / 10}%, ${Math.round(a * 1000) / 1000})`;

// property + colour -> new colour
export function remap(prop, str, layerType) {
  const c = parseColor(str);
  if (!c) return str;
  const { h, s, l } = toHsl(c);
  const a = c.a;
  if (prop === 'background-color') return hsla(165, 0.42, 0.1, a);                       // game background #0E231E
  if (prop === 'text-color' || prop === 'icon-color') return hsla(h, s * 0.6, 0.62 + 0.3 * (1 - l), a);
  if (prop === 'text-halo-color' || prop === 'icon-halo-color') return hsla(h, s * 0.5, 0.06 + 0.12 * (1 - l), a);
  if (prop === 'fill-extrusion-color') return hsla(h, s * 0.4, 0.17 + 0.14 * (1 - l), a);   // buildings a little lighter than land
  if (prop === 'line-color' || prop === 'fill-outline-color' || prop === 'circle-stroke-color') return hsla(h, Math.min(s, 0.45) * 0.7, 0.2 + 0.28 * l, a); // roads lighter than land
  if (prop === 'fill-color' || (prop === 'circle-color' && layerType === 'circle')) {
    if (s > 0.15 && h >= 165 && h <= 260 && l > 0.5) return hsla(h, Math.min(s, 0.5) * 0.8, 0.15, a);             // water
    if (s > 0.12 && h >= 50 && h < 165) return hsla(h, Math.min(s, 0.4) * 0.8, 0.12 + 0.08 * (1 - l), a);          // green land cover
    return hsla(h, s * 0.5, 0.1 + 0.2 * (1 - l), a);                                                                // everything else
  }
  return hsla(h, s * 0.7, clamp(1 - l, 0.12, 0.88), a);
}

function walk(v, prop, layerType) {
  if (typeof v === 'string') return remap(prop, v, layerType);
  if (Array.isArray(v)) return v.map((x) => walk(x, prop, layerType));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, prop, layerType)]));
  return v;
}

export function darkenStyle(style) {
  const out = JSON.parse(JSON.stringify(style));
  for (const layer of out.layers || []) {
    if (!layer.paint) continue;
    for (const key of Object.keys(layer.paint)) if (/-color$/.test(key)) layer.paint[key] = walk(layer.paint[key], key, layer.type);
  }
  return out;
}
