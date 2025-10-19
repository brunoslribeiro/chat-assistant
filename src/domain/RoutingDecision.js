import { VALID_CANDIDATES, SALESFORCE_QUEUE_BY_CANDIDATE } from './RoutingCatalog.js';

export function buildDecisionFromEmitRouting(args) {
  const { display_text, route, next_steps, questions_needed } = args || {};
  let resolvedQueue = null;
  if (route?.candidate_id && VALID_CANDIDATES.has(route.candidate_id) && route.abstain === false) {
    resolvedQueue = SALESFORCE_QUEUE_BY_CANDIDATE[route.candidate_id] || null;
  }
  return {
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
}


