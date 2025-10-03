import axios from 'axios';
import { ThreadMap } from '../ThreadMap.js';

const baseHeaders = (OPENAI_API_KEY) => ({
  Authorization: `Bearer ${OPENAI_API_KEY}`,
  "OpenAI-Beta": "assistants=v2"
});

export async function getOrCreateOAThread({ threadId, OPENAI_API_KEY }) {
  let map = await ThreadMap.findOne({ threadId }).lean();
  if (map?.openaiThreadId) return map.openaiThreadId;
  const thr = await axios.post('https://api.openai.com/v1/threads', {}, {
    headers: baseHeaders(OPENAI_API_KEY)
  });
  const openaiThreadId = thr?.data?.id;
  if (!openaiThreadId) throw new Error('Falha ao criar thread na OpenAI');
  await ThreadMap.create({ threadId, openaiThreadId });
  return openaiThreadId;
}

export async function addUserMessageToOAThread({ openaiThreadId, content, OPENAI_API_KEY }) {
  await axios.post(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
    role: 'user',
    content
  }, { headers: baseHeaders(OPENAI_API_KEY) });
}

export async function runAssistant({ openaiThreadId, assistantId, OPENAI_API_KEY }) {
  const run = await axios.post(`https://api.openai.com/v1/threads/${openaiThreadId}/runs`, {
    assistant_id: assistantId
  }, { headers: baseHeaders(OPENAI_API_KEY) });
  return run?.data?.id;
}

export async function fetchRun({ openaiThreadId, runId, OPENAI_API_KEY }) {
  const r = await axios.get(`https://api.openai.com/v1/threads/${openaiThreadId}/runs/${runId}`, {
    headers: baseHeaders(OPENAI_API_KEY)
  });
  return r.data;
}

export async function submitToolOutputs({ openaiThreadId, runId, outputs, OPENAI_API_KEY }) {
  await axios.post(`https://api.openai.com/v1/threads/${openaiThreadId}/runs/${runId}/submit_tool_outputs`, {
    tool_outputs: outputs
  }, { headers: baseHeaders(OPENAI_API_KEY) });
}

export async function fetchLatestAssistantText({ openaiThreadId, OPENAI_API_KEY }) {
  const msgs = await axios.get(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
    headers: baseHeaders(OPENAI_API_KEY),
    params: { limit: 10, order: 'desc' }
  });
  const assistantMsg = (msgs?.data?.data || []).find(m => m.role === 'assistant');
  const content = assistantMsg?.content?.[0]?.text?.value || '';
  return content;
}

export async function listRuns({ openaiThreadId, OPENAI_API_KEY, limit = 5 }) {
  const r = await axios.get(
    `https://api.openai.com/v1/threads/${openaiThreadId}/runs`,
    { headers: baseHeaders(OPENAI_API_KEY), params: { limit, order: 'desc' } }
  );
  return r?.data?.data || [];
}

export async function cancelRun({ openaiThreadId, runId, OPENAI_API_KEY }) {
  await axios.post(
    `https://api.openai.com/v1/threads/${openaiThreadId}/runs/${runId}/cancel`,
    {},
    { headers: baseHeaders(OPENAI_API_KEY) }
  );
}

export async function waitUntilNoActiveRun({
  openaiThreadId,
  OPENAI_API_KEY,
  pollMs = 800,
  timeoutMs = 20000
}) {
  const active = new Set(["queued","in_progress","requires_action"]);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const r = await axios.get(`https://api.openai.com/v1/threads/${openaiThreadId}/runs`, {
      headers: baseHeaders(OPENAI_API_KEY), params: { limit: 1, order: 'desc' }
    });
    const list = r?.data?.data || [];
    const latest = list[0];
    if (!latest || !active.has(latest.status)) {
      return { ok: true, latestStatus: latest?.status || "none", latestRunId: latest?.id || null };
    }
    await new Promise(res => setTimeout(res, pollMs));
  }
  return { ok: false };
}
