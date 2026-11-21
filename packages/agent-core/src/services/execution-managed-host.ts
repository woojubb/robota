import type { TAgentExecutionConfig } from '../interfaces/agent';
import type { IRecoverableExecutionJournal } from '../interfaces/execution-journal';
import type { IManagedToolReceipt, TManagedToolBatch } from '../interfaces/managed-provider';
import type { IToolSchema } from '../interfaces/tool-schema';
import type { ConversationStore } from '../managers/conversation-store';
import { createAbortError } from '../utils/abort-classification';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isUniversalValueEqual } from '../utils/universal-value-equal';
import { randomId } from '../utils/random-id';
import { captureExecutionCheckpoint } from './execution-checkpoint';
import { commitManagedToolFrame } from './execution-journal';
import { hasRoundCapacity, resolveMaxExecutionRounds } from './execution-pipeline';
import { restoreJournaledRound } from './execution-resume';
import type { IRoundDependencies } from './execution-round-types';
import type { IExecutionContext, IExecutionRoundState } from './execution-types';

/** Exercise the host-owned tool boundary without enabling a managed production route. */
export function createManagedToolExecutor(input: {
  journal: IRecoverableExecutionJournal;
  store: ConversationStore;
  conversationId: string;
  context: IExecutionContext;
  config: TAgentExecutionConfig;
  tools: readonly IToolSchema[];
  state: IExecutionRoundState;
  deps: IRoundDependencies;
}): {
  execute(frame: TManagedToolBatch): Promise<readonly IManagedToolReceipt[]>;
  assertHealthy(): void;
  getState(): IExecutionRoundState;
  /** Revoke the callback and settle any in-flight frame before releasing turn ownership. */
  close(): Promise<void>;
} {
  const { journal, store, conversationId, context, config, deps } = input;
  const tools = structuredClone(input.tools);
  const maxRounds = resolveMaxExecutionRounds(config, context);
  const controller = new AbortController();
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;
  let state = input.state;
  let started = false;
  let stopped = false;
  let failed = false;
  let failure: unknown;
  let closed = false;
  let closing: Promise<void> | undefined;
  let active:
    | {
        frame: TManagedToolBatch;
        promise: Promise<readonly IManagedToolReceipt[]>;
      }
    | undefined;
  const settled = new Map<
    string,
    { frame: TManagedToolBatch; receipts: readonly IManagedToolReceipt[] }
  >();

  const conflict = (message: string): ExecutionRecoveryError =>
    new ExecutionRecoveryError('EXECUTION_RECOVERY_CONFLICT', message);
  const required = (message: string): ExecutionRecoveryError =>
    new ExecutionRecoveryError('EXECUTION_RECOVERY_REQUIRED', message);
  const rejectAndLatch = (error: unknown): Promise<never> => {
    failed = true;
    failure = error;
    controller.abort(error);
    return Promise.reject(error);
  };

  async function perform(frame: TManagedToolBatch): Promise<readonly IManagedToolReceipt[]> {
    signal.throwIfAborted();
    if (context.executionId.length === 0 || context.conversationId !== conversationId)
      throw conflict('Managed turn identity differs from its host');
    if (!started) {
      started = true;
      const previous = await journal.read(context.executionId);
      signal.throwIfAborted();
      if (previous.length > 0) throw required('A previous managed turn requires explicit recovery');
    }
    if (stopped || !hasRoundCapacity(state.currentRound, maxRounds))
      throw conflict('Managed turn has no remaining tool round capacity');

    const nextState: IExecutionRoundState = { ...state, currentRound: state.currentRound + 1 };
    const callId = randomId();
    const checkpoint = captureExecutionCheckpoint(
      store.getMessages(),
      nextState,
      context,
      config,
      maxRounds,
      deps.toolExecutionService.getLoadedDeferredTools(),
    );
    const committed = await commitManagedToolFrame(
      journal,
      {
        executionId: context.executionId,
        callId,
        providerId: config.defaultModel.provider,
        modelId: config.defaultModel.model,
        checkpoint,
        tools,
      },
      frame,
    );
    signal.throwIfAborted();
    const restored = await restoreJournaledRound(
      store,
      conversationId,
      {
        executionId: context.executionId,
        callId,
        journal,
        includeReceipts: true,
        signal,
        onExecutionEvent: context.onExecutionEvent,
      },
      deps,
      undefined,
      config,
    );
    if (!restored.receipts || restored.receipts.length !== committed.toolCalls.length)
      throw required('Managed tool frame has no complete durable receipts');
    state = restored.state;
    stopped = restored.stop;
    const receipts = structuredClone(restored.receipts);
    settled.set(committed.id, { frame: committed, receipts });
    return structuredClone(receipts);
  }

  const execute = (frame: TManagedToolBatch): Promise<readonly IManagedToolReceipt[]> => {
    if (failed) return Promise.reject(failure);
    if (closed) return Promise.reject(conflict('Managed turn has ended'));
    let snapshot: TManagedToolBatch;
    try {
      snapshot = structuredClone(frame);
    } catch {
      return rejectAndLatch(conflict('Managed assistant frame cannot be captured'));
    }
    if (failed) return Promise.reject(failure);
    if (closed) return Promise.reject(conflict('Managed turn has ended'));
    if (signal.aborted)
      return rejectAndLatch(createAbortError('Managed turn interrupted', signal.reason));
    if (active) {
      if (isUniversalValueEqual(active.frame, snapshot))
        return active.promise.then((receipts) => structuredClone(receipts));
      return rejectAndLatch(
        conflict('Another managed assistant frame is still awaiting durable receipts'),
      );
    }
    const prior = settled.get(snapshot.id);
    if (prior) {
      if (!isUniversalValueEqual(prior.frame, snapshot))
        return rejectAndLatch(conflict('Managed assistant frame replay changed'));
      return Promise.resolve(structuredClone(prior.receipts));
    }
    const promise = Promise.resolve()
      .then(() => perform(snapshot))
      .catch((error: unknown) => {
        if (!failed) {
          failed = true;
          failure = error;
        }
        controller.abort(failure);
        throw error;
      })
      .finally(() => {
        active = undefined;
      });
    active = { frame: snapshot, promise };
    return promise;
  };
  return {
    execute,
    assertHealthy: () => {
      if (failed) throw failure;
      if (active) throw required('Managed assistant frame is still awaiting durable receipts');
      signal.throwIfAborted();
    },
    getState: () => state,
    close: () => {
      if (closing) return closing;
      closed = true;
      const pending = active?.promise;
      if (pending) {
        if (!failed) {
          failed = true;
          failure = required('Managed turn ended before its tool frame settled');
        }
        controller.abort(failure);
      }
      closing = (async () => {
        if (pending) {
          try {
            await pending;
          } catch {
            // The latched host failure is the turn's outcome.
          }
        }
        if (failed) throw failure;
      })();
      return closing;
    },
  };
}
