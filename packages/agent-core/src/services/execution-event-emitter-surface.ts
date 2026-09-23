/**
 * Structural surface of `ExecutionEventEmitter` used by its high-level emit helpers.
 *
 * Extracted so `execution-event-emitter-high-level.ts` can type its `emitter` parameter without
 * importing the `ExecutionEventEmitter` class from `execution-event-emitter.ts`, which in turn
 * imports the high-level helpers — a module-level import cycle. `ExecutionEventEmitter` satisfies
 * this interface structurally; no change to the class itself is needed.
 */
import type {
  IEventContext,
  IEventService,
  IExecutionEventData,
  IToolEventData,
  IBaseEventData,
} from '../interfaces/event-service';

export interface IExecutionEventEmitterSurface {
  emitExecution(
    eventType: string,
    data: Omit<IExecutionEventData, 'timestamp'>,
    rootId: string,
    executionId: string,
  ): void;

  emitTool(
    eventType: string,
    data: Omit<IToolEventData, 'timestamp'>,
    rootId: string,
    executionId: string,
    toolCallId: string,
  ): void;

  emitWithContext<TEvent extends IBaseEventData>(
    eventType: string,
    data: Omit<TEvent, 'timestamp'>,
    buildContext: () => IEventContext,
    resolveService: (context: IEventContext) => IEventService,
  ): void;

  buildThinkingOwnerContext(
    rootId: string,
    executionId: string,
    thinkingNodeId: string,
    previousThinkingNodeId?: string,
  ): IEventContext;

  buildResponseOwnerContext(
    rootId: string,
    executionId: string,
    thinkingNodeId: string,
    previousThinkingNodeId?: string,
  ): IEventContext;
}
