import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { config } from './config.js';
import { api } from './routes/api.js';
import { admin } from './routes/admin.js';
import { initSockets, startLoop } from './sockets.js';
import { restoreRooms, flushAll, loadAppSettings, migrateAvatars } from './services.js';
import { rooms } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // required for Google Sign-In popup
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://*.openfreemap.org'],
      fontSrc: ["'self'", 'data:', 'https://*.openfreemap.org'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://*.openfreemap.org', 'https://nominatim.openstreetmap.org', 'https://accounts.google.com/gsi/'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      workerSrc: ["'self'", 'blob:'],
      childSrc: ["'self'", 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      ...(config.insecureHttp || !config.isProd ? {} : { upgradeInsecureRequests: [] }),
    },
  },
}));
app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)'); next(); });
app.use(compression());
app.use(express.json({ limit: '160kb' }));
app.use(cookieParser());

// CSRF defence in depth: cookie is SameSite=Lax; additionally require same-origin Origin on writes.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o) { try { if (new URL(o).host !== req.headers.host && !config.allowedOrigins.includes(o)) return res.status(403).json({ error: 'Bad origin.' }); } catch { return res.status(403).json({ error: 'Bad origin.' }); } }
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/healthz', (req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.use('/api/admin', admin);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

const dist = process.env.CLIENT_DIST ? path.resolve(process.env.CLIENT_DIST) : path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\/assets\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get('/{*splat}', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
}
app.use((err, req, res, next) => { // eslint-disable-line
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error('[http]', err);
  res.status(500).json({ error: 'Server error.' });
});

const server = http.createServer(app);
initSockets(server);

async function main() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 });
  console.log('[db] connected');
  await loadAppSettings();
  await migrateAvatars();
  await restoreRooms();
  const loop = startLoop();
  server.listen(config.port, () => console.log(`[server] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`));
  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return; closing = true;
    console.log(`[server] ${sig} - saving rooms and exiting`);
    clearInterval(loop);
    await flushAll();
    server.close(); await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
