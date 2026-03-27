import {
  AbstractPlugin,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  type IPluginErrorContext,
  PluginCategory,
  PluginPriority,
  type IToolExecutionContext,
  createLogger,
  type ILogger,
  PluginError,
  type TTimerId,
} from '@robota-sdk/agent-core';
import {
  EVENT_EMITTER_EVENTS,
  type IEventEmitterEventData,
  type TEventName,
  type TEventEmitterListener,
  type TEventDataValue,
} from './types';
import { InMemoryEventEmitterMetrics, type IEventEmitterMetrics } from './metrics';
import type {
  IEventEmitterHandlerRegistration,
  IEventEmitterPluginOptions,
  IEventEmitterPluginStats,
} from './plugin-types';
import {
  validateEventEmitterOptions,
  buildConversationStartData,
  buildConversationCompleteData,
  buildToolBeforeData,
  buildToolAfterBaseData,
} from './event-emitter-helpers';

// Re-export types that were originally exported from this file
export type { TEventName };
export type {
  TEventExecutionValue,
  IEventExecutionContextData,
  TEventEmitterMetadata,
  IEventEmitterPluginExecutionContext,
  IEventEmitterPluginExecutionResult,
  IEventEmitterHierarchicalEventData,
  IEventEmitterPluginOptions,
  IEventEmitterPluginStats,
} from './plugin-types';
export type { IEventEmitterEventData, TEventEmitterListener };

const DEFAULT_MAX_LISTENERS = 100;

/**
 * Provides pub/sub event coordination during the agent execution lifecycle.
 * @extends AbstractPlugin
 * @see IEventEmitterPluginOptions
 * @see EVENT_EMITTER_EVENTS
 */
export class EventEmitterPlugin extends AbstractPlugin<
  IEventEmitterPluginOptions,
  IEventEmitterPluginStats
> {
  name = 'EventEmitterPlugin';
  version = '1.0.0';

  private pluginOptions: Required<Omit<IEventEmitterPluginOptions, 'metrics'>>;
  private logger: ILogger;
  private handlers = new Map<TEventName, IEventEmitterHandlerRegistration[]>();
  private eventBuffer: IEventEmitterEventData[] = [];
  private nextHandlerId = 1;
  private bufferTimer?: TTimerId;
  private metrics: IEventEmitterMetrics;

  constructor(options: IEventEmitterPluginOptions = {}) {
    super();
    this.logger = createLogger('EventEmitterPlugin');
    this.metrics = options.metrics ?? new InMemoryEventEmitterMetrics();
    validateEventEmitterOptions(options, 'EventEmitterPlugin');

    this.pluginOptions = {
      enabled: options.enabled ?? true,
      events: options.events ?? [
        EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START,
        EVENT_EMITTER_EVENTS.AGENT_EXECUTION_COMPLETE,
        EVENT_EMITTER_EVENTS.AGENT_EXECUTION_ERROR,
        EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE,
        EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE,
        EVENT_EMITTER_EVENTS.TOOL_SUCCESS,
        EVENT_EMITTER_EVENTS.TOOL_ERROR,
      ],
      maxListeners: options.maxListeners ?? DEFAULT_MAX_LISTENERS,
      async: options.async ?? true,
      catchErrors: options.catchErrors ?? true,
      filters:
        options.filters ?? ({} as Record<TEventName, (event: IEventEmitterEventData) => boolean>),
      buffer: options.buffer ?? { enabled: false, maxSize: 1000, flushInterval: 5000 },
      category: options.category ?? PluginCategory.EVENT_PROCESSING,
      priority: options.priority ?? PluginPriority.HIGH,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
    };

    if (this.pluginOptions.buffer.enabled) {
      this.bufferTimer = setInterval(() => {
        this.flushBuffer();
      }, this.pluginOptions.buffer.flushInterval);
    }
  }

  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START, {
      executionId: context.executionId,
      sessionId: context.sessionId,
      userId: context.userId,
      data: {
        messageCount: context.messages?.length || 0,
        ...(context.config && { config: context.config }),
      },
    });
  }

  override async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_COMPLETE, {
      executionId: context.executionId,
      sessionId: context.sessionId,
      userId: context.userId,
      data: {
        duration: result?.duration,
        tokensUsed: result?.tokensUsed,
        toolsExecuted: result?.toolsExecuted,
      },
    });
  }

  override async beforeConversation(context: IPluginExecutionContext): Promise<void> {
    await this.emit(EVENT_EMITTER_EVENTS.CONVERSATION_START, buildConversationStartData(context));
  }

  override async afterConversation(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    await this.emit(
      EVENT_EMITTER_EVENTS.CONVERSATION_COMPLETE,
      buildConversationCompleteData(context, result),
    );
  }

  override async beforeToolExecution(
    context: IPluginExecutionContext,
    toolData: IToolExecutionContext,
  ): Promise<void> {
    if (!toolData) return;
    await this.emit(
      EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE,
      buildToolBeforeData(context, toolData),
    );
  }

  override async afterToolExecution(
    context: IPluginExecutionContext,
    toolResults: IPluginExecutionResult,
  ): Promise<void> {
    if (!toolResults.toolCalls || toolResults.toolCalls.length === 0) return;
    for (const toolCall of toolResults.toolCalls) {
      const eventType =
        toolCall.result === null
          ? EVENT_EMITTER_EVENTS.TOOL_ERROR
          : EVENT_EMITTER_EVENTS.TOOL_SUCCESS;
      const baseData = buildToolAfterBaseData(context, toolCall, toolResults.duration);
      await this.emit(eventType, baseData);
      await this.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
        ...baseData,
        data: {
          ...(baseData.data as Record<string, TEventDataValue>),
          toolResult: String(toolCall.result || ''),
        },
      });
    }
  }

  override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_ERROR, {
      executionId: context?.executionId,
      sessionId: context?.sessionId,
      userId: context?.userId,
      error: error instanceof Error ? error : new Error(String(error)),
      data: { action: context?.action, tool: context?.tool, attempt: context?.attempt },
    });
  }

  on(
    eventType: TEventName,
    listener: TEventEmitterListener,
    options?: {
      once?: boolean;
      filter?: (event: IEventEmitterEventData) => boolean;
    },
  ): string {
    const handlerId = `handler_${this.nextHandlerId++}`;
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, []);
    const handlers = this.handlers.get(eventType)!;
    if (handlers.length >= this.pluginOptions.maxListeners) {
      throw new PluginError(
        `Maximum listeners (${this.pluginOptions.maxListeners}) exceeded for event type: ${eventType}`,
        this.name,
        { eventType, currentListeners: handlers.length },
      );
    }
    handlers.push({
      id: handlerId,
      listener,
      once: options?.once ?? false,
      ...(options?.filter && { filter: options.filter }),
    });
    return handlerId;
  }

  once(
    eventType: TEventName,
    listener: TEventEmitterListener,
    filter?: (event: IEventEmitterEventData) => boolean,
  ): string {
    return this.on(eventType, listener, { once: true, ...(filter && { filter }) });
  }

  off(eventType: TEventName, handlerIdOrListener: string | TEventEmitterListener): boolean {
    const handlers = this.handlers.get(eventType);
    if (!handlers) return false;
    const index =
      typeof handlerIdOrListener === 'string'
        ? handlers.findIndex((h) => h.id === handlerIdOrListener)
        : handlers.findIndex((h) => h.listener === handlerIdOrListener);
    if (index !== -1) {
      handlers.splice(index, 1);
      return true;
    }
    return false;
  }

  async emit(
    eventType: TEventName,
    eventData: Partial<IEventEmitterEventData> = {},
  ): Promise<void> {
    if (!this.pluginOptions.events.includes(eventType)) return;
    const event: IEventEmitterEventData = { type: eventType, timestamp: new Date(), ...eventData };
    const globalFilter = this.pluginOptions.filters[eventType];
    if (globalFilter && !globalFilter(event)) return;
    this.metrics.incrementEmitted();
    if (this.pluginOptions.buffer.enabled) {
      this.eventBuffer.push(event);
      if (this.eventBuffer.length >= this.pluginOptions.buffer.maxSize) this.flushBuffer();
      return;
    }
    await this.processEvent(event);
  }

  private async processEvent(event: IEventEmitterEventData): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.length === 0) return;
    const handlersToCall = handlers.filter((h) => !h.filter || h.filter(event));
    if (handlersToCall.length === 0) return;
    for (const h of handlersToCall.filter((h) => h.once)) this.off(event.type, h.id);
    if (this.pluginOptions.async) {
      await Promise.all(handlersToCall.map((h) => this.executeHandler(h, event)));
      return;
    }
    for (const h of handlersToCall) await this.executeHandler(h, event);
  }

  private async executeHandler(
    handler: IEventEmitterHandlerRegistration,
    event: IEventEmitterEventData,
  ): Promise<void> {
    try {
      await handler.listener(event);
    } catch (error) {
      this.metrics.incrementErrors();
      if (this.pluginOptions.catchErrors) {
        this.logger.error('Event handler error', {
          eventType: event.type,
          handlerId: handler.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    for (const event of events) await this.processEvent(event);
  }

  override getStats(): IEventEmitterPluginStats {
    const base = super.getStats();
    const metrics = this.metrics.getSnapshot();
    const listenerCounts: Partial<Record<TEventName, number>> = {};
    let totalListeners = 0;
    for (const [eventType, handlers] of this.handlers) {
      listenerCounts[eventType] = handlers.length;
      totalListeners += handlers.length;
    }
    return {
      ...base,
      eventTypes: Array.from(this.handlers.keys()),
      listenerCounts,
      totalListeners,
      bufferedEvents: this.eventBuffer.length,
      totalEmitted: metrics.totalEmitted,
      totalErrors: metrics.totalErrors,
    };
  }

  clearAllListeners(): void {
    this.handlers.clear();
  }

  async destroy(): Promise<void> {
    if (this.bufferTimer) clearInterval(this.bufferTimer);
    await this.flushBuffer();
    this.clearAllListeners();
  }
}
