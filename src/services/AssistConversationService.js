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
      if (state.status === 'requires_action' && state.required_action?.type === 'submit_tool_outputs') {
        const { outputs, decision } = buildToolOutputsFromState(state);
        if (outputs.length) {
          await submitToolOutputs({ openaiThreadId, runId, outputs, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
        }
        if (decision) lastDecision = decision;
      } else {
        await sleep(this.config.ASSIST_POLL_MS);
      }
      state = await fetchRun({ openaiThreadId, runId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    }
    return { finalState: state, lastDecision };
  }

  async fetchFinalReply(openaiThreadId, lastDecision) {
    let replyText = await fetchLatestAssistantText({ openaiThreadId, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
    if ((!replyText || !replyText.trim()) && lastDecision?.display_text) replyText = lastDecision.display_text;
    return replyText || '';
  }

  async persistArtifacts(threadId, openaiThreadId, replyText, decision) {
    await this.messages.createAssistantMessage(threadId, replyText);
    await this.decisions.saveDecision(threadId, openaiThreadId, decision);
  }

  // Streaming helpers
  handleStreamEventFactory({ res, accum, openaiThreadId }) {
    return async (evt, data) => {
      const commands = StreamEventInterpreter.interpret(evt, data);
      for (const cmd of commands) {
        if (cmd.type === 'delta') {
          accum.text += cmd.text;
          this.sse.send(res, 'delta', { text: cmd.text });
        } else if (cmd.type === 'submit_tool_outputs') {
          await submitToolOutputs({ openaiThreadId, runId: data?.id || data?.run_id, outputs: cmd.outputs, OPENAI_API_KEY: this.config.OPENAI_API_KEY });
        } else if (cmd.type === 'decision') {
          accum.decision = cmd.decision;
          this.sse.send(res, 'decision', cmd.decision);
        } else if (cmd.type === 'complete') {
          await this.persistArtifacts(accum.threadId, openaiThreadId, accum.text, accum.decision);
          this.sse.send(res, 'completed', { reply: accum.text || accum.decision?.display_text || '' });
          res.end();
        } else if (cmd.type === 'error') {
          this.sse.send(res, 'error', { error: cmd.error });
        }
      }
    };
  }

  wireOpenAIStream({ stream, res, accum, openaiThreadId }) {
    this.sse.wire({
      stream,
      onEvent: this.handleStreamEventFactory({ res, accum, openaiThreadId }),
      onCompleted: () => {
        if (!res.writableEnded) {
          this.sse.send(res, 'completed', { reply: accum.text || accum.decision?.display_text || '' });
          res.end();
        }
      },
      onError: (err) => {
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
}
