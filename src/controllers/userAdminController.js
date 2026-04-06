import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';

export async function listUsers(req, res) {
  try {
    const { sort = 'createdAt', dir = 'desc' } = req.query || {};
    const allowed = new Set(['email', 'name', 'role', 'createdAt']);
    const field = allowed.has(String(sort)) ? String(sort) : 'createdAt';
    const direction = String(dir).toLowerCase() === 'asc' ? 1 : -1;
    const users = await User.find({}, { email: 1, name: 1, role: 1, createdAt: 1 }).sort({ [field]: direction }).lean();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: 'list_users_failed', detail: String(e) });
  }
}

export async function createUser(req, res) {
  try {
    const { email, name = '', role = 'curator', password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    if (!['admin','curator'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ error: 'email_in_use' });
    const passwordHash = hashPassword(password);
    const user = await User.create({ email, name, role, passwordHash });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt });
  } catch (e) {
    res.status(500).json({ error: 'create_user_failed', detail: String(e) });
  }
}

export async function resetUserPassword(req, res) {
  try {
    const { id } = req.params;
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'new_password_required' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    user.passwordHash = hashPassword(newPassword);
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'reset_password_failed', detail: String(e) });
  }
}
