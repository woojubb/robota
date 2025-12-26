import type { IPluginOptions, IPluginStats } from '../../abstracts/abstract-plugin';

/**
 * Event types that can be emitted.
 *
 * IMPORTANT:
 * - Do not use string literals for event names outside this module.
 * - Import and use EVENT_EMITTER_EVENTS instead.
 */
export const EVENT_EMITTER_EVENTS = {
    EXECUTION_START: 'execution.start',
    EXECUTION_COMPLETE: 'execution.complete',
    EXECUTION_ERROR: 'execution.error',
    TOOL_BEFORE_EXECUTE: 'tool.beforeExecute',
    TOOL_AFTER_EXECUTE: 'tool.afterExecute',
    TOOL_SUCCESS: 'tool.success',
    TOOL_ERROR: 'tool.error',
    CONVERSATION_START: 'conversation.start',
    CONVERSATION_COMPLETE: 'conversation.complete',
    AGENT_CREATED: 'agent.created',
    AGENT_DESTROYED: 'agent.destroyed',
    PLUGIN_LOADED: 'plugin.loaded',
    PLUGIN_UNLOADED: 'plugin.unloaded',
    ERROR_OCCURRED: 'error.occurred',
    WARNING_OCCURRED: 'warning.occurred',
    MODULE_INITIALIZE_START: 'module.initialize.start',
    MODULE_INITIALIZE_COMPLETE: 'module.initialize.complete',
    MODULE_INITIALIZE_ERROR: 'module.initialize.error',
    MODULE_EXECUTION_START: 'module.execution.start',
    MODULE_EXECUTION_COMPLETE: 'module.execution.complete',
    MODULE_EXECUTION_ERROR: 'module.execution.error',
    MODULE_DISPOSE_START: 'module.dispose.start',
    MODULE_DISPOSE_COMPLETE: 'module.dispose.complete',
    MODULE_DISPOSE_ERROR: 'module.dispose.error',
    EXECUTION_HIERARCHY: 'execution.hierarchy',
    EXECUTION_REALTIME: 'execution.realtime',
    TOOL_REALTIME: 'tool.realtime'
} as const;

export type TEventType = typeof EVENT_EMITTER_EVENTS[keyof typeof EVENT_EMITTER_EVENTS];

/**
 * Valid event data value types
 */
export type TEventDataValue = string | number | boolean | Date | null | undefined | TEventDataValue[] | { [key: string]: TEventDataValue };

/**
 * Event data structure
 */
export interface IEventData {
    type: TEventType;
    timestamp: Date;
    source: string;
    data?: Record<string, TEventDataValue>;
    metadata?: {
        executionId?: string;
        conversationId?: string;
        agentId?: string;
        toolName?: string;
        [key: string]: TEventDataValue;
    };
}

/**
 * Event listener function
 */
export type TEventListener = (event: IEventData) => void | Promise<void>;

/**
 * Event handler with metadata
 */
export interface IEventHandler {
    id: string;
    listener: TEventListener;
    once: boolean;
    filter?: (event: IEventData) => boolean;
}

/**
 * Event emitter configuration
 */
export interface IEventEmitterPluginOptions extends IPluginOptions {
    /** Events to listen for */
    events?: TEventType[];
    /** Maximum number of listeners per event type */
    maxListeners?: number;
    /** Whether to emit events asynchronously */
    async?: boolean;
    /** Whether to catch and log listener errors */
    catchErrors?: boolean;
    /** Custom event filters */
    filters?: Record<TEventType, (event: IEventData) => boolean>;
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
export interface IEventEmitterPluginStats extends IPluginStats {
    totalEventsEmitted: number;
    totalListeners: number;
    activeListeners: number;
    bufferedEvents: number;
    errorCount: number;
    averageEventProcessingTime: number;
    eventCounts: Record<TEventType, number>;
} 