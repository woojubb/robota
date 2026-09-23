import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

const LOOP_LIFETIME_MS = 7 * 24 * 60 * 60_000;

/** A legacy loop uses its original start time; re-arm never extends its lifetime. */
export function sessionLoopExpiry(
  task: Pick<IBackgroundTaskState, 'metadata' | 'startedAt'>,
): number | undefined {
  if (task.metadata?.['sessionLoop'] !== true) return undefined;
  const explicit = task.metadata['sessionLoopExpiresAt'];
  if (explicit !== undefined) {
    return typeof explicit === 'string' ? Date.parse(explicit) : NaN;
  }
  return task.startedAt ? Date.parse(task.startedAt) + LOOP_LIFETIME_MS : NaN;
}

export function sessionLoopBlockReason(
  task: Pick<IBackgroundTaskState, 'metadata' | 'startedAt'> | undefined,
  nowMs: number,
  disabled: boolean,
): 'disabled' | 'expired' | null {
  if (task?.metadata?.['sessionLoop'] !== true) return null;
  const expiry = sessionLoopExpiry(task);
  if (expiry === undefined || !Number.isFinite(expiry) || expiry <= nowMs) return 'expired';
  return disabled ? 'disabled' : null;
}

/** An aligned slot is neither a missed nor a runnable loop wake before its first eligible instant. */
export function sessionLoopFirstWakeEligibility(
  task: Pick<IBackgroundTaskState, 'metadata'> | undefined,
  atMs: number,
): 'eligible' | 'early' | 'invalid' {
  if (task?.metadata?.['sessionLoop'] !== true) return 'eligible';
  const value = task.metadata['sessionLoopFirstAllowedAt'];
  if (value === undefined) return 'eligible';
  const firstAllowedMs = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(firstAllowedMs)) return 'invalid';
  return atMs < firstAllowedMs ? 'early' : 'eligible';
}

export function validatedSessionLoopExpiry(value: string | undefined, nowMs: number): string {
  if (value === undefined) return new Date(nowMs + LOOP_LIFETIME_MS).toISOString();
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= nowMs || expiry > nowMs + LOOP_LIFETIME_MS) {
    throw new Error('Session loop expiry is invalid, expired, or later than seven days.');
  }
  return new Date(expiry).toISOString();
}
