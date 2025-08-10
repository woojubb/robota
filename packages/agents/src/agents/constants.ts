/**
 * Agent event constants
 * 
 * Events emitted by Agent instances themselves.
 * Only events with 'agent.*' prefix should be emitted by Agent components.
 */
export const AGENT_EVENTS = {
    /** Agent instance has been created and initialized */
    CREATED: 'agent.created',
    /** Agent aggregation process completed */
    AGGREGATION_COMPLETE: 'agent.aggregation_complete'
} as const;

export type AgentEventType = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
