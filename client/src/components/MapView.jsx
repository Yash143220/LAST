import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
const { setWorkerUrl } = maplibregl;
import { Box, Compass, Locate, Sun, Moon } from 'lucide-react';
import { darkenStyle } from '../lib/darkStyle.js';
import { C, MAP_STYLE } from '../lib/theme.js';
import { polyFeature, shapeRing, shapeBounds, circleCoords } from '../lib/geo.js';

setWorkerUrl(`${location.origin}/maplibre-gl-worker.mjs`);

const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
const EMPTY = { type: 'FeatureCollection', features: [] };
const fc = (features) => ({ type: 'FeatureCollection', features });
const DANGER_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'rail', 'transit', 'ferry', 'bus_guideway', 'raceway']);

/**
 * Real geographic map (MapLibre GL + OpenFreeMap vector tiles with 3D buildings).
 * Overlays are GeoJSON layers so they stay anchored when zooming/panning/tilting.
 * Markers are React nodes portalled into MapLibre markers.
 */
export default forwardRef(function MapView({
  area, zone, nextZone, danger = true, hints = [], draft, items = [], center, zoom = 16, fit, onClick, className, controls = true, interactive = true, padding, onLocate, controlsClass = 'right-3 top-3',
}, ref) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const clickRef = useRef(onClick);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tilt, setTilt] = useState(false);
  const [styleVer, setStyleVer] = useState(0);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('oo_map_dark') !== '0'; } catch { return true; } });
  const darkRef = useRef(dark);
  const [, bump] = useState(0);
  clickRef.current = onClick;

  useImperativeHandle(ref, () => ({
    flyTo: (p, z) => mapRef.current?.easeTo({ center: [p.lng, p.lat], zoom: z ?? Math.max(mapRef.current.getZoom(), 16), duration: 600 }),
    fitShape: (shape, pad = 60) => shape && mapRef.current?.fitBounds(shapeBounds(shape), { padding: padding || pad, duration: 600, maxZoom: 18 }),
    center: () => { const c = mapRef.current?.getCenter(); return c && { lat: c.lat, lng: c.lng }; },
    zoom: () => mapRef.current?.getZoom(),
    bounds: () => mapRef.current?.getBounds(),
    project: (p) => mapRef.current?.project([p.lng, p.lat]),
    // Safety helper: what map features (buildings, roads, water…) sit under a point?
    inspect(p) {
      const map = mapRef.current; if (!map) return { known: false, issues: [] };
      const pt = map.project([p.lng, p.lat]);
      if (map.getZoom() < 14.5) return { known: false, issues: [] };
      const feats = map.queryRenderedFeatures([[pt.x - 3, pt.y - 3], [pt.x + 3, pt.y + 3]]);
      const issues = new Set();
      for (const f of feats) {
        const l = f.sourceLayer;
        if (l === 'building') issues.add('building');
        else if (l === 'water') issues.add('water');
        else if (l === 'transportation' && DANGER_CLASSES.has(f.properties?.class)) issues.add(f.properties.class === 'rail' || f.properties.class === 'transit' ? 'railway' : 'road');
        else if (l === 'aeroway') issues.add('airport');
      }
      return { known: true, issues: [...issues] };
    },
  }));

  // create map once. The real style is fetched, darkened (unless the player chose light), then applied.
  const styleRef = useRef(null);
  const applyStyle = (map, dark) => {
    const raw = styleRef.current;
    if (!raw) return;
    map.setStyle(dark ? darkenStyle(raw) : raw, { diff: false });
  };
  useEffect(() => {
    const c = center || { lat: 20.2961, lng: 85.8245 };
    const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0E231E' } }] };
    let map; let dead = false;
    try {
      map = new maplibregl.Map({ container: box.current, style: BLANK, center: [c.lng, c.lat], zoom, maxPitch: 70, attributionControl: { compact: true }, interactive, pitchWithRotate: true });
    } catch { setFailed(true); return; }
    mapRef.current = map;
    let styled = false;
    map.on('error', () => { if (!styled) setFailed(true); });
    // (re)build overlays every time a style finishes loading (initial load and day/night switches)
    map.on('style.load', () => {
      const layers = map.getStyle().layers;
      const before = layers.find((l) => l.type === 'symbol')?.id;
      if (!layers.some((l) => l.type === 'fill-extrusion')) {
        const src = Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
        if (src) map.addLayer({ id: 'bld-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 15, paint: { 'fill-extrusion-color': '#2a4a3f', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.8 } }, before);
      }
      for (const id of ['danger', 'area', 'zone', 'next', 'hints', 'draft']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'danger-fill', type: 'fill', source: 'danger', paint: { 'fill-color': C.danger, 'fill-opacity': 0.2 } }, before);
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': C.brand, 'fill-opacity': 0.07 } }, before);
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': C.sage, 'line-width': 2, 'line-dasharray': [3, 3] } }, before);
      map.addLayer({ id: 'next-line', type: 'line', source: 'next', paint: { 'line-color': C.info, 'line-width': 2, 'line-dasharray': [1, 2] } }, before);
      map.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': C.lime, 'line-width': 3 } }, before);
      map.addLayer({ id: 'hints-fill', type: 'fill', source: 'hints', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } }, before);
      map.addLayer({ id: 'hints-line', type: 'line', source: 'hints', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1.5] } }, before);
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': C.lime, 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': C.lime, 'line-width': 3 } });
      if (styleRef.current) styled = true;
      setReady(true); setStyleVer((v) => v + 1);
    });
    fetch(MAP_STYLE).then((r) => { if (!r.ok) throw new Error('style'); return r.json(); })
      .then((json) => { if (dead) return; styleRef.current = json; applyStyle(map, darkRef.current); })
      .catch(() => { if (!dead) setFailed(true); });
    map.on('click', (e) => clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    const ro = new ResizeObserver(() => map.resize()); ro.observe(box.current);
    return () => { dead = true; ro.disconnect(); markers.current.forEach((m) => m.marker.remove()); markers.current.clear(); map.remove(); mapRef.current = null; setReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDark = () => { const next = !dark; setDark(next); darkRef.current = next; try { localStorage.setItem('oo_map_dark', next ? '1' : '0'); } catch { /* ignore */ } if (mapRef.current) applyStyle(mapRef.current, next); };

  const setData = (id, data) => mapRef.current?.getSource(id)?.setData(data);

  useEffect(() => {
    if (!ready) return;
    setData('area', area ? fc([polyFeature(shapeRing(area))]) : EMPTY);
    const live = zone || area;
    setData('zone', live ? fc([polyFeature(shapeRing(live))]) : EMPTY);
    setData('danger', danger && live ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, shapeRing(live)] } }]) : EMPTY);
    setData('next', nextZone ? fc([polyFeature(shapeRing(nextZone))]) : EMPTY);
  }, [ready, styleVer, area, zone, nextZone, danger]);

  useEffect(() => {
    if (!ready) return;
    setData('hints', fc(hints.map((h) => polyFeature(circleCoords(h, h.r, 40), { color: h.color || C.info }))));
  }, [ready, styleVer, hints]);

  useEffect(() => {
    if (!ready) return;
    const pts = draft || [];
    const ring = pts.map((p) => [p.lng, p.lat]);
    const feats = [];
    if (ring.length >= 3) feats.push(polyFeature([...ring, ring[0]]));
    else if (ring.length === 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } });
    setData('draft', fc(feats));
  }, [ready, styleVer, draft]);

  // center / fit control
  const lastCenter = useRef(null);
  useEffect(() => {
    if (!ready || !center) return;
    const k = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
    if (lastCenter.current === k) return;
    lastCenter.current = k;
    mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 500 });
  }, [ready, center]);
  const fitKey = fit ? JSON.stringify(fit) : null;
  useEffect(() => { if (ready && fit) mapRef.current.fitBounds(shapeBounds(fit), { padding: padding || 50, duration: 0, maxZoom: 18 }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, fitKey]);

  // markers (React nodes portalled into MapLibre markers)
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const cur = markers.current; let changed = false;
    const ids = new Set(items.map((i) => i.id));
    for (const [id, m] of cur) if (!ids.has(id)) { m.marker.remove(); cur.delete(id); changed = true; }
    for (const it of items) {
      let m = cur.get(it.id);
      if (!m) {
        const el = document.createElement('div');
        const marker = new maplibregl.Marker({ element: el, draggable: !!it.draggable, anchor: it.anchor || 'center' }).setLngLat([it.lng, it.lat]).addTo(map);
        m = { marker, el };
        marker.on('dragend', () => { const ll = marker.getLngLat(); m.onDragEnd?.(it.id, { lat: ll.lat, lng: ll.lng }); });
        el.addEventListener('click', (e) => { e.stopPropagation(); m.onClick?.(it.id); });
        cur.set(it.id, m); changed = true;
      } else if (!m.marker.isDragging?.()) m.marker.setLngLat([it.lng, it.lat]);
      m.onDragEnd = it.onDragEnd; m.onClick = it.onClick; m.marker.setDraggable(!!it.draggable);
      m.el.style.zIndex = it.z || 1; m.el.style.cursor = it.onClick ? 'pointer' : 'default';
    }
    if (changed) bump((n) => n + 1);
  }, [ready, items]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const toggleTilt = () => { const map = mapRef.current; const next = !tilt; setTilt(next); map.easeTo({ pitch: next ? 62 : 0, zoom: next ? Math.max(map.getZoom(), 17) : map.getZoom(), duration: 700 }); };

  return (
    <div className={`relative isolate z-0 ${className || ''}`}>
      <div ref={box} className="absolute inset-0 bg-bg" />
      {[...markers.current.entries()].map(([id, m]) => byId.get(id) && createPortal(byId.get(id).node, m.el, id))}
      {controls && ready && (
        <div className={`absolute ${controlsClass} flex flex-col gap-2 z-10`}>
          {onLocate && <button onClick={onLocate} aria-label="Centre on me" className="size-10 rounded-xl grid place-items-center border border-line bg-surface/95 text-text shadow"><Locate className="size-5" /></button>}
          <button onClick={toggleTilt} aria-pressed={tilt} aria-label="Toggle 3D buildings" className={`size-10 rounded-xl grid place-items-center border border-line shadow ${tilt ? 'bg-lime text-bg' : 'bg-surface/95 text-text'}`}><Box className="size-5" /></button>
          <button onClick={toggleDark} aria-label={dark ? 'Switch to light map' : 'Switch to dark map'} className="size-10 rounded-xl grid place-items-center border border-line bg-surface/95 text-text shadow">{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</button>
          <button onClick={() => mapRef.current.easeTo({ bearing: 0, pitch: tilt ? 62 : 0, duration: 400 })} aria-label="Reset north" className="size-10 rounded-xl grid place-items-center border border-line bg-surface/95 text-text shadow"><Compass className="size-5" /></button>
        </div>
      )}
      {!ready && !failed && <div className="absolute inset-0 grid place-items-center text-sage text-sm pointer-events-none">Loading map…</div>}
      {failed && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sage bg-bg/90 text-sm">The map could not load. Check your connection (map tiles come from OpenFreeMap).</div>}
    </div>
  );
});

