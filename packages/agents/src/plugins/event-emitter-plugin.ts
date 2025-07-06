import { BasePlugin, type BaseExecutionContext, type BaseExecutionResult, type ErrorContext, PluginCategory, PluginPriority } from '../abstracts/base-plugin';
import { Logger, createLogger } from '../utils/logger';
import { PluginError } from '../utils/errors';

/**
 * Event types that can be emitted
 */
export type EventType =
    | 'execution.start'
    | 'execution.complete'
    | 'execution.error'
    | 'conversation.start'
    | 'conversation.complete'
    | 'conversation.error'
    | 'tool.beforeExecute'
    | 'tool.afterExecute'
    | 'tool.success'
    | 'tool.error'
    | 'plugin.error'
    | 'module.initialize.start'
    | 'module.initialize.complete'
    | 'module.initialize.error'
    | 'module.execution.start'
    | 'module.execution.complete'
    | 'module.execution.error'
    | 'module.dispose.start'
    | 'module.dispose.complete'
    | 'module.dispose.error'
    | 'module.registered'
    | 'module.unregistered'
    | 'custom';

/**
 * Basic event execution value types - compatible with BaseExecutionResult
 */
export type EventExecutionValue =
    | string
    | number
    | boolean
    | Date
    | string[]
    | number[]
    | boolean[]
    | object
    | null
    | undefined;

/**
 * Event execution context data following semantic naming conventions
 * Supports nested structures with proper type safety
 */
export interface EventExecutionContextData {
    messageCount?: number | undefined;
    config?: Record<string, EventExecutionValue> | undefined;
    result?: BaseExecutionResult | undefined;
    duration?: number | undefined;
    tokensUsed?: number | undefined;
    toolsExecuted?: number | undefined;
    messages?: Record<string, EventExecutionValue>[] | undefined;
    response?: string | undefined;
    toolCalls?: Record<string, EventExecutionValue>[] | undefined;
    [key: string]: EventExecutionValue | Record<string, EventExecutionValue> | Record<string, EventExecutionValue>[] | BaseExecutionResult | undefined;
}

/**
 * Event metadata following semantic naming conventions
 */
export type EventEmitterMetadata = Record<string, string | number | boolean | Date | string[] | number[] | undefined>;

/**
 * Plugin execution context for event emitter
 */
export interface PluginExecutionContext extends BaseExecutionContext {
    // Override config to support additional types
}



/**
 * Plugin execution result for event emitter
 */
export interface PluginExecutionResult {
    content?: string;
    response?: string;
    duration?: number;
    tokensUsed?: number;
    toolsExecuted?: number;
    usage?: Record<string, EventExecutionValue>;
    toolCalls?: Record<string, EventExecutionValue>[];
    [key: string]: EventExecutionValue | Record<string, EventExecutionValue> | Record<string, EventExecutionValue>[] | undefined;
}

/**
 * Event data structure
 */
export interface EventData {
    type: EventType;
    timestamp: Date;
    executionId?: string | undefined;
    sessionId?: string | undefined;
    userId?: string | undefined;
    data?: EventExecutionContextData | undefined;
    error?: Error | undefined;
    metadata?: EventEmitterMetadata | undefined;
}

/**
 * Event listener function
 */
export type EventListener = (event: EventData) => void | Promise<void>;

/**
 * Event handler registration
 */
interface EventHandler {
    id: string;
    listener: EventListener;
    once: boolean;
    filter?: (event: EventData) => boolean;
}

import type { BasePluginOptions } from '../abstracts/base-plugin';

/**
 * Event emitter configuration
 */
export interface EventEmitterPluginOptions extends BasePluginOptions {
    /** Events to listen for */
    events?: EventType[];
    /** Maximum number of listeners per event type */
    maxListeners?: number;
    /** Whether to emit events asynchronously */
    async?: boolean;
    /** Whether to catch and log listener errors */
    catchErrors?: boolean;
    /** Custom event filters */
    filters?: Record<EventType, (event: EventData) => boolean>;
    /** Event buffering options */
    buffer?: {
        enabled: boolean;
        maxSize: number;
        flushInterval: number;
    };
}

/**
 * Event emitter plugin statistics
 */
export interface EventEmitterPluginStats {
    eventTypes: EventType[];
    listenerCounts: Record<EventType, number>;
    totalListeners: number;
    bufferedEvents: number;
    totalEmitted: number;
    totalErrors: number;
}

/**
 * Plugin for event detection and propagation
 * Emits events during agent execution lifecycle
 */
export class EventEmitterPlugin extends BasePlugin<EventEmitterPluginOptions, EventEmitterPluginStats> {
    name = 'EventEmitterPlugin';
    version = '1.0.0';


    private pluginOptions: Required<EventEmitterPluginOptions>;
    private logger: Logger;
    private handlers = new Map<EventType, EventHandler[]>();
    private eventBuffer: EventData[] = [];
    private nextHandlerId = 1;
    private bufferTimer?: NodeJS.Timeout;

    constructor(options: EventEmitterPluginOptions = {}) {
        super();
        this.logger = createLogger('EventEmitterPlugin');

        this.pluginOptions = {
            enabled: options.enabled ?? true,
            events: options.events ?? [
                'execution.start',
                'execution.complete',
                'execution.error',
                'tool.beforeExecute',
                'tool.afterExecute',
                'tool.success',
                'tool.error'
            ],
            maxListeners: options.maxListeners ?? 100,
            async: options.async ?? true,
            catchErrors: options.catchErrors ?? true,
            filters: options.filters ?? {} as Record<EventType, (event: EventData) => boolean>,
            buffer: options.buffer ?? {
                enabled: false,
                maxSize: 1000,
                flushInterval: 5000
            },
            // Add BasePluginOptions defaults
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
            bufferEnabled: this.pluginOptions.buffer.enabled
        });
    }

    /**
     * Before execution starts
     */
    override async beforeExecution(context: BaseExecutionContext): Promise<void> {
        await this.emit('execution.start', {
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
    override async afterExecution(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> {
        await this.emit('execution.complete', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                result: result,
                duration: result?.duration,
                tokensUsed: result?.tokensUsed,
                toolsExecuted: result?.toolsExecuted
            }
        });
    }

    /**
     * Before conversation starts
     */
    override async beforeConversation(context: BaseExecutionContext): Promise<void> {
        await this.emit('conversation.start', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                messages: context.messages?.map(msg => ({
                    role: msg.role,
                    content: msg.content || '',
                    timestamp: msg.timestamp ? msg.timestamp.toISOString() : new Date().toISOString()
                })),
                config: context.config as Record<string, EventExecutionValue>
            }
        });
    }

    /**
     * After conversation completes
     */
    override async afterConversation(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> {
        await this.emit('conversation.complete', {
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
     * Before tool execution
     * 
     * REASON: Tool data structure varies by provider and tool type, needs flexible handling for event processing
     * ALTERNATIVES_CONSIDERED:
     * 1. Strict tool interfaces (breaks provider compatibility)
     * 2. Union types (insufficient for dynamic tool data)
     * 3. Generic constraints (too complex for event handling)
     * 4. Interface definitions (too rigid for varied tool structures)
     * 5. Type assertions (decreases type safety)
     * TODO: Consider standardized tool data interface across providers
     */
    override async beforeToolExecution(context: BaseExecutionContext, toolData: Record<string, string | number | boolean | object | Array<string | number | boolean> | null | undefined>): Promise<void> {
        const toolCalls = Array.isArray(toolData?.['toolCalls']) ? toolData['toolCalls'] :
            toolData ? [toolData] : [];

        for (const toolCall of toolCalls) {
            await this.emit('tool.beforeExecute', {
                executionId: context.executionId,
                sessionId: context.sessionId,
                userId: context.userId,
                data: {
                    toolName: toolCall.function?.name || toolCall.name,
                    toolId: toolCall.id,
                    arguments: toolCall.function?.arguments || toolCall.arguments
                }
            });
        }
    }

    /**
     * After tool execution
     * 
     * REASON: Tool results structure varies by provider and tool type, needs flexible handling for event processing
     * ALTERNATIVES_CONSIDERED:
     * 1. Strict result interfaces (breaks provider compatibility)
     * 2. Union types (insufficient for dynamic result data)
     * 3. Generic constraints (too complex for event handling)
     * 4. Interface definitions (too rigid for varied result structures)
     * 5. Type assertions (decreases type safety)
     * TODO: Consider standardized tool result interface across providers
     */
    override async afterToolExecution(context: BaseExecutionContext, toolResults: Record<string, string | number | boolean | object | Array<string | number | boolean> | null | undefined>): Promise<void> {
        const results = Array.isArray(toolResults?.['results']) ? toolResults['results'] :
            toolResults ? [toolResults] : [];

        for (const result of results) {
            const eventType = result.error ? 'tool.error' : 'tool.success';

            await this.emit(eventType, {
                executionId: context.executionId,
                sessionId: context.sessionId,
                userId: context.userId,
                data: {
                    toolName: result.toolName,
                    toolId: result.toolId || result.executionId,
                    result: result.error ? undefined : result.result,
                    duration: result.duration,
                    success: result.error ? false : true
                },
                error: result.error
            });

            // Also emit generic afterExecute event
            await this.emit('tool.afterExecute', {
                executionId: context.executionId,
                sessionId: context.sessionId,
                userId: context.userId,
                data: {
                    toolName: result.toolName,
                    toolId: result.toolId || result.executionId,
                    result: result.result,
                    duration: result.duration,
                    success: result.error ? false : true
                },
                error: result.error
            });
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
    override async onError(error: Error, context?: ErrorContext): Promise<void> {
        await this.emit('execution.error', {
            executionId: context?.executionId,
            sessionId: context?.sessionId,
            userId: context?.userId,
            error: error instanceof Error ? error : new Error(String(error)),
            data: {
                context: context
            }
        });
    }

    /**
     * Register event listener
     */
    on(eventType: EventType, listener: EventListener, options?: {
        once?: boolean;
        filter?: (event: EventData) => boolean;
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
    once(eventType: EventType, listener: EventListener, filter?: (event: EventData) => boolean): string {
        return this.on(eventType, listener, {
            once: true,
            ...(filter && { filter })
        });
    }

    /**
     * Remove event listener
     */
    off(eventType: EventType, handlerIdOrListener: string | EventListener): boolean {
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
    async emit(eventType: EventType, eventData: Partial<EventData> = {}): Promise<void> {
        if (!this.pluginOptions.events.includes(eventType)) {
            return;
        }

        const event: EventData = {
            type: eventType,
            timestamp: new Date(),
            ...eventData
        };

        // Apply global filter if exists
        const globalFilter = this.pluginOptions.filters[eventType];
        if (globalFilter && !globalFilter(event)) {
            return;
        }

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
    private async processEvent(event: EventData): Promise<void> {
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

        // Execute handlers
        const promises = handlersToCall.map(async (handler) => {
            try {
                if (this.pluginOptions.async) {
                    await handler.listener(event);
                } else {
                    handler.listener(event);
                }
            } catch (error) {
                if (this.pluginOptions.catchErrors) {
                    this.logger.error('Event handler error', {
                        eventType: event.type,
                        handlerId: handler.id,
                        error: error instanceof Error ? error.message : String(error)
                    });

                    // Emit plugin error event
                    await this.emit('plugin.error', {
                        error: error instanceof Error ? error : new Error(String(error)),
                        data: {
                            handlerId: handler.id,
                            originalEvent: event
                        }
                    });
                } else {
                    throw error;
                }
            }
        });

        if (this.pluginOptions.async) {
            await Promise.allSettled(promises);
        }
    }

    /**
     * Buffer an event
     */
    private bufferEvent(event: EventData): void {
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
    override getStats(): EventEmitterPluginStats {
        const listenerCounts: Record<EventType, number> = {} as Record<EventType, number>;
        let totalListeners = 0;

        for (const [eventType, handlers] of this.handlers) {
            listenerCounts[eventType] = handlers.length;
            totalListeners += handlers.length;
        }

        return {
            eventTypes: Array.from(this.handlers.keys()),
            listenerCounts,
            totalListeners,
            bufferedEvents: this.eventBuffer.length,
            totalEmitted: 0, // TODO: Track total emitted events
            totalErrors: 0 // TODO: Track total listener errors
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
} 