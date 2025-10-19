import { mongoose } from '../db/mongoose.js';

export function health(req, res) {
  const mongoOk = mongoose.connection.readyState === 1;
  res.json({ ok: true, mongo: mongoOk ? 'up' : 'down' });
}

