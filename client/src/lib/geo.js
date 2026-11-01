const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const haversine = (a, b) => {
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};
export const offset = (p, bearingRad, m) => {
  const d = m / R, la = rad(p.lat), lo = rad(p.lng);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(bearingRad));
  const lo2 = lo + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: deg(la2), lng: deg(lo2) };
};
export const bearingTo = (a, b) => {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
};
export const circleCoords = (c, r, steps = 72) => {
  const ring = [];
  for (let i = 0; i <= steps; i++) { const p = offset(c, (i / steps) * Math.PI * 2, r); ring.push([p.lng, p.lat]); }
  return ring;
};
export const shapeRing = (shape) => (shape.type === 'circle' ? circleCoords(shape.center, shape.radius) : [...shape.points.map((p) => [p.lng, p.lat]), [shape.points[0].lng, shape.points[0].lat]]);
export const polyFeature = (ring, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
export const centroid = (pts) => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length });
export const areaCenter = (a) => (a.type === 'circle' ? a.center : centroid(a.points));
export const inCircle = (c, r, p) => haversine(c, p) <= r;
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { lng: xi, lat: yi } = poly[i], { lng: xj, lat: yj } = poly[j];
    if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const inShape = (s, p) => (!s ? true : s.type === 'circle' ? haversine(s.center, p) <= s.radius : pointInPolygon(p, s.points));
export const shapeBounds = (shape) => {
  const ring = shapeRing(shape);
  const lngs = ring.map((c) => c[0]), lats = ring.map((c) => c[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
};
export const polygonAreaM2 = (pts) => {
  const c = centroid(pts), kx = Math.cos(rad(c.lat)) * 111320;
  const m = pts.map((p) => ({ x: (p.lng - c.lng) * kx, y: (p.lat - c.lat) * 110540 }));
  let a = 0;
  for (let i = 0; i < m.length; i++) { const j = (i + 1) % m.length; a += m[i].x * m[j].y - m[j].x * m[i].y; }
  return Math.abs(a / 2);
};
export const scaleShapeFactor = (area, f) => (area.type === 'circle' ? { ...area, radius: area.radius * f } : { type: 'polygon', points: area.points.map((p) => { const c = centroid(area.points); return { lat: c.lat + (p.lat - c.lat) * f, lng: c.lng + (p.lng - c.lng) * f }; }) });
export const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
