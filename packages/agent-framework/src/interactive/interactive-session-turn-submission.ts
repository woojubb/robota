import { acceptSubmission } from './interactive-session-accept-submission.js';
import { MAX_PENDING_QUEUE_DEPTH } from './interactive-session-pending-queue.js';

import type {
  IQueuedInput,
  ITurnOptions,
  SessionExecutionController,
} from './interactive-session-execution-controller.js';
import type { ISubmitOptions, ITurnHandle, TDriverId } from '@robota-sdk/agent-interface-session';

export interface INewTurnSubmissionDeps {
  readonly execCtrl: SessionExecutionController;
  readonly ensureInitialized: () => Promise<void>;
  readonly executeAcceptedTurn: (entry: IQueuedInput) => Promise<void>;
  readonly emitDropped: (driverId: TDriverId, maxDepth: number) => void;
  readonly isWakeStopped: (wakeTaskId: string) => boolean;
}

export class StoppedWakeSubmissionError extends Error {
  constructor(readonly wakeTaskId: string) {
    super(`Background wake ${wakeTaskId} was stopped before turn admission.`);
  }
}

/**
 * The PUBLIC submission fields, projected one by one.
 *
 * An allowlist, not a convenience. `submit` is reachable from untyped callers — a transport frame, a
 * JavaScript consumer — and a wholesale spread would carry whatever they sent into the internal turn
 * options, including `resumeTurnId`, which lets a caller name an EXISTING turn's identity instead of
 * being minted one. RUNTIME-006 removed that option for exactly that reason and a test pins it, so
 * every field here is one somebody decided a caller may set.
 */
export function publicTurnOptions(options: ISubmitOptions): ITurnOptions {
  return {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.driverId !== undefined ? { driverId: options.driverId } : {}),
    ...(options.turnSource !== undefined ? { turnSource: options.turnSource } : {}),
  };
}

/** Accept and either execute or queue one NEW turn. Queued resumption never re-enters this path. */
export async function submitNewTurn(
  input: string,
  displayInput: string | undefined,
  rawInput: string | undefined,
  options: ITurnOptions,
  deps: INewTurnSubmissionDeps,
): Promise<ITurnHandle> {
  // Reserve admission before initialization yields, so a direct call cannot overtake this turn.
  deps.execCtrl.executionClaim.beginSubmission();
  try {
    await deps.ensureInitialized();
    if (deps.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
    if (options.wakeTaskId !== undefined && deps.isWakeStopped(options.wakeTaskId)) {
      throw new StoppedWakeSubmissionError(options.wakeTaskId);
    }
    const { driverId, turnId, completed, resolvedOptions, queueBehindRunningTurn } =
      acceptSubmission(options, deps.execCtrl);
    if (options.signal?.aborted) {
      deps.execCtrl.turns.refuse(turnId, 'cancelled');
      return { turnId, completed };
    }
    // Active execution receives the same signal; this listener owns only queue removal.
    const cancelQueued = (): void => {
      deps.execCtrl.pending.cancel(turnId);
    };
    options.signal?.addEventListener('abort', cancelQueued, { once: true });
    const cleanup = (): void => options.signal?.removeEventListener('abort', cancelQueued);
    void completed.then(cleanup, cleanup);
    if (deps.execCtrl.executing) {
      const outcome = queueBehindRunningTurn({ input, displayInput, rawInput });
      if (outcome === 'dropped') deps.emitDropped(driverId, MAX_PENDING_QUEUE_DEPTH);
      return { turnId, completed };
    }
    await deps.executeAcceptedTurn({
      input,
      ...(displayInput !== undefined ? { displayInput } : {}),
      ...(rawInput !== undefined ? { rawInput } : {}),
      options: resolvedOptions,
      turnId,
    });
    return { turnId, completed };
  } finally {
    deps.execCtrl.executionClaim.endSubmission();
  }
}
