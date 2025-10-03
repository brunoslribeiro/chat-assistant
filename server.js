import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { ThreadMap } from './ThreadMap.js';
import { Decision } from './Decision.js';
import { VALID_CANDIDATES, SALESFORCE_QUEUE_BY_CANDIDATE } from './catalog.js';
import {
  getOrCreateOAThread,
  addUserMessageToOAThread,
  runAssistant,
  fetchRun,
  submitToolOutputs,
  fetchLatestAssistantText,
  waitUntilNoActiveRun,
  listRuns,
  cancelRun
} from './helpers/assistants.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatdb';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 50);
const MAX_CHARS = Number(process.env.MAX_CHARS || 16000);
const TTL_HOURS = Number(process.env.TTL_HOURS || 0);

const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const ASSIST_POLL_MS = Number(process.env.ASSIST_POLL_MS || 800);
const ASSIST_POLL_TIMEOUT_MS = Number(process.env.ASSIST_POLL_TIMEOUT_MS || 20000);

if (!OPENAI_API_KEY) {
  console.error('Faltou OPENAI_API_KEY no .env');
  process.exit(1);
}

function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) return next();
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

await mongoose.connect(MONGODB_URI, { autoIndex: true });

const MessageSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  threadId: { type: String, index: true, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  externalId: { type: String },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: undefined, index: TTL_HOURS > 0 ? { expireAfterSeconds: 0 } : undefined }
}, { versionKey: false, minimize: true });

MessageSchema.index({ threadId: 1, createdAt: 1 });
const Message = mongoose.model('Message', MessageSchema);

function calcExpiresAt() {
  if (!TTL_HOURS || TTL_HOURS <= 0) return undefined;
  const ms = TTL_HOURS * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

async function buildContext(threadId) {
  const rows = await Message.find({ threadId }).sort({ createdAt: -1 }).limit(MAX_MESSAGES).lean();
  const chrono = rows.slice().reverse();
  let total = 0;
  const chosen = [];
  for (let i = chrono.length - 1; i >= 0; i--) {
    const msg = chrono[i];
    const len = (msg.content || '').length;
    if (total + len > MAX_CHARS) break;
    total += len;
    chosen.unshift(msg);
  }
  return chosen.length ? chosen : chrono;
}

async function insertMessage({ threadId, role, content, externalId }) {
  return Message.create({
    threadId,
    role,
    content,
    externalId: externalId || undefined,
    expiresAt: calcExpiresAt()
  });
}

app.get('/health', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  res.json({ ok: true, mongo: mongoOk ? 'up' : 'down' });
});

app.post('/messages', requireAuth, async (req, res) => {
  try {
    const { threadId, role, content, externalId } = req.body || {};
    if (!threadId || !role || !content) {
      return res.status(400).json({ error: 'threadId, role, content são obrigatórios' });
    }
    if (!['user','assistant','system'].includes(role)) {
      return res.status(400).json({ error: 'role inválido' });
    }
    const doc = await insertMessage({ threadId: String(threadId), role, content: String(content), externalId });
    res.status(201).json({ id: doc._id });
  } catch (e) {
    console.error('POST /messages error', e);
    res.status(500).json({ error: 'insert_failed' });
  }
});

app.get('/threads/:threadId', requireAuth, async (req, res) => {
  const { threadId } = req.params;
  const messages = await Message.find({ threadId }).sort({ createdAt: 1 }).lean();
  res.json({ threadId, messages });
});

app.post('/reply', requireAuth, async (req, res) => {
  try {
    const { threadId, latestUserInput, systemPrompt } = req.body || {};
    if (!threadId) return res.status(400).json({ error: 'threadId é obrigatório' });
    if (latestUserInput && latestUserInput.trim()) {
      await insertMessage({ threadId: String(threadId), role: 'user', content: String(latestUserInput) });
    }
    const context = await buildContext(String(threadId));
    const messages = [{ role: 'system', content: systemPrompt?.trim() || 'Você é um assistente útil, direto e educado. Responda em português do Brasil.' }];
    for (const m of context) {
      messages.push({ role: m.role, content: m.content });
    }
    const payload = { model: OPENAI_MODEL, messages, temperature: 0.3 };
    const rsp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
    });
    const content = rsp?.data?.choices?.[0]?.message?.content || '';
    if (content) await insertMessage({ threadId: String(threadId), role: 'assistant', content });
    res.json({ threadId, reply: content });
  } catch (err) {
    console.error('OpenAI error', err?.response?.status, err?.response?.data || err);
    res.status(500).json({ error: 'openai_failed', detail: err?.response?.data || String(err) });
  }
});

app.post('/assist/reply', requireAuth, async (req, res) => {
  try {
    if (!OPENAI_ASSISTANT_ID) return res.status(400).json({ error: 'assistant_not_configured' });
    const { threadId, latestUserInput } = req.body || {};
    if (!threadId) return res.status(400).json({ error: 'threadId é obrigatório' });

    if (latestUserInput && latestUserInput.trim()) {
      await insertMessage({ threadId: String(threadId), role: 'user', content: String(latestUserInput) });
    }

    const openaiThreadId = await getOrCreateOAThread({ threadId: String(threadId), OPENAI_API_KEY });

    if (latestUserInput && latestUserInput.trim()) {
      const wait = await waitUntilNoActiveRun({
        openaiThreadId, OPENAI_API_KEY, pollMs: ASSIST_POLL_MS, timeoutMs: ASSIST_POLL_TIMEOUT_MS
      });
      if (!wait.ok) {
        const runs = await listRuns({ openaiThreadId, OPENAI_API_KEY, limit: 1 });
        const latest = runs[0];
        if (latest && ["queued","in_progress","requires_action"].includes(latest.status)) {
          await cancelRun({ openaiThreadId, runId: latest.id, OPENAI_API_KEY });
        }
      }
      await addUserMessageToOAThread({ openaiThreadId, content: String(latestUserInput), OPENAI_API_KEY });
    }

    const runId = await runAssistant({ openaiThreadId, assistantId: OPENAI_ASSISTANT_ID, OPENAI_API_KEY });

    const active = new Set(["queued","in_progress","requires_action"]);
    let state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY });
    let lastDecision = null;

    const deadline = Date.now() + ASSIST_POLL_TIMEOUT_MS;
    while (Date.now() < deadline && active.has(state.status)) {
      if (state.status === 'requires_action' && state.required_action?.type === 'submit_tool_outputs') {
        const outputs = [];
        for (const tc of state.required_action.submit_tool_outputs.tool_calls) {
          if (tc.function.name === 'emit_routing') {
            const args = JSON.parse(tc.function.arguments || '{}');
            const { display_text, route, next_steps, questions_needed } = args;
            let resolvedQueue = null;
            if (route?.candidate_id && VALID_CANDIDATES.has(route.candidate_id) && route.abstain === false) {
              resolvedQueue = SALESFORCE_QUEUE_BY_CANDIDATE[route.candidate_id] || null;
            }
            lastDecision = {
              ok: Boolean(resolvedQueue) || !!route?.abstain,
              candidate_id: route?.candidate_id || null,
              confidence: route?.confidence ?? 0,
              abstain: !!route?.abstain,
              rationale: route?.rationale || '',
              display_text: display_text || '',
              next_steps: next_steps || [],
              questions_needed: questions_needed || [],
              salesforce_queue: resolvedQueue
            };
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(lastDecision) });
          }
        }
        await submitToolOutputs({ openaiThreadId, runId, outputs, OPENAI_API_KEY });
      } else {
        await new Promise(r => setTimeout(r, ASSIST_POLL_MS));
      }
      state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY });
    }

    // Clean reply: nunca string JSON
    let replyText = await fetchLatestAssistantText({ openaiThreadId, OPENAI_API_KEY });
    if (replyText && replyText.trim().startsWith('{') && replyText.trim().endsWith('}')) {
      try { const obj = JSON.parse(replyText); replyText = obj?.display_text || ''; } catch {}
    }
    if ((!replyText || !replyText.trim()) && lastDecision?.display_text) replyText = lastDecision.display_text;
    if (replyText) await insertMessage({ threadId: String(threadId), role: 'assistant', content: replyText });

    if (lastDecision) {
      await Decision.create({ _id: uuidv4(), threadId: String(threadId), openaiThreadId, decision: lastDecision });
    }

    res.json({ threadId, openaiThreadId, reply: replyText || '', decision: lastDecision || null });
  } catch (e) {
    console.error('/assist/reply error', e?.response?.status, e?.response?.data || e);
    res.status(500).json({ error: 'assist_failed', detail: e?.response?.data || String(e) });
  }
});

app.get('/decisions/:threadId', requireAuth, async (req, res) => {
  const { threadId } = req.params;
  const docs = await Decision.find({ threadId }).sort({ createdAt: -1 }).limit(10).lean();
  res.json({ threadId, decisions: docs });
});

app.get('/decisions', requireAuth, async (_req, res) => {
  const docs = await Decision.find().sort({ createdAt: -1 }).limit(50).lean();
  res.json({ decisions: docs });
});

app.listen(PORT, () => {
  console.log(`Chat History Service (Mongo) on :${PORT}`);
});
