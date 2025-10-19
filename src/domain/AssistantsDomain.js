import { buildDecisionFromEmitRouting } from './RoutingDecision.js';

export function buildToolOutputsFromState(state) {
  const outputs = [];
  let lastDecision = null;
  const toolCalls = state?.required_action?.submit_tool_outputs?.tool_calls || [];
  for (const tc of toolCalls) {
    if (tc?.function?.name === 'emit_routing') {
      const args = JSON.parse(tc.function.arguments || '{}');
      const decision = buildDecisionFromEmitRouting(args);
      lastDecision = decision;
      outputs.push({ tool_call_id: tc.id, output: JSON.stringify(decision) });
    }
  }
  return { outputs, decision: lastDecision };
}

export function extractTextChunksFromDelta(data) {
  const parts = data?.delta?.content || [];
  const chunks = [];
  for (const p of parts) {
    const chunk = p?.text?.value || '';
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

// Domain-only interpreter: returns commands, no I/O here
export class StreamEventInterpreter {
  static interpret(evt, data) {
    if (evt === 'thread.message.delta' || evt === 'message.delta') {
      const chunks = extractTextChunksFromDelta(data);
      return chunks.map(text => ({ type: 'delta', text }));
    }
    if (evt === 'thread.run.requires_action') {
      const { outputs, decision } = buildToolOutputsFromState(data);
      const cmds = [];
      // Priorizar disponibilizar a decisão para a UI antes de I/O na OpenAI
      if (decision) cmds.push({ type: 'decision', decision });
      if (outputs.length) cmds.push({ type: 'submit_tool_outputs', outputs });
      return cmds;
    }
    if (evt === 'thread.message.completed' || evt === 'message.completed') {
      return [{ type: 'noop' }];
    }
    if (evt === 'thread.run.completed' || evt === 'run.completed' || evt === 'done') {
      return [{ type: 'complete' }];
    }
    if (evt === 'error') {
      return [{ type: 'error', error: data }];
    }
    return [{ type: 'noop' }];
  }
}
