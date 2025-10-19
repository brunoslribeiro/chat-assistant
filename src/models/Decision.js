import { mongoose } from '../db/mongoose.js';
const DecisionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  threadId: { type: String, index: true, required: true },
  openaiThreadId: { type: String, index: true },
  decision: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false, minimize: true });

DecisionSchema.index({ threadId: 1, createdAt: -1 });
export const Decision = mongoose.models.Decision || mongoose.model('Decision', DecisionSchema);
