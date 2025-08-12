/**
 * Team container event constants
 * 
 * These events are emitted by team functionality and can be consumed by
 * any event handler, including WorkflowEventSubscriber.
 * 
 * IMPORTANT: All events emitted within team package MUST use 'team.*' prefix
 * to maintain clear event ownership and prevent architectural violations.
 */

// Team events - All events emitted by TeamContainer
export const TEAM_EVENTS = {
    /** Team analysis started */
    ANALYSIS_START: 'team.analysis_start',
    /** Team analysis completed */
    ANALYSIS_COMPLETE: 'team.analysis_complete',

    // Task management (emitted by team)
    /** Team assigns task to agent */
    TASK_ASSIGNED: 'team.task_assigned',
    /** Team completes task */
    TASK_COMPLETED: 'team.task_completed',

    // Agent lifecycle management by team
    /** Team starts agent creation */
    AGENT_CREATION_START: 'team.agent_creation_start',
    /** Team completes agent creation */
    AGENT_CREATION_COMPLETE: 'team.agent_creation_complete',
    /** Team starts agent execution */
    AGENT_EXECUTION_START: 'team.agent_execution_start',
    /** Team reports agent execution started (from tool context) */
    AGENT_EXECUTION_STARTED: 'team.agent_execution_started',
    /** Team completes agent execution */
    AGENT_EXECUTION_COMPLETE: 'team.agent_execution_complete',

    // Tool response handling by team
    /** Team's tool response is ready */
    TOOL_RESPONSE_READY: 'team.tool_response_ready',

    // Aggregation by team
    /** Team completes result aggregation */
    AGGREGATION_COMPLETE: 'team.aggregation_complete'
} as const;

// Legacy constants - TO BE REMOVED after migration
// These were incorrectly named and violate event ownership rules
export const TOOL_EVENTS = {
    /** @deprecated Use TEAM_EVENTS.AGENT_CREATION_START */
    AGENT_CREATION_REQUESTED: 'tool.agent_creation_requested',
    /** @deprecated Use TEAM_EVENTS.AGENT_CREATION_COMPLETE */
    AGENT_CREATION_COMPLETED: 'tool.agent_creation_completed',
    /** @deprecated Use TEAM_EVENTS.AGENT_EXECUTION_STARTED */
    AGENT_EXECUTION_STARTED: 'tool.agent_execution_started',
    /** @deprecated Use TEAM_EVENTS.AGENT_EXECUTION_COMPLETE */
    AGENT_EXECUTION_COMPLETED: 'tool.agent_execution_completed'
} as const;

export const TASK_EVENTS = {
    /** @deprecated Use TEAM_EVENTS.TASK_ASSIGNED */
    ASSIGNED: 'task.assigned',
    /** @deprecated Use TEAM_EVENTS.TASK_COMPLETED */
    COMPLETED: 'task.completed'
} as const;

export const AGENT_EVENTS = {
    /** @deprecated These should not be emitted by team - violates ownership */
    CREATION_START: 'agent.creation_start',
    /** @deprecated These should not be emitted by team - violates ownership */
    CREATION_COMPLETE: 'agent.creation_complete',
    /** @deprecated Use agents package constant */
    CREATED: 'agent.created',
    /** @deprecated These should not be emitted by team - violates ownership */
    EXECUTION_START: 'agent.execution_start',
    /** @deprecated These should not be emitted by team - violates ownership */
    EXECUTION_COMPLETE: 'agent.execution_complete'
} as const;

export type TeamEventType =
    | typeof TOOL_EVENTS[keyof typeof TOOL_EVENTS]
    | typeof TEAM_EVENTS[keyof typeof TEAM_EVENTS]
    | typeof TASK_EVENTS[keyof typeof TASK_EVENTS]
    | typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
