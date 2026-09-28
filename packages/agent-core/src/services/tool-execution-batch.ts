import { ValidationError } from '../utils/errors';
import type { ExecutionJournalError } from '../utils/execution-journal-error';
import {
  isExecutionControlError,
  prioritizeExecutionError,
} from '../utils/execution-control-error';
import { ExecutionSuspendedError } from '../utils/execution-suspended-error';
import type { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { randomId } from '../utils/random-id.js';
import { spanIdFromMintedId, toolTraceContextFor, traceEnvFor } from '../utils/trace-context';

import { ARGUMENT_DECODE_ERROR_CODE, TOOL_EVENTS } from './tool-execution-constants';

import type { IToolExecutionBatchContext } from './tool-execution-batch-types';
import type { IToolEventData } from '../interfaces/event-service';
import type { IToolExecutionRequest } from '../interfaces/service';
import type {
  IToolExecutionResult,
  IToolExecutionContext,
  TToolParameters,
} from '../interfaces/tool';
import type { ILogger } from '../utils/logger';

const MIN_PARALLEL_CONCURRENCY = 1;

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
    metadata: { errorCode: ARGUMENT_DECODE_ERROR_CODE, requestedTool: request.toolName },
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
  batchContext: IToolExecutionBatchContext,
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
  batchContext: IToolExecutionBatchContext,
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
  batchContext: IToolExecutionBatchContext,
  executor: IToolExecutor,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  const abort = new AbortController();
  const executionContext = batchContext.journal
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
  const concurrency = resolveMaxConcurrency(
    batchContext.requests.length,
    batchContext.maxConcurrency,
  );

  const workers = Array.from({ length: concurrency }, () =>
    runParallelWorker(executionContext, executor, state),
  );
  await Promise.all(workers);
  if (state.fatalError) throw state.fatalError;

  const results = state.resultsByIndex.filter(isDefinedResult);
  const errors = state.errorsByIndex.filter(isDefinedError);

  if (errors.length > 0 && !batchContext.continueOnError) {
    throw errors[0];
  }

  return { results, errors };
}

/**
 * Execute tool requests sequentially, stopping on first error unless continueOnError is set.
 */
async function executeSequential(
  batchContext: IToolExecutionBatchContext,
  executor: IToolExecutor,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  const results: IToolExecutionResult[] = [];
  const errors: Error[] = [];

  for (const [index, request] of batchContext.requests.entries()) {
    try {
      const result = await executeRequest(batchContext, executor, request, index);
      results.push(result);
      if (!result.success) {
        errors.push(createToolFailureError(result));
      }
      if (!result.success && !batchContext.continueOnError) {
        break;
      }
    } catch (error) {
      if (isExecutionControlError(error)) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      if (!batchContext.continueOnError) {
        break;
      }
    }
  }

  return { results, errors };
}

async function executeRequest(
  context: IToolExecutionBatchContext,
  executor: IToolExecutor,
  request: IToolExecutionRequest,
  index: number,
): Promise<IToolExecutionResult> {
  const recovered = context.recoveredResults?.get(index);
  if (recovered) return structuredClone(recovered);
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
      if (context.lifecycle) await context.lifecycle.onResult(index, executionContext, result);
    }
  }
  // Persist a settled sibling even after cancellation; this wait is not a new external effect.
  await context.journal?.onResult(index, result);
  return result;
}

async function executeAndDrain(
  context: IToolExecutionBatchContext,
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

  if (batchContext.mode === 'parallel') {
    return executeParallel(batchContext, executor);
  }
  return executeSequential(batchContext, executor);
}
