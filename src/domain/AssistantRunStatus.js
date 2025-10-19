export const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "requires_action"]);

export function isRunActive(status) {
  return ACTIVE_RUN_STATUSES.has(status);
}

