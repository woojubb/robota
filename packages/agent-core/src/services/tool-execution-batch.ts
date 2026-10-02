import { ValidationError } from '../utils/errors';
import type { ExecutionJournalError } from '../utils/execution-journal-error';
import {
  isExecutionControlError,
  prioritizeExecutionError,
} from '../utils/execution-control-error';
import { ExecutionSuspendedError } from '../utils/execution-suspended-error';
import type { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { randomId } from '../utils/random-id.js';
import { ToolBatchQueue } from './tool-batch-queue.js';
import { spanIdFromMintedId, toolTraceContextFor, traceEnvFor } from '../utils/trace-context';

import {
  ARGUMENT_DECODE_ERROR_CODE,
  TOOL_CALL_SKIPPED_ERROR_CODE,
  TOOL_EVENTS,
} from './tool-execution-constants';

import type { IToolCallScheduling, IToolExecutionBatchContext } from './tool-execution-batch-types';
import type { IToolEventData } from '../interfaces/event-service';
import type { IToolExecutionRequest } from '../interfaces/service';
import type {
  IToolExecutionResult,
  IToolExecutionContext,
  TToolParameters,
} from '../interfaces/tool';
import type { ILogger } from '../utils/logger';

const MIN_PARALLEL_CONCURRENCY = 1;

interface IOwnedToolBatchContext extends IToolExecutionBatchContext {
  readonly queue: ToolBatchQueue;
}

/**
 * Shared interface for the minimal ToolExecutionService surface needed by batch helpers.
 */
export interface IToolExecutor {
  executeTool(
    toolName: string,
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolExecutionResult>;
}

interface IParallelExecutionState {
  resultsByIndex: Array<IToolExecutionResult | undefined>;
  errorsByIndex: Array<Error | undefined>;
  nextRequestIndex: number;
  fatalError?: ExecutionJournalError | ExecutionSuspendedError | ExecutionRecoveryError;
  abort: AbortController;
  pending?: Set<number>;
  active?: Set<number>;
  changed?: Promise<void>;
  wake?: () => void;
}

function wakeWorkers(state: IParallelExecutionState): void {
  state.wake?.();
  state.changed = new Promise<void>((resolve) => {
    state.wake = resolve;
  });
}

function snapshotScheduling(
  context: IOwnedToolBatchContext,
): ReadonlyMap<string, IToolCallScheduling> {
  const ids = new Set<string>();
  for (const request of context.requests) {
    const { executionId } = requireExecutionRequestFields(request);
    if (ids.has(executionId)) throw new ValidationError('Scheduling requires unique call IDs');
    ids.add(executionId);
  }
  const copy = new Map<string, IToolCallScheduling>();
  for (const [id, policy] of context.scheduling!) {
    if (!ids.has(id)) throw new ValidationError(`Scheduling names an unknown call: ${id}`);
    const dependsOn = [...(policy.dependsOn ?? [])];
    for (const dependency of dependsOn) {
      if (!ids.has(dependency))
        throw new ValidationError(`Scheduling dependency is unknown: ${dependency}`);
    }
    const resources = policy.resources?.map((resource) => {
      if (
        typeof resource.key !== 'string' ||
        !resource.key.trim() ||
        (resource.access !== 'read' && resource.access !== 'write')
      ) {
        throw new ValidationError(
          'Scheduling requires nonempty resource identities and read/write access',
        );
      }
      return { key: resource.key, access: resource.access };
    });
    copy.set(id, { dependsOn, ...(resources !== undefined ? { resources } : {}) });
  }
  // Validate dependencies without recursion, including forward declarations and cycles.
  const settled = new Set<string>();
  while (settled.size < ids.size) {
    const previous = settled.size;
    for (const id of ids) {
      if ((copy.get(id)?.dependsOn ?? []).every((dependency) => settled.has(dependency)))
        settled.add(id);
    }
    if (settled.size === previous)
      throw new ValidationError('Scheduling dependencies contain a cycle');
  }
  return copy;
}

function resourcesConflict(first?: IToolCallScheduling, second?: IToolCallScheduling): boolean {
  if (first?.resources === undefined || second?.resources === undefined) return true;
  return first.resources.some((left) =>
    second.resources!.some(
      (right) => left.key === right.key && (left.access === 'write' || right.access === 'write'),
    ),
  );
}

/** A refusal retains the registered intent source; actual and recovered settlements keep theirs. */
function withIntentSource(request: IToolExecutionRequest, result: IToolExecutionResult): IToolExecutionResult {
  const source = request.metadata?.toolProvenance;
  if (typeof source !== 'string' || typeof result.metadata?.toolProvenance === 'string') return result;
  return { ...result, metadata: { ...result.metadata, toolProvenance: source } };
}

async function skipRequest(
  context: IOwnedToolBatchContext,
  index: number,
  reason: string,
): Promise<IToolExecutionResult> {
  const request = context.requests[index]!;
  context.queue.end(request, 'not-dispatched');
  requireExecutionRequestFields(request);
  const result: IToolExecutionResult = withIntentSource(request, {
    executionId: request.executionId,
    toolName: request.toolName,
    success: false,
    result: null,
    error: reason,
    metadata: { errorCode: TOOL_CALL_SKIPPED_ERROR_CODE, dispatchStatus: 'not-dispatched' },
  });
  request.eventService?.emit(TOOL_EVENTS.CALL_ERROR, {
    timestamp: new Date(),
    toolName: request.toolName,
    error: reason,
  });
  await context.journal?.onResult(index, result);
  return result;
}

async function runScheduledWorker(
  context: IOwnedToolBatchContext,
  executor: IToolExecutor,
  state: IParallelExecutionState,
): Promise<void> {
  const byId = new Map(context.requests.map((request, index) => [request.executionId!, index]));
  while (!state.fatalError && state.pending!.size > 0) {
    const changed = state.changed!;
    let chosen: number | undefined;
    let skippedReason: string | undefined;
    for (const index of state.pending!) {
      const request = context.requests[index]!;
      const policy = context.scheduling!.get(request.executionId!);
      const dependencies = (policy?.dependsOn ?? []).map(
        (id) => state.resultsByIndex[byId.get(id)!],
      );
      if (state.errorsByIndex.some(isDefinedError) && !context.continueOnError) {
        chosen = index;
        skippedReason = 'Skipped after an earlier call failed; this call was not dispatched';
        break;
      }
      if (dependencies.some((result) => result !== undefined && !result.success)) {
        chosen = index;
        skippedReason =
          'Skipped because a required predecessor failed; this call was not dispatched';
        break;
      }
      if (dependencies.some((result) => result === undefined)) continue;
      if (
        [...state.active!].some((active) =>
          resourcesConflict(
            policy,
            context.scheduling!.get(context.requests[active]!.executionId!),
          ),
        )
      )
        continue;
      chosen = index;
      break;
    }
    if (chosen === undefined) {
      await changed;
      continue;
    }
    state.pending!.delete(chosen);
    state.active!.add(chosen);
    try {
      if (skippedReason) {
        const result = await skipRequest(context, chosen, skippedReason);
        state.resultsByIndex[chosen] = result;
        state.errorsByIndex[chosen] = createToolFailureError(result);
      } else {
        await executeParallelRequest(context, executor, state, chosen);
      }
    } catch (error) {
      if (!isExecutionControlError(error)) throw error;
      const selected = prioritizeExecutionError(state.fatalError, error);
      if (isExecutionControlError(selected)) state.fatalError = selected;
      if (!(error instanceof ExecutionSuspendedError)) state.abort.abort(error);
    } finally {
      state.active!.delete(chosen);
      wakeWorkers(state);
    }
  }
}

function requireExecutionRequestFields(request: {
  executionId?: string;
  ownerType?: string;
  ownerId?: string;
}): { executionId: string; ownerType: string; ownerId: string } {
  if (!request.executionId) {
    throw new ValidationError(
      '[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing executionId',
    );
  }
  if (!request.ownerType) {
    throw new ValidationError(
      `[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing ownerType: executionId=${request.executionId}`,
    );
  }
  if (!request.ownerId) {
    throw new ValidationError(
      `[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing ownerId: executionId=${request.executionId}`,
    );
  }
  return {
    executionId: request.executionId,
    ownerType: request.ownerType,
    ownerId: request.ownerId,
  };
}

function createExecutionContext(
  request: IToolExecutionRequest,
  signal?: AbortSignal,
): IToolExecutionContext {
  const required = requireExecutionRequestFields(request);
  // Minted per body, never taken from the vendor's tool call ID, which may repeat and is not hex.
  const toolBodyId = randomId();
  const outboundTraceContext = request.traceContext
    ? toolTraceContextFor(request.traceContext, toolBodyId)
    : undefined;
  const shellTraceEnv = traceEnvFor('shell', request.traceContext, spanIdFromMintedId(toolBodyId));
  const hookTraceEnv = request.traceContext
    ? traceEnvFor('hooks', request.traceContext, request.traceContext.parentSpanId)
    : undefined;
  return {
    toolName: request.toolName,
    parameters: request.parameters,
    ...(signal ? { signal } : {}),
    executionId: required.executionId,
    ownerType: required.ownerType,
    ownerId: required.ownerId,
    ownerPath: request.ownerPath,
    metadata: request.metadata,
    eventService: request.eventService,
    baseEventService: request.baseEventService,
    ...(request.ask ? { ask: request.ask } : {}),
    ...(request.deferredTools ? { deferredTools: request.deferredTools } : {}),
    toolBodyId,
    ...(outboundTraceContext ? { outboundTraceContext } : {}),
    ...(shellTraceEnv ? { shellTraceEnv } : {}),
    ...(hookTraceEnv ? { hookTraceEnv } : {}),
  };
}

function createInterruptedResult(request: IToolExecutionRequest): IToolExecutionResult {
  return {
    toolName: request.toolName,
    executionId: request.executionId ?? '',
    success: false,
    error: 'Execution interrupted by user',
    result: null,
    metadata: { dispatchStatus: 'not-dispatched' },
  };
}

function createErrorResult(request: IToolExecutionRequest, error: Error): IToolExecutionResult {
  return {
    toolName: request.toolName,
    result: null,
    success: false,
    error: error.message,
    executionId: request.executionId,
  };
}

/**
 * Issue #2875 (follow-up to #2078): a request whose arguments failed to decode is refused HERE,
 * the same way an unknown tool name is refused inside `ToolExecutionService.executeTool` — as a
 * normal failed result for this one request, never as a thrown error that would abort the batch.
 * `executor.executeTool` is never called, so the tool never sees the placeholder `parameters`.
 *
 * Emits `TOOL_EVENTS.CALL_ERROR` on the request's own event service, the same way the unknown-tool
 * path does — a listener watching per-call events must see EVERY call fail or succeed exactly once,
 * decode failures included, not just the ones that reached the tool.
 */
function createArgumentDecodeErrorResult(request: IToolExecutionRequest): IToolExecutionResult {
  const error = request.argumentDecodeError;
  if (request.eventService && error !== undefined) {
    const errorEvent: IToolEventData = {
      timestamp: new Date(),
      toolName: request.toolName,
      error,
    };
    request.eventService.emit(TOOL_EVENTS.CALL_ERROR, errorEvent);
  }
  return {
    toolName: request.toolName,
    result: null,
    success: false,
    error,
    executionId: request.executionId,
    metadata: { errorCode: ARGUMENT_DECODE_ERROR_CODE, requestedTool: request.toolName, dispatchStatus: 'not-dispatched' },
  };
}

function createToolFailureError(result: IToolExecutionResult): Error {
  return new Error(
    `Tool execution failed: toolName=${String(result.toolName)} executionId=${String(result.executionId)} error=${String(result.error || 'Unknown error')}`,
  );
}

function isDefinedResult(result: IToolExecutionResult | undefined): result is IToolExecutionResult {
  return result !== undefined;
}

function isDefinedError(error: Error | undefined): error is Error {
  return error !== undefined;
}

function resolveMaxConcurrency(requestCount: number, maxConcurrency?: number): number {
  if (requestCount === 0) {
    return 0;
  }
  if (maxConcurrency === undefined || !Number.isFinite(maxConcurrency)) {
    return requestCount;
  }

  const normalized = Math.floor(maxConcurrency);
  if (normalized < MIN_PARALLEL_CONCURRENCY) {
    return MIN_PARALLEL_CONCURRENCY;
  }

  return Math.min(normalized, requestCount);
}

async function executeParallelRequest(
  batchContext: IOwnedToolBatchContext,
  executor: IToolExecutor,
  state: IParallelExecutionState,
  index: number,
): Promise<void> {
  const request = batchContext.requests[index];
  if (!request) {
    return;
  }

  try {
    const result = await executeRequest(batchContext, executor, request, index);
    state.resultsByIndex[index] = result;
    if (!result.success) {
      state.errorsByIndex[index] = createToolFailureError(result);
    }
  } catch (error) {
    if (isExecutionControlError(error)) {
      const selected = prioritizeExecutionError(state.fatalError, error);
      if (isExecutionControlError(selected)) state.fatalError = selected;
      // A saved wait only stops further dispatch: running siblings settle with real results.
      if (!(error instanceof ExecutionSuspendedError)) state.abort.abort(error);
      return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    state.errorsByIndex[index] = err;
    state.resultsByIndex[index] = createErrorResult(request, err);
  }
}

async function runParallelWorker(
  batchContext: IOwnedToolBatchContext,
  executor: IToolExecutor,
  state: IParallelExecutionState,
): Promise<void> {
  while (!state.fatalError && state.nextRequestIndex < batchContext.requests.length) {
    const currentIndex = state.nextRequestIndex;
    state.nextRequestIndex += 1;
    await executeParallelRequest(batchContext, executor, state, currentIndex);
  }
}

/**
 * Execute tool requests in parallel with a bounded worker pool.
 * Preserves a result entry for every request (SSOT for toolCallId → result mapping).
 */
async function executeParallel(
  inputContext: IOwnedToolBatchContext,
  executor: IToolExecutor,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  let batchContext = inputContext;
  if (batchContext.scheduling) {
    try {
      batchContext = { ...batchContext, scheduling: snapshotScheduling(batchContext) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const results: IToolExecutionResult[] = [];
      for (const [index] of batchContext.requests.entries()) {
        const restored = batchContext.recoveredResults?.get(index);
        results.push(
          restored
            ? structuredClone(restored)
            : await skipRequest(
                batchContext,
                index,
                `Invalid scheduling policy: ${reason}; this call was not dispatched`,
              ),
        );
      }
      return {
        results,
        errors: results.filter((result) => !result.success).map(createToolFailureError),
      };
    }
  }
  const abort = new AbortController();
  const executionContext =
    batchContext.journal || batchContext.scheduling
      ? {
          ...batchContext,
          signal: batchContext.signal
            ? AbortSignal.any([batchContext.signal, abort.signal])
            : abort.signal,
        }
      : batchContext;
  const state: IParallelExecutionState = {
    resultsByIndex: new Array(batchContext.requests.length),
    errorsByIndex: new Array(batchContext.requests.length),
    nextRequestIndex: 0,
    abort,
  };
  if (batchContext.scheduling) {
    state.pending = new Set(batchContext.requests.map((_, index) => index));
    state.active = new Set();
    wakeWorkers(state);
    for (const [index, result] of batchContext.recoveredResults ?? []) {
      if (!state.pending.delete(index)) continue;
      state.resultsByIndex[index] = structuredClone(result);
      if (!result.success) state.errorsByIndex[index] = createToolFailureError(result);
    }
  }
  const concurrency = resolveMaxConcurrency(
    batchContext.requests.length,
    batchContext.maxConcurrency,
  );

  const workers = Array.from({ length: concurrency }, () =>
    batchContext.scheduling
      ? runScheduledWorker(executionContext, executor, state)
      : runParallelWorker(executionContext, executor, state),
  );
  await Promise.all(workers);
  if (state.fatalError) throw state.fatalError;

  const results = state.resultsByIndex.filter(isDefinedResult);
  const errors = state.errorsByIndex.filter(isDefinedError);

  if (!batchContext.scheduling && errors.length > 0 && !batchContext.continueOnError) {
    throw errors[0];
  }

  return { results, errors };
}

/**
 * Execute tool requests sequentially, stopping on first error unless continueOnError is set.
 */
async function executeSequential(
  batchContext: IOwnedToolBatchContext,
  executor: IToolExecutor,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  const results: IToolExecutionResult[] = [];
  const errors: Error[] = [];
  let stopped = false;

  for (const [index, request] of batchContext.requests.entries()) {
    if (stopped && !batchContext.recoveredResults?.has(index)) {
      try {
        requireExecutionRequestFields(request);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      const error = 'Skipped after an earlier call failed; this call was not dispatched';
      const result = await skipRequest(batchContext, index, error);
      results.push(result);
      continue;
    }
    try {
      const result = await executeRequest(batchContext, executor, request, index);
      results.push(result);
      if (!result.success) {
        errors.push(createToolFailureError(result));
      }
      if (!result.success && !batchContext.continueOnError) {
        stopped = true;
      }
    } catch (error) {
      if (isExecutionControlError(error)) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      if (!batchContext.continueOnError) {
        stopped = true;
      }
    }
  }

  return { results, errors };
}

async function executeRequest(
  context: IOwnedToolBatchContext,
  executor: IToolExecutor,
  request: IToolExecutionRequest,
  index: number,
): Promise<IToolExecutionResult> {
  const recovered = context.recoveredResults?.get(index);
  if (recovered) return structuredClone(recovered);
  context.queue.end(request, context.signal?.aborted || request.argumentDecodeError !== undefined ? 'not-dispatched' : 'admission-started');
  let result: IToolExecutionResult;
  const journal = context.journal;
  if (context.signal?.aborted) result = createInterruptedResult(request);
  else if (request.argumentDecodeError !== undefined)
    result = createArgumentDecodeErrorResult(request);
  else {
    if (journal) await journal.beforeDispatch(index);
    if (context.signal?.aborted) result = createInterruptedResult(request);
    else {
      const executionContext = {
        ...createExecutionContext(request, context.signal),
        ...(journal?.continuation ? { continuation: journal.continuation(index) } : {}),
        ...(journal?.beforeEffect
          ? {
              beforeToolEffect: (parameters: TToolParameters) =>
                journal.beforeEffect!(index, parameters),
            }
          : {}),
      };
      if (context.lifecycle) await context.lifecycle.beforeDispatch(index, executionContext);
      try {
        result = await executeAndDrain(context, index, () =>
          executor.executeTool(request.toolName, request.parameters, executionContext),
        );
      } catch (error) {
        if (isExecutionControlError(error)) throw error;
        result = createErrorResult(
          request,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      // This wrapper was entered. A tool's result cannot claim the owner's undispatched status.
      if (result.metadata?.dispatchStatus !== undefined) {
        const { dispatchStatus: _foreignStatus, ...metadata } = result.metadata;
        void _foreignStatus;
        result = { ...result, metadata };
      }
      if (context.lifecycle) await context.lifecycle.onResult(index, executionContext, result);
    }
  }
  // Persist a settled sibling even after cancellation; this wait is not a new external effect.
  result = withIntentSource(request, result);
  await context.journal?.onResult(index, result);
  return result;
}

async function executeAndDrain(
  context: IOwnedToolBatchContext,
  index: number,
  execute: () => Promise<IToolExecutionResult>,
): Promise<IToolExecutionResult> {
  let outcome: { result: IToolExecutionResult } | { error: unknown };
  try {
    outcome = { result: await execute() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await context.journal?.settle?.(index);
  } catch (error) {
    outcome = {
      error: 'error' in outcome ? prioritizeExecutionError(outcome.error, error) : error,
    };
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}

/**
 * Execute a batch of tool requests, dispatching to parallel or sequential strategy.
 */
export async function executeBatch(
  batchContext: IToolExecutionBatchContext,
  executor: IToolExecutor,
  logger: ILogger,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  logger.debug(`Executing ${batchContext.requests.length} tools in ${batchContext.mode} mode`);

  const queue = new ToolBatchQueue(batchContext.requests, batchContext.recoveredResults);
  const ownedContext = { ...batchContext, queue };
  try {
    if (batchContext.scheduling || batchContext.mode === 'parallel') {
      const context =
        batchContext.mode === 'sequential' ? { ...ownedContext, maxConcurrency: 1 } : ownedContext;
      return await executeParallel(context, executor);
    }
    return await executeSequential(ownedContext, executor);
  } finally {
    queue.finish();
  }
}
