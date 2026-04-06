import {
  getOrCreateOAThread,
  addUserMessageToOAThread,
  runAssistant,
  openaiStreamRun,
  fetchRun,
  submitToolOutputs,
  fetchLatestAssistantText,
  cancelLatestActiveRunIfAny
} from '../clients/OpenAIAssistantsClient.js';
import { buildToolOutputsFromState, StreamEventInterpreter } from '../domain/AssistantsDomain.js';
import { isRunActive } from '../domain/AssistantRunStatus.js';
import { sleep } from '../utils/time.js';
import { isDebug, dlog } from '../utils/debug.js';

export class AssistConversationService {
  constructor({ messageService, decisionService, sseService, config }) {
    this.messages = messageService;
    this.decisions = decisionService;
    this.sse = sseService;
    this.config = config;
  }

  ensureAssistantConfigured(assistantId) {
    if (!assistantId) {
      const err = new Error('assistant_not_configured');
      err.status = 400;
      throw err;
    }
  }

  async ensureThread(threadId) {
    return getOrCreateOAThread({ threadId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
  }

  async cancelActiveRun(openaiThreadId) {
    return cancelLatestActiveRunIfAny({ openaiThreadId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
  }

  async sendUserMessage(openaiThreadId, latestUserInput) {
    if (latestUserInput?.trim()) {
      await addUserMessageToOAThread({ openaiThreadId, content: latestUserInput, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    }
  }

  async startRun(openaiThreadId) {
    return runAssistant({ openaiThreadId, assistantId: this.config.OPENAI_ASSISTANT_ID, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
  }

  async pollUntilSettled(openaiThreadId, runId) {
    let state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    let lastDecision = null;
    const deadline = Date.now() + this.config.ASSIST_POLL_TIMEOUT_MS;

    while (Date.now() < deadline && isRunActive(state.status)) {
      if (isDebug('DEBUG_RUN')) dlog('DEBUG_RUN', '[run]', runId, 'status=', state.status);
      if (state.status === 'requires_action' && state.required_action?.type === 'submit_tool_outputs') {
        const { outputs, decision } = buildToolOutputsFromState(state);
        if (isDebug('DEBUG_RUN')) dlog('DEBUG_RUN', '[run]', runId, 'requires_action outputs=', outputs.length);
        if (outputs.length) {
          await submitToolOutputs({ openaiThreadId, runId, outputs, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
        }
        if (decision) lastDecision = decision;
      } else {
        await sleep(this.config.ASSIST_POLL_MS);
      }
      state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    }
    if (isDebug('DEBUG_RUN')) dlog('DEBUG_RUN', '[run]', runId, 'final status=', state.status);
    return { finalState: state, lastDecision };
  }

  // Poll until a routing decision is available (requires_action emit_routing), or timeout
  async pollUntilDecision(openaiThreadId, runId) {
    let state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    const deadline = Date.now() + this.config.ASSIST_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (state.status === 'requires_action' && state.required_action?.type === 'submit_tool_outputs') {
        const { outputs, decision } = buildToolOutputsFromState(state);
        if (outputs.length) {
          await submitToolOutputs({ openaiThreadId, runId, outputs, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
        }
        return { decision: decision || null, state };
      }
      if (!isRunActive(state.status)) return { decision: null, state };
      await sleep(this.config.ASSIST_POLL_MS);
      state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    }
    return { decision: null, state };
  }

  async fetchFinalReply(openaiThreadId, lastDecision) {
    let replyText = await fetchLatestAssistantText({ openaiThreadId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    if ((!replyText || !replyText.trim()) && lastDecision?.display_text) replyText = lastDecision.display_text;
    return replyText || '';
  }

  async persistArtifacts(threadId, openaiThreadId, replyText, decision) {
    let text = replyText || '';
    if (!text.trim() && decision?.display_text) {
      text = decision.display_text;
    }
    // Some environments may have mistakenly passed a JSON decision as reply.
    // If it looks like JSON and contains display_text, use it.
    try {
      if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
        const obj = JSON.parse(text);
        if (obj && typeof obj.display_text === 'string' && obj.display_text.trim()) {
          text = obj.display_text.trim();
        }
      }
    } catch {}
    await this.messages.createAssistantMessage(threadId, text);
    await this.decisions.saveDecision(threadId, openaiThreadId, decision);
  }

  // Build a normalized payload matching external expectations
  buildSSEPayload(threadId, decision) {
    return {
      threadId,
      display_text: decision?.display_text || '',
      candidate_id: decision?.candidate_id || null,
      confidence: decision?.confidence ?? 0,
      abstain: !!(decision?.abstain),
      rationale: decision?.rationale || '',
      next_steps: decision?.next_steps || [],
      questions_needed: decision?.questions_needed || []
    };
  }

  // Streaming helpers
  handleStreamEventFactory({ res, accum, openaiThreadId }) {
    return async (evt, data) => {
      if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] event=', evt, 'payloadKeys=', Object.keys(data || {}));
      const commands = StreamEventInterpreter.interpret(evt, data);
      for (const cmd of commands) {
        if (cmd.type === 'delta') {
          accum.text += cmd.text;
          this.sse.send(res, 'delta', { text: cmd.text });
        } else if (cmd.type === 'submit_tool_outputs') {
          if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] submit_tool_outputs count=', cmd.outputs?.length || 0);
          await submitToolOutputs({ openaiThreadId, runId: data?.id || data?.run_id, outputs: cmd.outputs, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
        } else if (cmd.type === 'decision') {
          if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] decision received');
          accum.decision = cmd.decision;
          const payload = this.buildSSEPayload(accum.threadId, accum.decision);
          this.sse.send(res, 'decision', payload);
        } else if (cmd.type === 'complete') {
          if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] complete. textLen=', (accum.text || '').length);
          await this.persistArtifacts(accum.threadId, openaiThreadId, accum.text, accum.decision);
          {
            const base = this.buildSSEPayload(accum.threadId, accum.decision);
            const reply = (accum.text && accum.text.trim()) ? accum.text : base.display_text;
            this.sse.send(res, 'completed', { ...base, reply: reply || '' });
          }
          res.end();
        } else if (cmd.type === 'error') {
          if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] error event');
          this.sse.send(res, 'error', { error: cmd.error });
        }
      }
    };
  }

  wireOpenAIStream({ stream, res, accum, openaiThreadId }) {
    this.sse.wire({
      stream,
      onEvent: this.handleStreamEventFactory({ res, accum, openaiThreadId }),
      onCompleted: async () => {
        if (!res.writableEnded) {
          try {
            // Fallback: if no deltas arrived, fetch latest assistant text
            if (!accum.text?.trim()) {
              if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] fallback fetching final text');
              const finalText = await this.fetchFinalReply(openaiThreadId, accum.decision);
              if (finalText) {
                accum.text = finalText;
              }
            }
            await this.persistArtifacts(accum.threadId, openaiThreadId, accum.text, accum.decision);
          } finally {
            const base = this.buildSSEPayload(accum.threadId, accum.decision);
            const reply = (accum.text && accum.text.trim()) ? accum.text : base.display_text;
            this.sse.send(res, 'completed', { ...base, reply: reply || '' });
            res.end();
          }
        }
      },
      onError: (err) => {
        if (isDebug('DEBUG_SSE')) dlog('DEBUG_SSE', '[sse] stream error', String(err));
        if (!res.writableEnded) {
          this.sse.send(res, 'error', { error: String(err) });
          res.end();
        }
      }
    });
  }

  async openaiStreamRun(openaiThreadId) {
    return openaiStreamRun({ openaiThreadId, assistantId: this.config.OPENAI_ASSISTANT_ID, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
  }

  // Fast path: start a streaming run and resolve as soon as a routing decision appears
  async fastDecisionViaStream(openaiThreadId, threadId) {
    const streamResp = await this.openaiStreamRun(openaiThreadId);
    const stream = streamResp.data;
    const accum = { text: '', decision: null };

    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (decision) => {
        if (settled) return;
        settled = true;
        try { if (stream && typeof stream.destroy === 'function') stream.destroy(); } catch {}
        resolve({ decision: decision || null, text: accum.text || '' });
      };

      const onEvent = async (evt, data) => {
        const commands = StreamEventInterpreter.interpret(evt, data);
        for (const cmd of commands) {
          if (cmd.type === 'delta') {
            accum.text += cmd.text;
          } else if (cmd.type === 'submit_tool_outputs') {
            // Best-effort: submit outputs to keep the run moving
            await submitToolOutputs({
              openaiThreadId,
              runId: data?.id || data?.run_id,
              outputs: cmd.outputs,
              OPENAI_API_KEY: this.config.OPENAI_API_KEY
            });
          } else if (cmd.type === 'decision') {
            accum.decision = cmd.decision;
            // Resolve immediately with decision
            finish(accum.decision);
          } else if (cmd.type === 'complete') {
            // No decision seen; resolve with whatever text we have
            finish(accum.decision);
          } else if (cmd.type === 'error') {
            if (!settled) {
              settled = true;
              reject(new Error(String(cmd.error)));
            }
          }
        }
      };

      this.sse.wire({
        stream,
        onEvent,
        onCompleted: () => finish(accum.decision),
        onError: (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      });
    });
  }
}
