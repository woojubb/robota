import type {
  IEventEmitterEventData,
  IEventEmitterHierarchicalEventData,
} from '@robota-sdk/agent-core';
import type { IRealTimeBlockMessage, IRealTimeBlockMetadata } from '../block-tracking/types';
import type { IExecutionSubscriberContext } from './types';
import { isHierarchicalEventData } from './event-data';

export function handleHierarchyUpdate(
  eventData: IEventEmitterHierarchicalEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId) return;

  const execution = context.activeExecutions.get(executionId);
  if (!execution) return;

  execution.hierarchyInfo = {
    parentExecutionId: eventData.parentExecutionId,
    rootExecutionId: eventData.rootExecutionId,
    level: eventData.executionLevel,
    path: eventData.executionPath,
  };

  context.blockCollector.updateRealTimeBlock(execution.blockId, {
    level: eventData.executionLevel,
    executionHierarchy: execution.hierarchyInfo,
  });
}

export function handleRealtimeUpdate(
  eventData: IEventEmitterHierarchicalEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId || !eventData.realTimeData) return;

  const execution = context.activeExecutions.get(executionId);
  if (!execution) return;

  context.blockCollector.updateRealTimeBlock(execution.blockId, {
    toolParameters: eventData.realTimeData.actualParameters,
    toolResult: eventData.realTimeData.actualResult?.data,
    renderData: {
      parameters: eventData.realTimeData.actualParameters,
      result: eventData.realTimeData.actualResult?.data,
    },
  });
}

export function handleExecutionStart(
  eventData: IEventEmitterEventData,
  context: IExecutionSubscriberContext,
): void {
  const executionId = eventData.executionId;
  if (!executionId || !isHierarchicalEventData(eventData)) return;

  if (eventData.executionLevel > 1) {
    return;
  }

  const startTime = new Date();
  const executionHierarchy = {
    parentExecutionId: eventData.parentExecutionId,
    rootExecutionId: eventData.rootExecutionId,
    level: eventData.executionLevel,
    path: eventData.executionPath || [],
  };
  const blockMetadata: IRealTimeBlockMetadata = {
    id: context.generateBlockId(),
    type: eventData.executionLevel === 0 ? 'group' : 'assistant',
    level: eventData.executionLevel,
    parentId: context.getParentBlockId(eventData.parentExecutionId),
    children: [],
    isExpanded: true,
    visualState: 'in_progress',
    startTime,
    executionHierarchy,
    executionContext: {
      executionId,
      timestamp: new Date(),
    },
  };

  const blockMessage: IRealTimeBlockMessage = {
    role: eventData.executionLevel === 0 ? 'system' : 'assistant',
    content: eventData.executionLevel === 0 ? 'Team execution started' : 'Agent processing...',
    blockMetadata,
  };

  context.activeExecutions.set(executionId, {
    blockId: blockMetadata.id,
    startTime,
    hierarchyInfo: executionHierarchy,
  });

  context.blockCollector.collectBlock(blockMessage);
}

export function handleExecutionComplete(
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
    visualState: 'completed',
    endTime,
    actualDuration,
  });

  context.activeExecutions.delete(executionId);
}
