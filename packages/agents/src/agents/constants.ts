/**
 * Agent event constants
 * 
 * Events emitted by Agent instances themselves.
 * The 'agent.' prefix is automatically prepended by ActionTrackingEventService
 * when ownerPrefix is set to 'agent'.
 * 
 * 🎯 [PREFIX-INJECTION] These constants define only the event name without prefix.
 * The EventService with ownerPrefix='agent' will automatically convert:
 *   'created' → 'agent.created'
 *   'execution_start' → 'agent.execution_start'
 *   etc.
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

export type AgentEventType = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
