/**
 * #3282 §4 part b-3 — the Agents panel's Goal row: the objective, and its status in plain words.
 */

import type { IGoalState } from '@robota-sdk/agent-interface-session';

const STOP_REASON_LABELS: Record<NonNullable<IGoalState['stopReason']>, string> = {
  satisfied: 'Satisfied',
  'max-iterations': 'Stopped — reached the iteration limit',
  cancelled: 'Cancelled',
  'no-progress': 'Stopped — no progress',
};

/** The goal's status in plain words — never the raw `status`/`stopReason` identifiers. */
export function describeGoalStatus(goal: IGoalState): string {
  if (goal.status === 'active') return 'Active';
  if (goal.status === 'satisfied') return 'Satisfied';
  return goal.stopReason ? STOP_REASON_LABELS[goal.stopReason] : 'Stopped';
}
