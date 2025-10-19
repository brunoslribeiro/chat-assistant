import { mongoose } from '../db/mongoose.js';
const ThreadMapSchema = new mongoose.Schema({
  threadId: { type: String, unique: true, index: true },
  openaiThreadId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
export const ThreadMap = mongoose.models.ThreadMap || mongoose.model('ThreadMap', ThreadMapSchema);
