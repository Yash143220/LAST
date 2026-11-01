const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const validLL = (p) =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function offsetPoint(p, bearing, meters) {
  const d = meters / R, la = rad(p.lat), lo = rad(p.lng);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(bearing));
  const lo2 = lo + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: deg(la2), lng: ((deg(lo2) + 540) % 360) - 180 };
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { lng: xi, lat: yi } = poly[i];
    const { lng: xj, lat: yj } = poly[j];
    if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const centroid = (poly) => ({
  lat: poly.reduce((s, p) => s + p.lat, 0) / poly.length,
  lng: poly.reduce((s, p) => s + p.lng, 0) / poly.length,
});

export const scalePolygon = (poly, c, f) =>
  poly.map((p) => ({ lat: c.lat + (p.lat - c.lat) * f, lng: c.lng + (p.lng - c.lng) * f }));

function toMeters(poly, c) {
  const kx = Math.cos(rad(c.lat)) * 111320;
  return poly.map((p) => ({ x: (p.lng - c.lng) * kx, y: (p.lat - c.lat) * 110540 }));
}

export function polygonAreaM2(poly) {
  const m = toMeters(poly, centroid(poly));
  let a = 0;
  for (let i = 0; i < m.length; i++) {
    const j = (i + 1) % m.length;
    a += m[i].x * m[j].y - m[j].x * m[i].y;
  }
  return Math.abs(a / 2);
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function polygonSelfIntersects(poly) {
  const m = toMeters(poly, centroid(poly));
  const n = m.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1)) continue;
      if (segCross(m[i], m[(i + 1) % n], m[j], m[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function inShape(shape, p) {
  if (!shape) return true;
  return shape.type === 'circle' ? haversine(shape.center, p) <= shape.radius : pointInPolygon(p, shape.points);
}

export const areaCenter = (area) => (area.type === 'circle' ? area.center : centroid(area.points));

export function scaledShape(area, f) {
  if (area.type === 'circle') return { type: 'circle', center: area.center, radius: area.radius * f };
  return { type: 'polygon', points: f === 1 ? area.points : scalePolygon(area.points, centroid(area.points), f) };
}

export function randomPointNear(p, maxMeters) {
  const dist = Math.sqrt(Math.random()) * maxMeters;
  return offsetPoint(p, Math.random() * Math.PI * 2, dist);
}
