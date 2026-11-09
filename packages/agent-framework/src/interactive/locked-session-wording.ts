/**
 * How every surface words a sealed session that does not open in this process, by why: only locked
 * keys are something an unlock fixes, so only they are ever worded with one.
 */
import type { TSessionLockedReason } from '@robota-sdk/agent-interface/session';

/** Why a sealed session does not open here: `locked` when the keys being locked is all that stands in the way. */
export type TLockedSessionReason = 'locked' | TSessionLockedReason;

/** The reason a `locked` load outcome gives, an outcome with none being locked keys. */
export function lockedReasonOf(outcome: {
  readonly reason?: TSessionLockedReason;
}): TLockedSessionReason {
  return outcome.reason ?? 'locked';
}

/** What stands in the way, to follow "it is" or "the stored record is"; any unlock hint is the caller's, for `locked` only. */
export function sealedSessionState(reason: TLockedSessionReason): string {
  switch (reason) {
    case 'no-keys':
      return 'sealed with keys this process does not have';
    case 'changed':
      return 'sealed, and its file changed after this process read it';
    default:
      return 'sealed and locked';
  }
}
