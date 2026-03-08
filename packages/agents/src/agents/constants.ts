/**
 * Agent event constants
 * 
 * Events emitted by Agent instances themselves.
 * Event names are local (no dots) and must be used via constants (no string literals).
 */
export const AGENT_EVENTS = {
    /** Agent instance has been created and initialized */
    CREATED: 'created',
    /** Agent execution lifecycle - start */
    EXECUTION_START: 'execution_start',
    /** Agent execution lifecycle - complete */
    EXECUTION_COMPLETE: 'execution_complete',
    /** Agent execution lifecycle - error */
    EXECUTION_ERROR: 'execution_error',
    /** Agent aggregation process completed */
    AGGREGATION_COMPLETE: 'aggregation_complete',
    /** Agent configuration (e.g., tools) has been updated by the agent */
    CONFIG_UPDATED: 'config_updated'
} as const;

export const AGENT_EVENT_PREFIX = 'agent' as const;

export type TAgentEvent = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
