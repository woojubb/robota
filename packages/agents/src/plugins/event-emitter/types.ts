
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
    CONVERSATION_ERROR: 'conversation.error',
    AGENT_EXECUTION_START: 'agent.execution_start',
    AGENT_EXECUTION_COMPLETE: 'agent.execution_complete',
    AGENT_EXECUTION_ERROR: 'agent.execution_error',
    AGENT_CREATED: 'agent.created',
    AGENT_DESTROYED: 'agent.destroyed',
    PLUGIN_LOADED: 'plugin.loaded',
    PLUGIN_UNLOADED: 'plugin.unloaded',
    PLUGIN_ERROR: 'plugin.error',
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
    MODULE_REGISTERED: 'module.registered',
    MODULE_UNREGISTERED: 'module.unregistered',
    EXECUTION_HIERARCHY: 'execution.hierarchy',
    EXECUTION_REALTIME: 'execution.realtime',
    TOOL_REALTIME: 'tool.realtime',
    CUSTOM: 'custom'
} as const;

export type TEventName = typeof EVENT_EMITTER_EVENTS[keyof typeof EVENT_EMITTER_EVENTS];

/**
 * Valid event data value types
 */
export type TEventDataValue = string | number | boolean | Date | null | undefined | TEventDataValue[] | { [key: string]: TEventDataValue };

/**
 * Event data structure
 */
export interface IEventEmitterEventData {
    type: TEventName;
    timestamp: Date;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    data?: Record<string, TEventDataValue>;
    error?: Error;
    metadata?: Record<string, TEventDataValue>;
}

/**
 * Event listener function
 */
export type TEventEmitterListener = (event: IEventEmitterEventData) => void | Promise<void>;

/**
 * Console-like interface for the EventEmitterPlugin.
 *
 * Use this interface for typing instead of the concrete EventEmitterPlugin class.
 */
export interface IEventEmitterPlugin {
    on(
        eventType: TEventName,
        listener: TEventEmitterListener,
        options?: {
            once?: boolean;
            filter?: (event: IEventEmitterEventData) => boolean;
        }
    ): string;
    once(
        eventType: TEventName,
        listener: TEventEmitterListener,
        filter?: (event: IEventEmitterEventData) => boolean
    ): string;
    off(eventType: TEventName, handlerIdOrListener: string | TEventEmitterListener): boolean;
    emit(eventType: TEventName, eventData?: Partial<IEventEmitterEventData>): Promise<void>;
}

/**
 * Event handler with metadata
 */
export interface IEventEmitterHandler {
    id: string;
    listener: TEventEmitterListener;
    once: boolean;
    filter?: (event: IEventEmitterEventData) => boolean;
}