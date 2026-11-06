import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { User } from './models.js';

const google = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
export const COOKIE = 'oo_session';

export const cookieOpts = () => ({
  httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionDays * 86400_000,
});

export const signSession = (user) =>
  jwt.sign({ sub: String(user._id), v: user.tokenVersion }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });

export async function userFromToken(token) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret);
    const u = await User.findById(p.sub);
    if (!u || u.tokenVersion !== p.v) return null;
    return u;
  } catch { return null; }
}

export async function verifyGoogleCredential(credential) {
  if (!google) throw Object.assign(new Error('Google sign-in is not configured on this server.'), { status: 503 });
  const ticket = await google.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw Object.assign(new Error('Invalid Google token.'), { status: 401 });
  return p;
}

// The admin console is only available to the developer: role in DB AND email on the env allow-list.
export const isAdminUser = (u) => !!u && u.role === 'admin' && config.adminEmails.includes(u.email);

export async function requireAuth(req, res, next) {
  const u = await userFromToken(req.cookies?.[COOKIE]);
  if (!u) return res.status(401).json({ error: 'Not signed in.' });
  if (u.suspended) return res.status(403).json({ error: `Account suspended.${u.suspendedReason ? ' ' + u.suspendedReason : ''}`, code: 'SUSPENDED' });
  req.user = u;
  next();
}
export function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) return res.status(404).json({ error: 'Not found.' }); // hide existence
  next();
}

export const avatarUrl = (u) => (u?.avatarVer ? `/api/avatar/${u._id ?? u.id}?v=${u.avatarVer}` : u?.photoUrl || '');

export const publicUser = (u) => ({
  id: String(u._id), email: u.email, name: u.name, displayName: u.displayName, photoUrl: u.photoUrl, avatar: u.avatarVer ? avatarUrl(u) : '',
  role: isAdminUser(u) ? 'admin' : 'player', consents: u.consents, stats: u.stats, createdAt: u.createdAt,
  consentCurrent: u.consents?.version === config.consentVersion && u.consents?.terms && u.consents?.privacy && u.consents?.location && u.consents?.safety && u.consents?.age,
});

export const sanitizeName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
