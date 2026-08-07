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
 *    running. Otherwise a queued one has no identity for the whole time its caller waits on it. The
 *    queue drain carries the id back as `resumeTurnId`, so one submission is one turn throughout —
 *    and re-entering here with that id returns the promise its caller is ALREADY holding rather than
 *    minting a second nobody is waiting on.
 *
 * Split out of `interactive-session.ts`, which had grown past its size ratchet.
 */

import { AGENT_DRIVER_ID, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';
import type { TDriverId } from '@robota-sdk/agent-interface-transport';

import type {
  ITurnOptions,
  SessionExecutionController,
} from './interactive-session-execution-controller.js';
import type { IExecutionResult } from './types.js';

export interface IAcceptedSubmission {
  readonly driverId: TDriverId;
  readonly turnId: string;
  readonly completed: Promise<IExecutionResult>;
  readonly resolvedOptions: ITurnOptions;
}

export function acceptSubmission(
  options: ITurnOptions,
  execCtrl: SessionExecutionController,
): IAcceptedSubmission {
  const driverId =
    options.driverId ?? (options.turnSource === 'agent-wakeup' ? AGENT_DRIVER_ID : OWNER_DRIVER_ID);
  const { turnId, completed } = options.resumeTurnId
    ? {
        turnId: options.resumeTurnId,
        completed: execCtrl.turns.completionOf(options.resumeTurnId),
      }
    : execCtrl.turns.begin();
  return {
    driverId,
    turnId,
    completed,
    resolvedOptions: { ...options, driverId, resumeTurnId: turnId },
  };
}
