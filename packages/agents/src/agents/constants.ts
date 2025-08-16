/**
 * Agent event constants
 * 
 * Events emitted by Agent instances themselves.
 * Only events with 'agent.*' prefix should be emitted by Agent components.
 */
export const AGENT_EVENTS = {
    /** Agent instance has been created and initialized */
    CREATED: 'agent.created',
    /** Agent execution lifecycle - start */
    EXECUTION_START: 'agent.execution_start',
    /** Agent execution lifecycle - complete */
    EXECUTION_COMPLETE: 'agent.execution_complete',
    /** Agent execution lifecycle - error */
    EXECUTION_ERROR: 'agent.execution_error',
    /** Agent aggregation process completed */
    AGGREGATION_COMPLETE: 'agent.aggregation_complete',
    /** Agent configuration (e.g., tools) has been updated by the agent */
    CONFIG_UPDATED: 'agent.config_updated'
} as const;

export type AgentEventType = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
