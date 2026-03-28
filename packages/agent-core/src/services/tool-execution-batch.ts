import type { IToolExecutionResult, IToolExecutionContext } from '../interfaces/tool';
import type { ILogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import type { IToolExecutionBatchContext } from './tool-execution-service';

/**
 * Shared interface for the minimal ToolExecutionService surface needed by batch helpers.
 */
export interface IToolExecutor {
  executeTool(
    toolName: string,
    parameters: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<IToolExecutionResult>;
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

/**
 * Execute tool requests in parallel with Promise.allSettled.
 * Preserves a result entry for every request (SSOT for toolCallId → result mapping).
 */
async function executeParallel(
  batchContext: IToolExecutionBatchContext,
  executor: IToolExecutor,
): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
  const results: IToolExecutionResult[] = [];
  const errors: Error[] = [];

  const promises = batchContext.requests.map((request) =>
    (() => {
      if (batchContext.signal?.aborted) {
        return Promise.resolve({
          toolName: request.toolName,
          executionId: request.executionId ?? '',
          success: false,
          error: 'Execution interrupted by user',
          result: null,
        } as IToolExecutionResult);
      }
      const required = requireExecutionRequestFields(request);
      return executor.executeTool(request.toolName, request.parameters, {
        toolName: request.toolName,
        parameters: request.parameters,
        executionId: required.executionId,
        ownerType: required.ownerType,
        ownerId: required.ownerId,
        ownerPath: request.ownerPath,
        metadata: request.metadata,
        eventService: request.eventService,
        baseEventService: request.baseEventService,
      });
    })(),
  );

  const allResults = await Promise.allSettled(promises);

  allResults.forEach((settledResult, index) => {
    const request = batchContext.requests[index];
    if (!request) return;
    if (settledResult.status === 'fulfilled') {
      const result = settledResult.value;
      results.push(result);
      if (!result.success) {
        errors.push(
          new Error(
            `Tool execution failed: toolName=${String(result.toolName)} executionId=${String(result.executionId)} error=${String(result.error || 'Unknown error')}`,
          ),
        );
      }
      return;
    }
    const err =
      settledResult.reason instanceof Error
        ? settledResult.reason
        : new Error(String(settledResult.reason));
    errors.push(err);
    results.push({
      toolName: request.toolName,
      result: null,
      success: false,
      error: err.message,
      executionId: request.executionId,
    });
  });

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
      const required = requireExecutionRequestFields(request);
      const result = await executor.executeTool(request.toolName, request.parameters, {
        toolName: request.toolName,
        parameters: request.parameters,
        executionId: required.executionId,
        ownerType: required.ownerType,
        ownerId: required.ownerId,
        ownerPath: request.ownerPath,
        metadata: request.metadata,
        eventService: request.eventService,
        baseEventService: request.baseEventService,
      });
      results.push(result);
      if (!result.success) {
        errors.push(
          new Error(
            `Tool execution failed: toolName=${String(result.toolName)} executionId=${String(result.executionId)} error=${String(result.error || 'Unknown error')}`,
          ),
        );
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
