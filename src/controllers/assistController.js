import { config } from '../config/env.js';
import { v4 as uuidv4 } from 'uuid';
import { Message } from '../models/Message.js';
import { Decision } from '../models/Decision.js';
import { MessageService } from '../services/MessageService.js';
import { DecisionService } from '../services/DecisionService.js';
import { SSEService } from '../services/SSEService.js';
import { AssistConversationService } from '../services/AssistConversationService.js';

// Instantiate services once per process
const messageService = new MessageService({ MessageModel: Message });
const decisionService = new DecisionService({ DecisionModel: Decision });
const sseService = new SSEService();
const assistService = new AssistConversationService({ messageService, decisionService, sseService, config });

// POST /assist/reply — a small story in steps
export async function postAssistReply(req, res) {
  try {
    assistService.ensureAssistantConfigured(config.OPENAI_ASSISTANT_ID);
    let { threadId, latestUserInput } = req.body || {};
    if (!threadId || !String(threadId).trim()) {
      threadId = uuidv4();
    }
    // Keep defaults configurable for environments that prefer the safer full reply path.
    const fast = config.REPLY_FAST_DEFAULT;
    const flat = config.REPLY_FLAT_DEFAULT;

    await messageService.createUserMessage(threadId, latestUserInput);
    const openaiThreadId = await assistService.ensureThread(threadId);

    if (latestUserInput?.trim()) {
      await assistService.cancelActiveRun(openaiThreadId);
      await assistService.sendUserMessage(openaiThreadId, latestUserInput);
    }

    if (fast) {
      // Use streaming under the hood for faster first-decision response
      const { decision, text } = await assistService.fastDecisionViaStream(openaiThreadId, threadId);
      let replyText = decision?.display_text || text || '';
      if (!replyText.trim()) {
        replyText = await assistService.fetchFinalReply(openaiThreadId, decision || null);
      }
      await assistService.persistArtifacts(threadId, openaiThreadId, replyText, decision || null);
      if (flat) {
        const payload = assistService.buildSSEPayload(threadId, decision || {});
        return res.json({ ...payload, reply: replyText || payload.display_text || '' });
      }
      return res.json({ threadId, openaiThreadId, reply: replyText, decision: decision || null });
    }

    const runId = await assistService.startRun(openaiThreadId);
    const { lastDecision } = await assistService.pollUntilSettled(openaiThreadId, runId);
    const replyText = await assistService.fetchFinalReply(openaiThreadId, lastDecision);
    await assistService.persistArtifacts(threadId, openaiThreadId, replyText, lastDecision);
    if (flat) {
      const payload = assistService.buildSSEPayload(threadId, lastDecision || {});
      return res.json({ ...payload, reply: replyText || payload.display_text || '' });
    }
    res.json({ threadId, openaiThreadId, reply: replyText || '', decision: lastDecision || null });
  } catch (e) {
    const status = e?.status || 500;
    if (status >= 500) console.error('/assist/reply error', e?.response?.status, e?.response?.data || e);
    res.status(status).json({ error: status === 400 ? e.message : 'assist_failed', detail: e?.response?.data || String(e) });
  }
}

// GET /assist/stream — stream the story as it happens
export async function getAssistStream(req, res) {
  try {
    assistService.ensureAssistantConfigured(config.OPENAI_ASSISTANT_ID);
    const isPost = req.method === 'POST';
    let threadId = String((isPost ? (req.body?.threadId) : req.query.threadId) || '').trim();
    const latestUserInput = isPost
      ? (typeof req.body?.latestUserInput === 'string' ? req.body.latestUserInput : '')
      : (typeof req.query.latestUserInput === 'string' ? req.query.latestUserInput : '');
    if (!threadId) {
      threadId = uuidv4();
    }

    sseService.init(res);
    const openaiThreadId = await assistService.ensureThread(threadId);
    // Informe imediatamente o identificador ao cliente para futuras chamadas
    sseService.send(res, 'thread', { threadId, openaiThreadId });

    if (latestUserInput?.trim()) {
      await assistService.cancelActiveRun(openaiThreadId);
      await messageService.createUserMessage(threadId, latestUserInput);
      await assistService.sendUserMessage(openaiThreadId, latestUserInput);
    }

    const streamResp = await assistService.openaiStreamRun(openaiThreadId);
    const accum = { text: '', decision: null, threadId };
    assistService.wireOpenAIStream({ stream: streamResp.data, res, accum, openaiThreadId });
  } catch (e) {
    if (!res.headersSent) {
      const status = e?.status || 500;
      return res.status(status).json({ error: status === 400 ? e.message : 'assist_stream_failed', detail: e?.response?.data || String(e) });
    }
    try {
      sseService.send(res, 'error', { error: String(e) });
    } finally {
      res.end();
    }
  }
}
