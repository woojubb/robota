import type { TBackgroundTaskStatus } from './types.js';
import { BackgroundTaskError } from './types.js';

export type TBackgroundTaskTransitionEvent =
  | 'START'
  | 'REQUEST_PERMISSION'
  | 'PERMISSION_ALLOWED'
  | 'PERMISSION_DENIED'
  | 'COMPLETE'
  | 'FAIL'
  | 'CANCEL'
  | 'SLEEP'
  | 'WAKE';

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
