import { mongoose } from '../db/mongoose.js';
import { v4 as uuidv4 } from 'uuid';

const MessageSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  threadId: { type: String, index: true, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false, minimize: true });

MessageSchema.index({ threadId: 1, createdAt: 1 });
// Enable full-text search over message content for audit queries
try { MessageSchema.index({ content: 'text' }); } catch {}

export const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
