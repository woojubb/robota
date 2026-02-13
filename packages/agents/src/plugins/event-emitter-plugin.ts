import {
    AbstractPlugin,
    type IPluginExecutionContext,
    type IPluginExecutionResult,
    type IPluginErrorContext,
    type IPluginOptions,
    type IPluginStats,
    PluginCategory,
    PluginPriority
} from '../abstracts/abstract-plugin';
import type { IToolExecutionContext, TToolParameters, IToolResult } from '../interfaces/tool';
import { createLogger, type ILogger } from '../utils/logger';
import { PluginError } from '../utils/errors';
import type { TTimerId } from '../utils';
import {
    EVENT_EMITTER_EVENTS,
    type IEventEmitterEventData,
    type TEventName,
    type TEventEmitterListener
} from './event-emitter/types';
import { InMemoryEventEmitterMetrics, type IEventEmitterMetrics } from './event-emitter/metrics';

export type { TEventName };

/**
 * Basic event execution value types - compatible with IPluginExecutionResult
 */
export type TEventExecutionValue =
    | string
    | number
    | boolean
    | Date
    | string[]
    | number[]
    | boolean[]
    | Record<string, string | number | boolean | null>
    | null
    | undefined;

/**
 * Event execution context data following semantic naming conventions
 * Supports nested structures with proper type safety
 */
export interface IEventExecutionContextData {
    messageCount?: number | undefined;
    config?: Record<string, TEventExecutionValue> | undefined;
    result?: IPluginExecutionResult | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    messages?: Record<string, TEventExecutionValue>[] | undefined;
    response?: string | undefined;
    toolCalls?: Record<string, TEventExecutionValue>[] | undefined;
    [key: string]: TEventExecutionValue | Record<string, TEventExecutionValue> | Record<string, TEventExecutionValue>[] | IPluginExecutionResult | undefined;
}

/**
 * Event metadata following semantic naming conventions
 */
export type TEventEmitterMetadata = Record<string, string | number | boolean | Date | string[] | number[] | undefined>;

/**
 * Plugin execution context for event emitter
 */
export interface IEventEmitterPluginExecutionContext extends IPluginExecutionContext {
    // Override config to support additional types
}



/**
 * Plugin execution result for event emitter
 */
export interface IEventEmitterPluginExecutionResult {
    content?: string;
    response?: string;
    duration?: number;
    tokensUsed?: number;
    toolsExecuted?: number;
    usage?: Record<string, TEventExecutionValue>;
    toolCalls?: Record<string, TEventExecutionValue>[];
    [key: string]: TEventExecutionValue | Record<string, TEventExecutionValue> | Record<string, TEventExecutionValue>[] | undefined;
}

/**
 * Event data structure
 */
export type { IEventEmitterEventData };

/**
 * 🆕 Enhanced event data for hierarchical execution tracking
 * Extends IEventEmitterEventData with additional fields for parent-child relationships and real-time data
 */
export interface IEventEmitterHierarchicalEventData extends IEventEmitterEventData {
    /** Parent execution ID for hierarchical tracking */
    parentExecutionId?: string;

    /** Root execution ID (Team/Agent level) */
    rootExecutionId?: string;

    /** Execution depth level (0: Team, 1: Agent, 2: Tool, etc.) */
    executionLevel: number;

    /** Execution path showing complete hierarchy */
    executionPath: string[];

    /** Real-time execution data (no simulation) */
    realTimeData?: {
        /** Actual execution start time */
        startTime: Date;
        /** Actual duration in milliseconds (when completed) */
        actualDuration?: number;
        /** Actual input parameters */
        actualParameters?: TToolParameters;
        /** Actual execution result */
        actualResult?: IToolResult;
    };
}

/**
 * Event listener function
 */
export type { TEventEmitterListener };

/**
 * Event handler registration
 */
interface IEventEmitterHandlerRegistration {
    id: string;
    listener: TEventEmitterListener;
    once: boolean;
    filter?: (event: IEventEmitterEventData) => boolean;
}

/**
 * Event emitter configuration
 */
export interface IEventEmitterPluginOptions extends IPluginOptions {
    /** Events to listen for */
    events?: TEventName[];
    /** Maximum number of listeners per event type */
    maxListeners?: number;
    /** Whether to emit events asynchronously */
    async?: boolean;
    /** Whether to catch and log listener errors */
    catchErrors?: boolean;
    /** Custom event filters */
    filters?: Record<TEventName, (event: IEventEmitterEventData) => boolean>;
    /** Event buffering options */
    buffer?: {
        enabled: boolean;
        maxSize: number;
        flushInterval: number;
    };
    /** Metrics collector (optional) */
    metrics?: IEventEmitterMetrics;
}

/**
 * Event emitter plugin statistics
 */
export interface IEventEmitterPluginStats extends IPluginStats {
    eventTypes: TEventName[];
    listenerCounts: Record<TEventName, number>;
    totalListeners: number;
    bufferedEvents: number;
    totalEmitted: number;
    totalErrors: number;
}

/**
 * Plugin for event detection and propagation
 * Emits events during agent execution lifecycle
 */
export class EventEmitterPlugin extends AbstractPlugin<IEventEmitterPluginOptions, IEventEmitterPluginStats> {
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

        // Validate options
        this.validateOptions(options);

        this.pluginOptions = {
            enabled: options.enabled ?? true,
            events: options.events ?? [
                EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START,
                EVENT_EMITTER_EVENTS.AGENT_EXECUTION_COMPLETE,
                EVENT_EMITTER_EVENTS.AGENT_EXECUTION_ERROR,
                EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE,
                EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE,
                EVENT_EMITTER_EVENTS.TOOL_SUCCESS,
                EVENT_EMITTER_EVENTS.TOOL_ERROR
            ],
            maxListeners: options.maxListeners ?? 100,
            async: options.async ?? true,
            catchErrors: options.catchErrors ?? true,
            filters: options.filters ?? {} as Record<TEventName, (event: IEventEmitterEventData) => boolean>,
            buffer: options.buffer ?? {
                enabled: false,
                maxSize: 1000,
                flushInterval: 5000
            },
            // Add plugin options defaults
            category: options.category ?? PluginCategory.EVENT_PROCESSING,
            priority: options.priority ?? PluginPriority.HIGH,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false
        };

        if (this.pluginOptions.buffer.enabled) {
            this.setupBuffering();
        }

        this.logger.info('EventEmitterPlugin initialized', {
            events: this.pluginOptions.events,
            maxListeners: this.pluginOptions.maxListeners,
            async: this.pluginOptions.async,
            catchErrors: this.pluginOptions.catchErrors,
            bufferEnabled: this.pluginOptions.buffer.enabled
        });
    }

    /**
     * Before execution starts
     */
    override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
        await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START, {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                messageCount: context.messages?.length || 0,
                ...(context.config && { config: context.config })
            }
        });
    }

    /**
     * After execution completes
     */
    override async afterExecution(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> {
        await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_COMPLETE, {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                duration: result?.duration,
                tokensUsed: result?.tokensUsed,
                toolsExecuted: result?.toolsExecuted
            }
        });
    }

    /**
     * Before conversation starts
     */
    override async beforeConversation(context: IPluginExecutionContext): Promise<void> {
        await this.emit(EVENT_EMITTER_EVENTS.CONVERSATION_START, {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                messages: context.messages?.map(msg => ({
                    role: msg.role,
                    content: msg.content || '',
                    timestamp: msg.timestamp ? msg.timestamp.toISOString() : new Date().toISOString()
                })),
                config: context.config as Record<string, TEventExecutionValue>
            }
        });
    }

    /**
     * After conversation completes
     */
    override async afterConversation(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> {
        await this.emit(EVENT_EMITTER_EVENTS.CONVERSATION_COMPLETE, {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                response: result.content || result.response,
                tokensUsed: result.usage?.totalTokens || result.tokensUsed,
                toolCalls: result.toolCalls?.map(call => ({
                    id: call.id || '',
                    name: call.name || '',
                    arguments: JSON.stringify(call.arguments || {}),
                    result: String(call.result || '')
                }))
            }
        });
    }

    /**
     * Before tool execution - emits tool.beforeExecute event
     */
    override async beforeToolExecution(context: IPluginExecutionContext, toolData: IToolExecutionContext): Promise<void> {
        if (!toolData) {
            return;
        }
        const toolCalls: IToolExecutionContext[] = [toolData];

        for (const toolCall of toolCalls) {
            await this.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
                executionId: context.executionId,
                sessionId: context.sessionId,
                userId: context.userId,
                data: {
                    toolName: toolCall.toolName,
                    toolId: toolCall.executionId,
                    arguments: JSON.stringify(toolCall.parameters ?? {})
                }
            });
        }
    }

    /**
     * After tool execution - emits tool.success or tool.error events
     */
    override async afterToolExecution(context: IPluginExecutionContext, toolResults: IPluginExecutionResult): Promise<void> {
        // Handle tool results from IPluginExecutionResult
        if (toolResults.toolCalls && toolResults.toolCalls.length > 0) {
            for (const toolCall of toolResults.toolCalls) {
                const eventType = toolCall.result === null ? EVENT_EMITTER_EVENTS.TOOL_ERROR : EVENT_EMITTER_EVENTS.TOOL_SUCCESS;

                await this.emit(eventType, {
                    executionId: context.executionId,
                    sessionId: context.sessionId,
                    userId: context.userId,
                    data: {
                        toolName: toolCall.name || '',
                        toolId: toolCall.id || '',
                        toolResult: toolCall.result !== null ? String(toolCall.result) : undefined,
                        duration: toolResults.duration,
                        success: toolCall.result !== null
                    }
                });

                // Also emit generic afterExecute event
                await this.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
                    executionId: context.executionId,
                    sessionId: context.sessionId,
                    userId: context.userId,
                    data: {
                        toolName: toolCall.name || '',
                        toolId: toolCall.id || '',
                        toolResult: String(toolCall.result || ''),
                        duration: toolResults.duration,
                        success: toolCall.result !== null
                    }
                });
            }
        }
    }

    /**
     * On error
     * 
     * REASON: Error context structure varies by execution phase and error type, needs flexible handling
     * ALTERNATIVES_CONSIDERED:
     * 1. Strict error context interface (breaks error handling flexibility)
     * 2. Union types (insufficient for dynamic error contexts)
     * 3. Generic constraints (too complex for error handling)
     * 4. Interface definitions (too rigid for varied error contexts)
     * 5. Type assertions (decreases type safety)
     * TODO: Consider standardized error context interface
     */
    override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
        await this.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_ERROR, {
            executionId: context?.executionId,
            sessionId: context?.sessionId,
            userId: context?.userId,
            error: error instanceof Error ? error : new Error(String(error)),
            data: {
                action: context?.action,
                tool: context?.tool,
                attempt: context?.attempt
            }
        });
    }

    /**
     * Register event listener
     */
    on(eventType: TEventName, listener: TEventEmitterListener, options?: {
        once?: boolean;
        filter?: (event: IEventEmitterEventData) => boolean;
    }): string {
        const handlerId = `handler_${this.nextHandlerId++}`;

        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, []);
        }

        const handlers = this.handlers.get(eventType)!;

        if (handlers.length >= this.pluginOptions.maxListeners) {
            throw new PluginError(
                `Maximum listeners (${this.pluginOptions.maxListeners}) exceeded for event type: ${eventType}`,
                this.name,
                { eventType, currentListeners: handlers.length }
            );
        }

        handlers.push({
            id: handlerId,
            listener,
            once: options?.once ?? false,
            ...(options?.filter && { filter: options.filter })
        });

        this.logger.debug('Event listener registered', {
            eventType,
            handlerId,
            once: options?.once ?? false,
            hasFilter: options?.filter ? true : false
        });

        return handlerId;
    }

    /**
     * Register one-time event listener
     */
    once(eventType: TEventName, listener: TEventEmitterListener, filter?: (event: IEventEmitterEventData) => boolean): string {
        return this.on(eventType, listener, {
            once: true,
            ...(filter && { filter })
        });
    }

    /**
     * Remove event listener
     */
    off(eventType: TEventName, handlerIdOrListener: string | TEventEmitterListener): boolean {
        const handlers = this.handlers.get(eventType);
        if (!handlers) {
            return false;
        }

        const index = typeof handlerIdOrListener === 'string'
            ? handlers.findIndex(h => h.id === handlerIdOrListener)
            : handlers.findIndex(h => h.listener === handlerIdOrListener);

        if (index !== -1) {
            const removed = handlers.splice(index, 1)[0];
            if (removed) {
                this.logger.debug('Event listener removed', {
                    eventType,
                    handlerId: removed.id
                });
            }
            return true;
        }

        return false;
    }

    /**
     * Emit an event
     */
    async emit(eventType: TEventName, eventData: Partial<IEventEmitterEventData> = {}): Promise<void> {
        if (!this.pluginOptions.events.includes(eventType)) {
            return;
        }

        const event: IEventEmitterEventData = {
            type: eventType,
            timestamp: new Date(),
            ...eventData
        };

        // Apply global filter if exists
        const globalFilter = this.pluginOptions.filters[eventType];
        if (globalFilter && !globalFilter(event)) {
            return;
        }
        this.metrics.incrementEmitted();

        // Buffer events if enabled
        if (this.pluginOptions.buffer.enabled) {
            this.bufferEvent(event);
            return;
        }

        await this.processEvent(event);
    }

    /**
     * Process a single event
     */
    private async processEvent(event: IEventEmitterEventData): Promise<void> {
        const handlers = this.handlers.get(event.type);
        if (!handlers || handlers.length === 0) {
            return;
        }

        const handlersToCall = handlers.filter(handler => {
            return !handler.filter || handler.filter(event);
        });

        if (handlersToCall.length === 0) {
            return;
        }

        this.logger.debug('Emitting event', {
            type: event.type,
            handlersCount: handlersToCall.length,
            executionId: event.executionId || 'undefined'
        });

        // Remove one-time handlers
        const oneTimeHandlers = handlersToCall.filter(h => h.once);
        for (const handler of oneTimeHandlers) {
            this.off(event.type, handler.id);
        }

        // Execute handlers without fallback path.
        if (this.pluginOptions.async) {
            await Promise.all(handlersToCall.map(handler => this.executeHandler(handler, event)));
            return;
        }

        for (const handler of handlersToCall) {
            await this.executeHandler(handler, event);
        }
    }

    private async executeHandler(handler: IEventEmitterHandlerRegistration, event: IEventEmitterEventData): Promise<void> {
        try {
            await handler.listener(event);
        } catch (error) {
            this.metrics.incrementErrors();
            if (this.pluginOptions.catchErrors) {
                this.logger.error('Event handler error', {
                    eventType: event.type,
                    handlerId: handler.id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    /**
     * Buffer an event
     */
    private bufferEvent(event: IEventEmitterEventData): void {
        this.eventBuffer.push(event);

        if (this.eventBuffer.length >= this.pluginOptions.buffer.maxSize) {
            this.flushBuffer();
        }
    }

    /**
     * Setup event buffering
     */
    private setupBuffering(): void {
        this.bufferTimer = setInterval(() => {
            this.flushBuffer();
        }, this.pluginOptions.buffer.flushInterval);
    }

    /**
     * Flush buffered events
     */
    async flushBuffer(): Promise<void> {
        if (this.eventBuffer.length === 0) {
            return;
        }

        const events = [...this.eventBuffer];
        this.eventBuffer = [];

        this.logger.debug('Flushing event buffer', { eventCount: events.length });

        for (const event of events) {
            await this.processEvent(event);
        }
    }

    /**
     * Get event emitter statistics
     */
    override getStats(): IEventEmitterPluginStats {
        const base = super.getStats();
        const metrics = this.metrics.getSnapshot();
        const listenerCounts: Record<TEventName, number> = {} as Record<TEventName, number>;
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
            totalErrors: metrics.totalErrors
        };
    }

    /**
     * Clear all listeners
     */
    clearAllListeners(): void {
        this.handlers.clear();
        this.logger.info('All event listeners cleared');
    }

    /**
     * Cleanup on plugin destruction
     */
    async destroy(): Promise<void> {
        if (this.bufferTimer) {
            clearInterval(this.bufferTimer);
        }

        await this.flushBuffer();
        this.clearAllListeners();

        this.logger.info('EventEmitterPlugin destroyed');
    }

    /**
     * Validates the plugin options.
     * @param options The options to validate.
     * @throws PluginError if options are invalid.
     */
    private validateOptions(options: IEventEmitterPluginOptions): void {
        if (options.maxListeners !== undefined && options.maxListeners < 0) {
            throw new PluginError(
                `Invalid maxListeners option: ${options.maxListeners}. Must be a non-negative number.`,
                this.name,
                { maxListeners: options.maxListeners }
            );
        }

        if (options.buffer !== undefined && options.buffer.maxSize !== undefined && options.buffer.maxSize < 0) {
            throw new PluginError(
                `Invalid buffer.maxSize option: ${options.buffer.maxSize}. Must be a non-negative number.`,
                this.name,
                { bufferMaxSize: options.buffer.maxSize }
            );
        }

        if (options.buffer !== undefined && options.buffer.flushInterval !== undefined && options.buffer.flushInterval < 0) {
            throw new PluginError(
                `Invalid buffer.flushInterval option: ${options.buffer.flushInterval}. Must be a non-negative number.`,
                this.name,
                { bufferFlushInterval: options.buffer.flushInterval }
            );
        }
    }
} 