import type {
  IToolExecutionResult,
  IToolExecutionContext,
  TToolParameters,
} from '../interfaces/tool';
import type { ILogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { IToolExecutionRequest } from '../interfaces/service';

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

function createExecutionContext(request: IToolExecutionRequest): IToolExecutionContext {
  const required = requireExecutionRequestFields(request);
  return {
    toolName: request.toolName,
    parameters: request.parameters,
    executionId: required.executionId,
    ownerType: required.ownerType,
    ownerId: required.ownerId,
    ownerPath: request.ownerPath,
    metadata: request.metadata,
    eventService: request.eventService,
    baseEventService: request.baseEventService,
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
    const result = batchContext.signal?.aborted
      ? createInterruptedResult(request)
      : await executor.executeTool(
          request.toolName,
          request.parameters,
          createExecutionContext(request),
        );
    state.resultsByIndex[index] = result;
    if (!result.success) {
      state.errorsByIndex[index] = createToolFailureError(result);
    }
  } catch (error) {
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
  while (state.nextRequestIndex < batchContext.requests.length) {
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
  const state: IParallelExecutionState = {
    resultsByIndex: new Array(batchContext.requests.length),
    errorsByIndex: new Array(batchContext.requests.length),
    nextRequestIndex: 0,
  };
  const concurrency = resolveMaxConcurrency(
    batchContext.requests.length,
    batchContext.maxConcurrency,
  );

  const workers = Array.from({ length: concurrency }, () =>
    runParallelWorker(batchContext, executor, state),
  );
  await Promise.all(workers);

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

  for (const request of batchContext.requests) {
    try {
      const result = await executor.executeTool(
        request.toolName,
        request.parameters,
        createExecutionContext(request),
      );
      results.push(result);
      if (!result.success) {
        errors.push(createToolFailureError(result));
      }
      if (!result.success && !batchContext.continueOnError) {
        break;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      if (!batchContext.continueOnError) {
        break;
      }
    }
  }

  return { results, errors };
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
