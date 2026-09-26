/**
 * #3189: stopping the self-paced loop that waits for its next wake (Esc on an idle prompt).
 *
 * The rule used to live in the in-process terminal, so an attached client could not apply it. It
 * belongs to the session: the session knows which loops wait, and every client gets the same answer.
 */

import type {
  ISessionLoopState,
  TWaitingLoopStopOutcome,
} from '@robota-sdk/agent-interface-session';

/** What the rule needs from the session. */
export interface IWaitingLoopPort {
  listSelfPacedLoops(): readonly ISessionLoopState[];
  stopSelfPacedLoop(loopId: string, reason: string): Promise<void>;
}

export const DEFAULT_WAITING_LOOP_STOP_REASON = 'Loop stopped by user';

/**
 * Stop the one waiting loop. With none waiting nothing happens; with several none is stopped, since
 * guessing which one the user meant could stop the wrong one, and the answer says how to choose.
 */
export async function stopWaitingSelfPacedLoop(
  port: IWaitingLoopPort,
  reason: string = DEFAULT_WAITING_LOOP_STOP_REASON,
): Promise<TWaitingLoopStopOutcome> {
  const waiting = port.listSelfPacedLoops().filter((loop) => loop.phase === 'waiting');
  if (waiting.length === 0) return { kind: 'none' };
  if (waiting.length > 1) {
    return {
      kind: 'several',
      message:
        'Several self-paced loops are waiting. Use /loop list and /loop stop <id> to choose one.',
    };
  }
  const loopId = waiting[0]!.loopId;
  try {
    await port.stopSelfPacedLoop(loopId, reason);
    return { kind: 'stopped', loopId, message: `Loop ${loopId} stopped.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', loopId, message: `Could not stop loop ${loopId}: ${detail}` };
  }
}
