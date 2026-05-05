import type {
  IToolExecutionContext,
  TToolParameters,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import type { IToolExecutionTrackingData } from '../types';
import { createToolCallBlock, createToolErrorBlock, createToolResultBlock } from './block-messages';
import { toError } from './errors';
import type { IBlockTrackingHookRuntime } from './types';

export async function handleBeforeExecute(
  runtime: IBlockTrackingHookRuntime,
  toolName: string,
  parameters: TToolParameters,
  context?: IToolExecutionContext,
): Promise<void> {
  try {
    const executionId = context?.executionId || runtime.blockCollector.generateBlockId();
    runtime.logger.debug('🟡 Block tracking: Starting tool execution', {
      toolName,
      executionId,
      parentBlockId: runtime.parentBlockId,
    });

    const trackingData = createTrackingData(toolName, parameters, executionId, context, runtime);
    const toolCallBlock = createToolCallBlock({
      blockCollector: runtime.blockCollector,
      toolName,
      parameters,
      executionId,
      parentBlockId: runtime.parentBlockId,
      level: runtime.level,
      blockType: runtime.blockTypeMapping[toolName] || 'tool_call',
    });

    runtime.blockCollector.collectBlock(toolCallBlock);
    trackingData.parentBlockId = toolCallBlock.blockMetadata.id;
    runtime.activeExecutions.set(executionId, trackingData);
  } catch (error) {
    runtime.logger.error(
      '❌ Block tracking beforeExecute error:',
      toError(error instanceof Error ? error : String(error)),
    );
  }
}

export async function handleAfterExecute(
  runtime: IBlockTrackingHookRuntime,
  toolName: string,
  parameters: TToolParameters,
  result: TUniversalValue,
  context?: IToolExecutionContext,
): Promise<void> {
  try {
    const executionId = context?.executionId;
    if (!executionId) return warnMissingExecutionId(runtime, 'afterExecute');

    const trackingData = runtime.activeExecutions.get(executionId);
    if (!trackingData) return warnMissingTrackingData(runtime, executionId);

    const completion = completeTrackingData(trackingData, result);
    runtime.logger.debug('✅ Block tracking: Tool execution completed', {
      toolName,
      executionId,
      duration: `${completion.duration}ms`,
    });

    if (trackingData.parentBlockId) {
      updateCompletedToolBlock(
        runtime,
        trackingData,
        toolName,
        parameters,
        executionId,
        completion.duration,
      );
      runtime.blockCollector.collectBlock(
        createToolResultBlock({
          blockCollector: runtime.blockCollector,
          toolName,
          result,
          executionId,
          parentBlockId: trackingData.parentBlockId,
          level: runtime.level,
          endTime: completion.endTime,
          duration: completion.duration,
        }),
      );
    }

    runtime.activeExecutions.delete(executionId);
  } catch (error) {
    runtime.logger.error(
      '❌ Block tracking afterExecute error:',
      toError(error instanceof Error ? error : String(error)),
    );
  }
}

export async function handleToolError(
  runtime: IBlockTrackingHookRuntime,
  toolName: string,
  parameters: TToolParameters,
  error: Error,
  context?: IToolExecutionContext,
): Promise<void> {
  try {
    const executionId = context?.executionId;
    if (!executionId) return warnMissingExecutionId(runtime, 'onError');

    const trackingData = runtime.activeExecutions.get(executionId);
    if (!trackingData) return warnMissingErrorTrackingData(runtime, executionId);

    const completion = completeTrackingWithError(trackingData, error);
    runtime.logger.error('❌ Block tracking: Tool execution failed', {
      toolName,
      executionId,
      error: error.message,
      duration: `${completion.duration}ms`,
    });

    if (trackingData.parentBlockId) {
      updateErroredToolBlock(
        runtime,
        trackingData,
        toolName,
        parameters,
        executionId,
        completion.duration,
      );
      runtime.blockCollector.collectBlock(
        createToolErrorBlock({
          blockCollector: runtime.blockCollector,
          toolName,
          error,
          executionId,
          parentBlockId: trackingData.parentBlockId,
          level: runtime.level,
          endTime: completion.endTime,
          duration: completion.duration,
        }),
      );
    }

    runtime.activeExecutions.delete(executionId);
  } catch (hookError) {
    runtime.logger.error(
      '❌ Block tracking onError handler error:',
      toError(hookError instanceof Error ? hookError : String(hookError)),
    );
  }
}

function createTrackingData(
  toolName: string,
  parameters: TToolParameters,
  executionId: string,
  context: IToolExecutionContext | undefined,
  runtime: IBlockTrackingHookRuntime,
): IToolExecutionTrackingData {
  const trackingData: IToolExecutionTrackingData = {
    toolName,
    parameters,
    context,
    startTime: new Date(),
    executionId,
    parentBlockId: runtime.parentBlockId,
  };
  runtime.activeExecutions.set(executionId, trackingData);
  return trackingData;
}

function completeTrackingData(
  trackingData: IToolExecutionTrackingData,
  result: TUniversalValue,
): { endTime: Date; duration: number } {
  trackingData.endTime = new Date();
  trackingData.result = result;
  return {
    endTime: trackingData.endTime,
    duration: trackingData.endTime.getTime() - trackingData.startTime.getTime(),
  };
}

function completeTrackingWithError(
  trackingData: IToolExecutionTrackingData,
  error: Error,
): { endTime: Date; duration: number } {
  trackingData.endTime = new Date();
  trackingData.error = error;
  return {
    endTime: trackingData.endTime,
    duration: trackingData.endTime.getTime() - trackingData.startTime.getTime(),
  };
}

function updateCompletedToolBlock(
  runtime: IBlockTrackingHookRuntime,
  trackingData: IToolExecutionTrackingData,
  toolName: string,
  parameters: TToolParameters,
  executionId: string,
  duration: number,
): void {
  runtime.blockCollector.updateBlock(trackingData.parentBlockId!, {
    visualState: 'completed',
    executionContext: { toolName, executionId, timestamp: trackingData.startTime, duration },
    renderData: { parameters, result: trackingData.result },
  });
}

function updateErroredToolBlock(
  runtime: IBlockTrackingHookRuntime,
  trackingData: IToolExecutionTrackingData,
  toolName: string,
  parameters: TToolParameters,
  executionId: string,
  duration: number,
): void {
  runtime.blockCollector.updateBlock(trackingData.parentBlockId!, {
    visualState: 'error',
    executionContext: { toolName, executionId, timestamp: trackingData.startTime, duration },
    renderData: { parameters, error: trackingData.error },
  });
}

function warnMissingExecutionId(
  runtime: IBlockTrackingHookRuntime,
  handlerName: 'afterExecute' | 'onError',
): void {
  runtime.logger.warn(`⚠️ Block tracking: No executionId found for ${handlerName}`);
}

function warnMissingTrackingData(runtime: IBlockTrackingHookRuntime, executionId: string): void {
  runtime.logger.warn('⚠️ Block tracking: No tracking data found for executionId:', executionId);
}

function warnMissingErrorTrackingData(
  runtime: IBlockTrackingHookRuntime,
  executionId: string,
): void {
  runtime.logger.warn('⚠️ Block tracking: No tracking data found for error:', executionId);
}
