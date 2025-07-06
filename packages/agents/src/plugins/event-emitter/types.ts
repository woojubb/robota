import type { BasePluginOptions } from '../../abstracts/base-plugin';

/**
 * Event types that can be emitted
 */
export type EventType =
    | 'execution.start'
    | 'execution.complete'
    | 'execution.error'
    | 'tool.beforeExecute'
    | 'tool.afterExecute'
    | 'tool.success'
    | 'tool.error'
    | 'conversation.start'
    | 'conversation.complete'
    | 'agent.created'
    | 'agent.destroyed'
    | 'plugin.loaded'
    | 'plugin.unloaded'
    | 'error.occurred'
    | 'warning.occurred'
    | 'module.initialize.start'
    | 'module.initialize.complete'
    | 'module.initialize.error'
    | 'module.execution.start'
    | 'module.execution.complete'
    | 'module.execution.error'
    | 'module.dispose.start'
    | 'module.dispose.complete'
    | 'module.dispose.error';

/**
 * Valid event data value types
 */
export type EventDataValue = string | number | boolean | Date | null | undefined | EventDataValue[] | { [key: string]: EventDataValue };

/**
 * Event data structure
 */
export interface EventData {
    type: EventType;
    timestamp: Date;
    source: string;
    data?: Record<string, EventDataValue>;
    metadata?: {
        executionId?: string;
        conversationId?: string;
        agentId?: string;
        toolName?: string;
        [key: string]: EventDataValue;
    };
}

/**
 * Event listener function
 */
export type EventListener = (event: EventData) => void | Promise<void>;

/**
 * Event handler with metadata
 */
export interface EventHandler {
    id: string;
    listener: EventListener;
    once: boolean;
    filter?: (event: EventData) => boolean;
}

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
    totalEventsEmitted: number;
    totalListeners: number;
    activeListeners: number;
    bufferedEvents: number;
    errorCount: number;
    averageEventProcessingTime: number;
    eventCounts: Record<EventType, number>;
} 