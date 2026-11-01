// MapLibre v6 resolves its web-worker relative to the bundle URL, which breaks once bundled.
// We serve the worker file ourselves from /maplibre-gl-worker.mjs and register it with setWorkerUrl().
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
copyFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/maplibre-gl-worker.mjs');
console.log('copied maplibre worker');
