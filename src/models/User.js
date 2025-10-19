import { mongoose } from '../db/mongoose.js';

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, index: true, required: true },
  name: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin','curator'], default: 'admin' },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false, minimize: true });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);

