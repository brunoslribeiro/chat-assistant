import crypto from 'crypto';
import { config } from '../config/env.js';

// Simple HMAC-signed session token in a cookie (no external libs)
// token = base64url(json) + "." + base64url(hmac)

const secret = process.env.SESSION_SECRET || 'dev-secret';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function sign(data) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

export function createSessionToken(payload, maxAgeSec = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + maxAgeSec };
  const json = JSON.stringify(body);
  const part = b64url(json);
  const mac = b64url(sign(part));
  return `${part}.${mac}`;
}

export function verifySessionToken(token) {
  try {
    const [part, mac] = String(token || '').split('.');
    if (!part || !mac) return null;
    const expected = b64url(sign(part));
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const json = Buffer.from(part.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
    const data = JSON.parse(json);
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now()/1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token, maxAgeSec = 7 * 24 * 3600) {
  const isProd = String(process.env.NODE_ENV||'').toLowerCase() === 'production';
  const attrs = [
    `HttpOnly`,
    `Path=/`,
    `Max-Age=${maxAgeSec}`,
    // Secure in production (TLS)
    ...(isProd ? ['Secure','SameSite=None'] : ['SameSite=Lax'])
  ];
  res.setHeader('Set-Cookie', `session=${token}; ${attrs.join('; ')}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
}

