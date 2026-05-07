import type { IEventEmitterEventData, IEventEmitterPlugin } from '@robota-sdk/agent-core';
import { EVENT_EMITTER_EVENTS } from '@robota-sdk/agent-core';
import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import { generateBlockId } from './block-id';
import { isHierarchicalEventData } from './event-data';
import {
  handleExecutionComplete,
  handleExecutionStart,
  handleHierarchyUpdate,
  handleRealtimeUpdate,
} from './execution-events';
import {
  handleToolComplete,
  handleToolError,
  handleToolRealtimeUpdate,
  handleToolStart,
} from './tool-events';
import type { IActiveExecution, IExecutionSubscriberContext } from './types';

/**
 * Bridges SDK events to Web App BlockCollector real-time updates.
 */
export class ExecutionSubscriber {
  private blockCollector: IPlaygroundBlockCollector;
  private eventEmitter?: IEventEmitterPlugin;
  private unsubscribeFunctions: (() => void)[] = [];
  private activeExecutions = new Map<string, IActiveExecution>();

  constructor(blockCollector: IPlaygroundBlockCollector) {
    this.blockCollector = blockCollector;
  }

  initialize(eventEmitter: IEventEmitterPlugin): void {
    this.eventEmitter = eventEmitter;
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    if (!this.eventEmitter) return;

    this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, (eventData) => {
      handleToolStart(eventData, this.createContext());
    });
    this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, (eventData) => {
      handleToolComplete(eventData, this.createContext());
    });
    this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_ERROR, (eventData) => {
      handleToolError(eventData, this.createContext());
    });

    this.eventEmitter.on(
      EVENT_EMITTER_EVENTS.EXECUTION_HIERARCHY,
      (eventData: IEventEmitterEventData) => {
        if (isHierarchicalEventData(eventData)) {
          handleHierarchyUpdate(eventData, this.createContext());
        }
      },
    );
    this.eventEmitter.on(
      EVENT_EMITTER_EVENTS.EXECUTION_REALTIME,
      (eventData: IEventEmitterEventData) => {
        if (isHierarchicalEventData(eventData)) {
          handleRealtimeUpdate(eventData, this.createContext());
        }
      },
    );
    this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_REALTIME, (eventData) => {
      handleToolRealtimeUpdate(eventData, this.createContext());
    });

    this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_START, (eventData) => {
      handleExecutionStart(eventData, this.createContext());
    });
    this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_COMPLETE, (eventData) => {
      handleExecutionComplete(eventData, this.createContext());
    });
  }

  private createContext(): IExecutionSubscriberContext {
    return {
      blockCollector: this.blockCollector,
      activeExecutions: this.activeExecutions,
      generateBlockId,
      getParentBlockId: this.getParentBlockId.bind(this),
    };
  }

  private getParentBlockId(parentExecutionId?: string): string | undefined {
    if (!parentExecutionId) return undefined;

    const parentExecution = this.activeExecutions.get(parentExecutionId);
    return parentExecution?.blockId;
  }

  dispose(): void {
    this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeFunctions = [];
    this.activeExecutions.clear();
  }
}
