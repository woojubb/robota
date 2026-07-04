import {
  AbstractPlugin,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  type IPluginErrorContext,
  PluginCategory,
  PluginPriority,
} from '../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../utils/logger';
import { InMemoryEventEmitterMetrics, type IEventEmitterMetrics } from './event-emitter/metrics';
import {
  EVENT_EMITTER_EVENTS,
  type IEventEmitterEventData,
  type TEventDataValue,
  type TEventName,
  type TEventEmitterListener,
} from './event-emitter/types';
import {
  validateEventEmitterOptions,
  executeEventHandler,
  processEvent as processEventHelper,
  buildEventEmitterStats,
  registerHandler,
  unregisterHandler,
  buildToolCallEmitData,
} from './event-emitter-helpers';

import type { IToolExecutionContext } from '../interfaces/tool';
import type { TTimerId } from '../utils';
import type {
  IEventEmitterHandlerRegistration,
  IEventEmitterPluginOptions,
  IEventEmitterPluginStats,
} from './event-emitter/plugin-types';

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
} from './event-emitter/plugin-types';
export type { IEventEmitterEventData, TEventEmitterListener };

const DEFAULT_MAX_LISTENERS = 100;

/** Provides pub/sub event coordination during the agent execution lifecycle. */
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
    validateEventEmitterOptions(options, this.name);

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
      // CORE-021: the scheduled flush must never float — with catchErrors: false a
      // handler error rejects flushBuffer(), and an unhandled rejection kills the
      // process on Node 20+. The timer is a last-resort surface: log, never rethrow.
      this.bufferTimer = setInterval(() => {
        this.flushBuffer().catch((error: unknown) => {
          this.logger.error('Buffered flush failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
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
    await this.emit(EVENT_EMITTER_EVENTS.CONVERSATION_START, {
      executionId: context.executionId,
      sessionId: context.sessionId,
      userId: context.userId,
      data: {
        messages: context.messages?.map((msg) => ({
          role: msg.role,
          content: msg.content || '',
          timestamp: msg.timestamp ? msg.timestamp.toISOString() : new Date().toISOString(),
        })),
        config: context.config as Record<string, TEventDataValue>,
      },
    });
  }

  override async afterConversation(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    await this.emit(EVENT_EMITTER_EVENTS.CONVERSATION_COMPLETE, {
      executionId: context.executionId,
      sessionId: context.sessionId,
      userId: context.userId,
      data: {
        response: result.content || result.response,
        tokensUsed: result.usage?.totalTokens || result.tokensUsed,
        toolCalls: result.toolCalls?.map((call) => ({
          id: call.id || '',
          name: call.name || '',
          arguments: JSON.stringify(call.arguments || {}),
          result: String(call.result || ''),
        })),
      },
    });
  }

  override async beforeToolExecution(
    context: IPluginExecutionContext,
    toolData: IToolExecutionContext,
  ): Promise<void> {
    if (!toolData) return;
    await this.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
      executionId: context.executionId,
      sessionId: context.sessionId,
      userId: context.userId,
      data: {
        toolName: toolData.toolName,
        toolId: toolData.executionId,
        arguments: JSON.stringify(toolData.parameters ?? {}),
      },
    });
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
      const baseData = buildToolCallEmitData(context, toolCall, toolResults.duration);
      await this.emit(eventType, baseData);
      await this.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
        ...baseData,
        data: { ...baseData.data, toolResult: String(toolCall.result || '') },
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
    options?: { once?: boolean; filter?: (event: IEventEmitterEventData) => boolean },
  ): string {
    const handlerId = `handler_${this.nextHandlerId++}`;
    registerHandler(
      this.handlers,
      eventType,
      handlerId,
      listener,
      options,
      this.pluginOptions.maxListeners,
      this.name,
    );
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
    return unregisterHandler(this.handlers, eventType, handlerIdOrListener);
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
      // CORE-021: overflow flush is awaited — emit() is async and its caller owns the
      // rejection path (a floating call here was the second unhandled-rejection source).
      if (this.eventBuffer.length >= this.pluginOptions.buffer.maxSize) await this.flushBuffer();
      return;
    }
    await this.processEvent(event);
  }

  private async processEvent(event: IEventEmitterEventData): Promise<void> {
    await processEventHelper(
      event,
      this.handlers,
      this.pluginOptions.async,
      (t, id) => this.off(t, id),
      (h, e) =>
        executeEventHandler(h, e, this.metrics, this.pluginOptions.catchErrors, this.logger),
    );
  }

  async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    for (const event of events) await this.processEvent(event);
  }

  override getStats(): IEventEmitterPluginStats {
    return buildEventEmitterStats(
      super.getStats(),
      this.handlers,
      this.eventBuffer.length,
      this.metrics,
    );
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
