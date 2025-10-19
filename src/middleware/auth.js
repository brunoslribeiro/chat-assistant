import { config } from '../config/env.js';

export function requireAuth(req, res, next) {
  if (!config.AUTH_TOKEN) return next();
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${config.AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

