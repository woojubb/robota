import { BasePlugin } from '../abstracts/base-plugin.js';
import { Logger } from '../utils/logger.js';
import { PluginError } from '../utils/errors.js';

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
    | 'custom';

/**
 * Event data structure
 */
export interface EventData {
    type: EventType;
    timestamp: Date;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    data?: any;
    error?: Error;
    metadata?: Record<string, any>;
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

/**
 * Event emitter configuration
 */
export interface EventEmitterPluginOptions {
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
 * Plugin for event detection and propagation
 * Emits events during agent execution lifecycle
 */
export class EventEmitterPlugin extends BasePlugin {
    name = 'EventEmitterPlugin';
    version = '1.0.0';

    private options: Required<EventEmitterPluginOptions>;
    private logger: Logger;
    private handlers = new Map<EventType, EventHandler[]>();
    private eventBuffer: EventData[] = [];
    private nextHandlerId = 1;
    private bufferTimer?: NodeJS.Timeout;

    constructor(options: EventEmitterPluginOptions = {}) {
        super();
        this.logger = new Logger('EventEmitterPlugin');

        this.options = {
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
            }
        };

        if (this.options.buffer.enabled) {
            this.setupBuffering();
        }

        this.logger.info('EventEmitterPlugin initialized', {
            events: this.options.events,
            maxListeners: this.options.maxListeners,
            async: this.options.async,
            bufferEnabled: this.options.buffer.enabled
        });
    }

    /**
     * Before execution starts
     */
    async beforeExecution(context: any): Promise<void> {
        await this.emit('execution.start', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                messageCount: context.messages?.length || 0,
                config: context.config
            }
        });
    }

    /**
     * After execution completes
     */
    async afterExecution(context: any, result: any): Promise<void> {
        await this.emit('execution.complete', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                result,
                duration: result?.duration,
                tokensUsed: result?.tokensUsed,
                toolsExecuted: result?.toolsExecuted
            }
        });
    }

    /**
     * Before conversation starts
     */
    async beforeConversation(context: any): Promise<void> {
        await this.emit('conversation.start', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                messages: context.messages,
                config: context.config
            }
        });
    }

    /**
     * After conversation completes
     */
    async afterConversation(context: any, result: any): Promise<void> {
        await this.emit('conversation.complete', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
            data: {
                response: result?.content || result?.response,
                tokensUsed: result?.usage?.totalTokens || result?.tokensUsed,
                toolCalls: result?.toolCalls
            }
        });
    }

    /**
     * Before tool execution
     */
    async beforeToolExecution(context: any, toolData: any): Promise<void> {
        const toolCalls = Array.isArray(toolData?.toolCalls) ? toolData.toolCalls :
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
     */
    async afterToolExecution(context: any, toolResults: any): Promise<void> {
        const results = Array.isArray(toolResults?.results) ? toolResults.results :
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
                    success: !result.error
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
                    success: !result.error
                },
                error: result.error
            });
        }
    }

    /**
     * On error
     */
    async onError(context: any, error: any): Promise<void> {
        await this.emit('execution.error', {
            executionId: context.executionId,
            sessionId: context.sessionId,
            userId: context.userId,
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

        if (handlers.length >= this.options.maxListeners) {
            throw new PluginError(
                `Maximum listeners (${this.options.maxListeners}) exceeded for event type: ${eventType}`,
                this.name,
                { eventType, currentListeners: handlers.length }
            );
        }

        handlers.push({
            id: handlerId,
            listener,
            once: options?.once ?? false,
            filter: options?.filter
        });

        this.logger.debug('Event listener registered', {
            eventType,
            handlerId,
            once: options?.once,
            hasFilter: !!options?.filter
        });

        return handlerId;
    }

    /**
     * Register one-time event listener
     */
    once(eventType: EventType, listener: EventListener, filter?: (event: EventData) => boolean): string {
        return this.on(eventType, listener, { once: true, filter });
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
            this.logger.debug('Event listener removed', {
                eventType,
                handlerId: removed.id
            });
            return true;
        }

        return false;
    }

    /**
     * Emit an event
     */
    async emit(eventType: EventType, eventData: Partial<EventData> = {}): Promise<void> {
        if (!this.options.events.includes(eventType)) {
            return;
        }

        const event: EventData = {
            type: eventType,
            timestamp: new Date(),
            ...eventData
        };

        // Apply global filter if exists
        const globalFilter = this.options.filters[eventType];
        if (globalFilter && !globalFilter(event)) {
            return;
        }

        // Buffer events if enabled
        if (this.options.buffer.enabled) {
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
            executionId: event.executionId
        });

        // Remove one-time handlers
        const oneTimeHandlers = handlersToCall.filter(h => h.once);
        for (const handler of oneTimeHandlers) {
            this.off(event.type, handler.id);
        }

        // Execute handlers
        const promises = handlersToCall.map(async (handler) => {
            try {
                if (this.options.async) {
                    await handler.listener(event);
                } else {
                    handler.listener(event);
                }
            } catch (error) {
                if (this.options.catchErrors) {
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

        if (this.options.async) {
            await Promise.allSettled(promises);
        }
    }

    /**
     * Buffer an event
     */
    private bufferEvent(event: EventData): void {
        this.eventBuffer.push(event);

        if (this.eventBuffer.length >= this.options.buffer.maxSize) {
            this.flushBuffer();
        }
    }

    /**
     * Setup event buffering
     */
    private setupBuffering(): void {
        this.bufferTimer = setInterval(() => {
            this.flushBuffer();
        }, this.options.buffer.flushInterval);
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
     * Get listener statistics
     */
    getStats(): {
        eventTypes: EventType[];
        listenerCounts: Record<EventType, number>;
        totalListeners: number;
        bufferedEvents: number;
    } {
        const listenerCounts: Record<EventType, number> = {} as any;
        let totalListeners = 0;

        for (const [eventType, handlers] of this.handlers) {
            listenerCounts[eventType] = handlers.length;
            totalListeners += handlers.length;
        }

        return {
            eventTypes: Array.from(this.handlers.keys()),
            listenerCounts,
            totalListeners,
            bufferedEvents: this.eventBuffer.length
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