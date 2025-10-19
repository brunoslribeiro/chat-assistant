import { httpClient as axios } from './HttpClient.js';
import { ThreadMap } from '../models/ThreadMap.js';

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

export async function openaiStreamRun({ openaiThreadId, assistantId, OPENAI_API_KEY }) {
  const url = `https://api.openai.com/v1/threads/${openaiThreadId}/runs`;
  return axios.post(url, { assistant_id: assistantId, stream: true }, {
    headers: { ...baseHeaders(OPENAI_API_KEY), Accept: 'text/event-stream' },
    responseType: 'stream'
  });
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
  const resp = await axios.get(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
    headers: baseHeaders(OPENAI_API_KEY),
    params: { limit: 50, order: 'desc' }
  });
  const data = resp?.data?.data || [];
  const assistantMsg = data.find(m => m.role === 'assistant');
  if (!assistantMsg) return '';
  const parts = Array.isArray(assistantMsg.content) ? assistantMsg.content : [];
  for (const part of parts) {
    const val = part?.text?.value || '';
    if (typeof val === 'string' && val.trim()) return val;
  }
  return '';
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

// Best-effort: check once and cancel active run without long waiting
export async function cancelLatestActiveRunIfAny({ openaiThreadId, OPENAI_API_KEY }) {
  const active = new Set(["queued","in_progress","requires_action"]);
  const r = await axios.get(
    `https://api.openai.com/v1/threads/${openaiThreadId}/runs`,
    { headers: baseHeaders(OPENAI_API_KEY), params: { limit: 1, order: 'desc' } }
  );
  const latest = (r?.data?.data || [])[0];
  if (latest && active.has(latest.status)) {
    try {
      await axios.post(
        `https://api.openai.com/v1/threads/${openaiThreadId}/runs/${latest.id}/cancel`,
        {},
        { headers: baseHeaders(OPENAI_API_KEY) }
      );
      // Small delay to let cancellation propagate
      await new Promise(res => setTimeout(res, 150));
      return { cancelled: true, runId: latest.id };
    } catch (e) {
      return { cancelled: false, runId: latest.id, error: e };
    }
  }
  return { cancelled: false, runId: null };
}
