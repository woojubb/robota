/**
 * What Esc on an idle prompt says after asking the session to stop its waiting self-paced loop.
 * The session decides which loop, if any, stops; both channels show its answer in the same words.
 */

import type { TWaitingLoopStopOutcome } from '@robota-sdk/agent-interface-session';

/** The reason the session records for a loop Esc stopped. */
export const WAITING_LOOP_STOP_REASON = 'Loop stopped by Esc';

/** The notice for an outcome; none when no loop was waiting. */
export function waitingLoopStopNotice(outcome: TWaitingLoopStopOutcome): string | undefined {
  switch (outcome.kind) {
    case 'none':
      return undefined;
    case 'several':
      return outcome.message;
    case 'stopped':
      return `Loop ${outcome.loopId} stopped by Esc.`;
    case 'failed':
      return outcome.message;
  }
}
