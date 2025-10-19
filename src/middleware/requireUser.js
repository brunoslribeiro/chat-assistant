import { verifySessionToken } from '../utils/session.js';

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (!k) continue;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  }
  return out;
}

export function attachUser(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.session || '';
  const data = verifySessionToken(token);
  if (data) req.user = { id: data.sub, role: data.role, email: data.email, name: data.name };
  next();
}

export function requireUser(req, res, next) {
  if (req.user && req.user.id) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden' });
}

