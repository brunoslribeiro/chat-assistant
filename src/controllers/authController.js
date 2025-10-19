import { User } from '../models/User.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { createSessionToken, setSessionCookie, clearSessionCookie } from '../utils/session.js';

export async function register(req, res) {
  try {
    const count = await User.countDocuments();
    if (count > 0) return res.status(403).json({ error: 'register_disabled' });
    const { email, name, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ error: 'email_in_use' });
    const passwordHash = hashPassword(password);
    const user = await User.create({ email, name: name||'', passwordHash, role: 'admin' });
    const token = createSessionToken({ sub: user.id, role: user.role, email: user.email, name: user.name });
    setSessionCookie(res, token);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (e) {
    res.status(500).json({ error: 'register_failed', detail: String(e) });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = createSessionToken({ sub: user.id, role: user.role, email: user.email, name: user.name });
    setSessionCookie(res, token);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (e) {
    res.status(500).json({ error: 'login_failed', detail: String(e) });
  }
}

export async function me(req, res) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role });
}

export async function logout(_req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function changePassword(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current_and_new_required' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const ok = verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_current_password' });
    user.passwordHash = hashPassword(newPassword);
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'change_password_failed', detail: String(e) });
  }
}

