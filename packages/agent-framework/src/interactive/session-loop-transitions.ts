/** Pure lifecycle decisions for a session-owned, self-paced repeat. Persistence is the caller's job. */

import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

const LIFETIME_MS = 7 * 24 * 60 * 60_000;
export const SELF_PACED_FALLBACK_SECONDS = 20 * 60;
const MAX_REASON_LENGTH = 280;

export type TSelfPacedLoopDecision =
  | { action: 'stop' }
  | { action: 'continue'; delaySeconds: number; reason: string };

export function createSelfPacedLoopState(
  loopId: string,
  instruction: string,
  nowMs: number,
): ISessionLoopState {
  if (!loopId.trim() || !instruction.trim() || !Number.isFinite(nowMs)) {
    throw new Error('A self-paced loop requires an ID, a prompt, and a valid creation time.');
  }
  return {
    loopId,
    instruction: instruction.trim(),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + LIFETIME_MS).toISOString(),
    revision: 0,
    generation: 0,
    phase: 'pending',
    fallbackUsed: false,
  };
}

export function claimSelfPacedLoopWake(
  state: ISessionLoopState,
  generation: number,
  nowMs: number,
): ISessionLoopState | null {
  if (
    state.phase !== 'waiting' ||
    state.generation !== generation ||
    state.nextAllowedAt === undefined ||
    nowMs < Date.parse(state.nextAllowedAt) ||
    nowMs >= Date.parse(state.expiresAt)
  ) {
    return null;
  }
  const next: ISessionLoopState = { ...state, phase: 'pending', revision: state.revision + 1 };
  delete next.nextAllowedAt;
  return next;
}

export function markSelfPacedLoopRunning(
  state: ISessionLoopState,
  generation: number,
  nowMs: number,
): ISessionLoopState | null {
  if (
    state.phase !== 'pending' ||
    state.generation !== generation ||
    nowMs >= Date.parse(state.expiresAt)
  ) {
    return null;
  }
  return { ...state, phase: 'running', revision: state.revision + 1 };
}

export function finishSelfPacedLoopTurn(
  state: ISessionLoopState,
  generation: number,
  decision: TSelfPacedLoopDecision | null,
  nowMs: number,
): ISessionLoopState | null {
  if (state.phase !== 'running' || state.generation !== generation) return null;
  if (nowMs >= Date.parse(state.expiresAt)) {
    return terminal(state, 'expired', 'seven-day-expiry');
  }
  if (decision?.action === 'stop') return terminal(state, 'stopped', 'model-stopped');

  const validChoice =
    decision?.action === 'continue' &&
    Number.isSafeInteger(decision.delaySeconds) &&
    decision.delaySeconds >= 60 &&
    decision.delaySeconds <= 3600 &&
    decision.reason.trim().length > 0 &&
    decision.reason.length <= MAX_REASON_LENGTH;
  if (!validChoice && state.fallbackUsed) {
    return terminal(state, 'stopped', 'missing-reschedule-decision');
  }

  const delaySeconds = validChoice ? decision.delaySeconds : SELF_PACED_FALLBACK_SECONDS;
  const reason = validChoice ? decision.reason.trim() : 'No valid decision; one fallback wake';
  const nextMs = nowMs + delaySeconds * 1000;
  if (nextMs >= Date.parse(state.expiresAt)) {
    return terminal(state, 'expired', 'next-wake-beyond-expiry');
  }
  return {
    ...state,
    phase: 'waiting',
    revision: state.revision + 1,
    generation: state.generation + 1,
    nextAllowedAt: new Date(nextMs).toISOString(),
    delaySeconds,
    reason,
    fallbackUsed: state.fallbackUsed || !validChoice,
  };
}

export function stopSelfPacedLoopState(
  state: ISessionLoopState,
  reason: string,
): ISessionLoopState | null {
  if (state.phase === 'stopped' || state.phase === 'expired') return null;
  return terminal(state, 'stopped', reason);
}

/** Recover intent, never replaying an iteration whose model-side effects might have happened. */
export function recoverSelfPacedLoopState(
  state: ISessionLoopState,
  nowMs: number,
): ISessionLoopState {
  if (state.phase === 'stopped' || state.phase === 'expired') return state;
  if (nowMs >= Date.parse(state.expiresAt)) {
    return terminal(state, 'expired', 'seven-day-expiry');
  }
  if (state.phase === 'waiting' && state.nextAllowedAt !== undefined) {
    if (nowMs < Date.parse(state.nextAllowedAt)) return state;
    if (state.delaySeconds === undefined) {
      return terminal(state, 'stopped', 'missing-delay-on-recovery');
    }
    return recoveredWait(state, nowMs, state.delaySeconds, state.reason ?? 'Skipped missed wake');
  }
  if (state.phase === 'pending') {
    // The queue did not survive the process; no model turn started, so fallback is not consumed.
    return recoveredWait(state, nowMs, 60, 'Recovered unstarted loop iteration');
  }
  if (state.phase === 'running') {
    // External tool effects may already have happened. Never re-run this generation.
    if (state.fallbackUsed) return terminal(state, 'stopped', 'interrupted-iteration');
    return recoveredWait(
      state,
      nowMs,
      SELF_PACED_FALLBACK_SECONDS,
      'One fallback after uncertain interrupted iteration',
      true,
    );
  }
  return terminal(state, 'stopped', 'invalid-recovery-state');
}

function recoveredWait(
  state: ISessionLoopState,
  nowMs: number,
  delaySeconds: number,
  reason: string,
  fallbackUsed = state.fallbackUsed,
): ISessionLoopState {
  const nextMs = nowMs + delaySeconds * 1000;
  if (nextMs >= Date.parse(state.expiresAt)) {
    return terminal(state, 'expired', 'next-wake-beyond-expiry');
  }
  return {
    ...state,
    phase: 'waiting',
    revision: state.revision + 1,
    generation: state.generation + 1,
    nextAllowedAt: new Date(nextMs).toISOString(),
    delaySeconds,
    reason,
    fallbackUsed,
  };
}

function terminal(
  state: ISessionLoopState,
  phase: 'stopped' | 'expired',
  reason: string,
): ISessionLoopState {
  const next: ISessionLoopState = {
    ...state,
    phase,
    revision: state.revision + 1,
    generation: state.generation + 1,
    terminalReason: reason,
  };
  delete next.nextAllowedAt;
  return next;
}
