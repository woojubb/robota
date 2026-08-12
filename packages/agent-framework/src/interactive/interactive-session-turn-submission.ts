import { acceptSubmission } from './interactive-session-accept-submission.js';
import { MAX_PENDING_QUEUE_DEPTH } from './interactive-session-pending-queue.js';

import type {
  IQueuedInput,
  ITurnOptions,
  SessionExecutionController,
} from './interactive-session-execution-controller.js';
import type { ITurnHandle, TDriverId } from '@robota-sdk/agent-interface-transport';

export interface INewTurnSubmissionDeps {
  readonly execCtrl: SessionExecutionController;
  readonly ensureInitialized: () => Promise<void>;
  readonly executeAcceptedTurn: (entry: IQueuedInput) => Promise<void>;
  readonly emitDropped: (driverId: TDriverId, maxDepth: number) => void;
}

/** Accept and either execute or queue one NEW turn. Queued resumption never re-enters this path. */
export async function submitNewTurn(
  input: string,
  displayInput: string | undefined,
  rawInput: string | undefined,
  options: ITurnOptions,
  deps: INewTurnSubmissionDeps,
): Promise<ITurnHandle> {
  await deps.ensureInitialized();
  if (deps.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
  const { driverId, turnId, completed, resolvedOptions, queueBehindRunningTurn } = acceptSubmission(
    options,
    deps.execCtrl,
  );
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
}
