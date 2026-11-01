import 'dotenv/config';
import crypto from 'node:crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const trustProxy = (v) => {
  if (!v || v === 'false' || v === '0') return false;
  return Number(v) || v;
};

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) throw new Error('JWT_SECRET is required in production (use `openssl rand -hex 48`).');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a random dev secret (sessions reset on restart).');
}
if (isProd && !env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required in production.');

export const config = {
  isProd,
  port: Number(env.PORT || 8080),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/operation_outbreak',
  jwtSecret,
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  allowedOrigins: [...new Set([
    ...list(env.CLIENT_ORIGINS),
    ...(!isProd ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
  ])],
  // Dev-only login (never enabled in production unless you explicitly force it - you should not).
  allowDevLogin: env.ALLOW_DEV_LOGIN ? env.ALLOW_DEV_LOGIN === 'true' : !isProd,
  trustProxy: env.TRUST_PROXY === undefined ? (isProd ? 1 : false) : trustProxy(env.TRUST_PROXY),
  consentVersion: '2026-11-01',
  limits: { maxRooms: Number(env.MAX_ROOMS || 500), avatarBytes: 90_000 },
  sessionDays: 30,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  insecureHttp: env.INSECURE_HTTP === 'true', // only for testing a production build over plain http
};
