import { BackgroundTaskError } from './types.js';

import type { TBackgroundTaskStatus } from './types.js';

export type TBackgroundTaskTransitionEvent =
  | 'START'
  | 'REQUEST_PERMISSION'
  | 'PERMISSION_ALLOWED'
  | 'PERMISSION_DENIED'
  | 'COMPLETE'
  | 'FAIL'
  | 'CANCEL'
  | 'SLEEP'
  | 'WAKE'
  // SELFHOST-012: non-destructive schedule lifecycle (distinct from the irreversible CANCEL).
  | 'PAUSE'
  | 'RESUME';

interface IBackgroundTaskTransition {
  from: TBackgroundTaskStatus;
  event: TBackgroundTaskTransitionEvent;
  to: TBackgroundTaskStatus;
}

const TERMINAL_STATUSES = new Set<TBackgroundTaskStatus>(['completed', 'failed', 'cancelled']);

const TRANSITIONS: readonly IBackgroundTaskTransition[] = [
  { from: 'queued', event: 'START', to: 'running' },
  { from: 'queued', event: 'CANCEL', to: 'cancelled' },
  { from: 'running', event: 'REQUEST_PERMISSION', to: 'waiting_permission' },
  { from: 'running', event: 'COMPLETE', to: 'completed' },
  { from: 'running', event: 'FAIL', to: 'failed' },
  { from: 'running', event: 'CANCEL', to: 'cancelled' },
  { from: 'running', event: 'SLEEP', to: 'sleeping' },
  { from: 'waiting_permission', event: 'PERMISSION_ALLOWED', to: 'running' },
  { from: 'waiting_permission', event: 'PERMISSION_DENIED', to: 'failed' },
  { from: 'waiting_permission', event: 'CANCEL', to: 'cancelled' },
  { from: 'sleeping', event: 'WAKE', to: 'running' },
  { from: 'sleeping', event: 'CANCEL', to: 'cancelled' },
  // SELFHOST-012: non-destructive pause/resume for scheduled tasks. `paused` is non-terminal; a paused
  // schedule does not fire (croner `.pause()`), and RESUME returns it to `sleeping` (re-armed).
  { from: 'sleeping', event: 'PAUSE', to: 'paused' },
  { from: 'running', event: 'PAUSE', to: 'paused' },
  { from: 'paused', event: 'RESUME', to: 'sleeping' },
  { from: 'paused', event: 'CANCEL', to: 'cancelled' },
];

export function isTerminalBackgroundTaskStatus(status: TBackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function transitionBackgroundTaskStatus(
  status: TBackgroundTaskStatus,
  event: TBackgroundTaskTransitionEvent,
): TBackgroundTaskStatus {
  const transition = TRANSITIONS.find((entry) => entry.from === status && entry.event === event);
  if (transition) return transition.to;

  const reason = isTerminalBackgroundTaskStatus(status) ? 'terminal status' : 'unsupported event';
  throw new BackgroundTaskError(
    'validation',
    `Invalid background task transition: ${status} + ${event} (${reason})`,
  );
}

export function getBackgroundTaskTransitions(): readonly IBackgroundTaskTransition[] {
  return TRANSITIONS;
}
