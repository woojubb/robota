/**
 * What is decided the moment a submission is ACCEPTED — before anything runs.
 *
 * Two decisions, resolved together because they are made at the same instant and travel on the same
 * options object:
 *
 *  - REMOTE-014 E5 **attribution**: the SERVER-ASSIGNED driver id (display-only). A human turn
 *    defaults to the owner; an agent-wakeup/goal turn to the reserved agent id — never the owner,
 *    because an autonomous action must not be mis-attributed to the operator.
 *  - RUNTIME-003 **identity**: a submission is identified when it is accepted, not when it starts
 *    running. Otherwise a queued one has no identity for the whole time its caller waits on it.
 *    RUNTIME-006 keeps queued resumption out of this new-submission function, so every call mints
 *    exactly one identity and a queued entry carries it directly to execution.
 *
 * Split out of `interactive-session.ts`, which had grown past its size ratchet.
 */

import { AGENT_DRIVER_ID, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';

import type {
  IQueuedInput,
  ITurnOptions,
  SessionExecutionController,
} from './interactive-session-execution-controller.js';
import type { IExecutionResult } from './types.js';
import type { TDriverId } from '@robota-sdk/agent-interface-transport';

export interface IAcceptedSubmission {
  readonly driverId: TDriverId;
  readonly turnId: string;
  readonly completed: Promise<IExecutionResult>;
  readonly resolvedOptions: ITurnOptions;
  /**
   * Put this submission on the queue behind the turn already running.
   *
   * Handed back as part of acceptance rather than exported separately, because the entry it builds
   * must carry the `turnId` minted above: every refusal path settles by that id, and an entry
   * without one leaves its caller waiting forever — which is how the queued half of RUNTIME-003
   * shipped inert in its first draft. Same-driver input coalesces to the tail (1-deep today); a
   * different driver appends without clobbering.
   */
  readonly queueBehindRunningTurn: (
    entry: Omit<IQueuedInput, 'options' | 'turnId'>,
  ) => 'queued' | 'coalesced' | 'dropped';
}

export function acceptSubmission(
  options: ITurnOptions,
  execCtrl: SessionExecutionController,
): IAcceptedSubmission {
  // PEER-002 (#1809): a peer turn has no default. Falling through to the owner would attribute
  // another session's message to the operator — the same mis-attribution the agent id exists to
  // prevent for autonomous turns, and worse here because a peer is a different party entirely.
  // There is no id we could invent that would be true, so the caller must supply one.
  if (options.turnSource === 'peer' && options.driverId === undefined) {
    throw new Error(
      'a peer turn must carry the peer driver id: defaulting to the owner would attribute another ' +
        "session's message to the operator.",
    );
  }
  const driverId =
    options.driverId ?? (options.turnSource === 'agent-wakeup' ? AGENT_DRIVER_ID : OWNER_DRIVER_ID);
  const { turnId, completed } = execCtrl.turns.begin();
  const resolvedOptions: ITurnOptions = { ...options, driverId };
  return {
    driverId,
    turnId,
    completed,
    resolvedOptions,
    queueBehindRunningTurn: (entry) =>
      execCtrl.enqueuePending({ ...entry, options: resolvedOptions, turnId }),
  };
}
