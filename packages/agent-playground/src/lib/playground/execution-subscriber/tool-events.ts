import type { IEventEmitterEventData } from '@robota-sdk/agent-core';
import type { IRealTimeBlockMessage, IRealTimeBlockMetadata } from '../block-tracking/types';
import { asObjectValue, isHierarchicalEventData } from './event-data';
import { parseExecutionSteps } from './tool-steps';
import type { IExecutionSubscriberContext } from './types';

function resolveToolName(eventData: IEventEmitterEventData): string {
  const toolNameValue = asObjectValue(eventData.data)?.toolName;
  return typeof toolNameValue === 'string' && toolNameValue.length > 0
    ? toolNameValue
    : 'unknown_tool';
}

export function handleToolStart(
  eventData: IEventEmitterEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId) return;

  const hierarchicalData = isHierarchicalEventData(eventData) ? eventData : undefined;
  const toolName = resolveToolName(eventData);
  const startTime = new Date();
  const executionHierarchy = hierarchicalData
    ? {
        parentExecutionId: hierarchicalData.parentExecutionId,
        rootExecutionId: hierarchicalData.rootExecutionId,
        level: hierarchicalData.executionLevel,
        path: hierarchicalData.executionPath || [toolName],
      }
    : undefined;
  const blockMetadata: IRealTimeBlockMetadata = {
    id: context.generateBlockId(),
    type: 'tool_call',
    level: hierarchicalData?.executionLevel ?? 2,
    parentId: context.getParentBlockId(hierarchicalData?.parentExecutionId),
    children: [],
    isExpanded: true,
    visualState: 'in_progress',
    startTime,
    toolParameters: hierarchicalData?.realTimeData?.actualParameters,
    executionHierarchy,
    executionContext: {
      toolName,
      executionId,
      timestamp: new Date(),
    },
    renderData: {
      parameters: hierarchicalData?.realTimeData?.actualParameters,
    },
  };
  const blockMessage: IRealTimeBlockMessage = {
    role: 'tool',
    content: `Executing ${toolName}...`,
    blockMetadata,
  };

  context.activeExecutions.set(executionId, {
    blockId: blockMetadata.id,
    startTime,
    hierarchyInfo: executionHierarchy,
  });

  context.blockCollector.collectBlock(blockMessage);
}

export function handleToolComplete(
  eventData: IEventEmitterEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId) return;

  const execution = context.activeExecutions.get(executionId);
  if (!execution) return;

  const hierarchicalData = isHierarchicalEventData(eventData) ? eventData : undefined;
  const endTime = new Date();
  const actualDuration = endTime.getTime() - execution.startTime.getTime();

  context.blockCollector.updateRealTimeBlock(execution.blockId, {
    visualState: 'completed',
    endTime,
    actualDuration,
    toolResult: hierarchicalData?.realTimeData?.actualResult?.data,
    renderData: {
      result: hierarchicalData?.realTimeData?.actualResult?.data,
    },
  });

  context.activeExecutions.delete(executionId);
}

export function handleToolError(
  eventData: IEventEmitterEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId) return;

  const execution = context.activeExecutions.get(executionId);
  if (!execution) return;

  const endTime = new Date();
  const actualDuration = endTime.getTime() - execution.startTime.getTime();

  context.blockCollector.updateRealTimeBlock(execution.blockId, {
    visualState: 'error',
    endTime,
    actualDuration,
    renderData: {
      error: eventData.error,
    },
  });

  context.activeExecutions.delete(executionId);
}

export function handleToolRealtimeUpdate(
  eventData: IEventEmitterEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId) return;

  const execution = context.activeExecutions.get(executionId);
  if (!execution) return;

  const toolData = asObjectValue(eventData.data);
  if (!toolData || (toolData.progress === undefined && !toolData.currentStep)) {
    return;
  }

  context.blockCollector.updateRealTimeBlock(execution.blockId, {
    toolProvidedData: {
      progress: typeof toolData.progress === 'number' ? toolData.progress : undefined,
      currentStep: typeof toolData.currentStep === 'string' ? toolData.currentStep : undefined,
      estimatedDuration:
        typeof toolData.estimatedDuration === 'number' ? toolData.estimatedDuration : undefined,
      executionSteps: parseExecutionSteps(toolData.executionSteps),
    },
  });
}
