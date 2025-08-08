/**
 * Team container event constants
 * 
 * These events are emitted by team functionality and can be consumed by
 * any event handler, including WorkflowEventSubscriber.
 */

// Tool execution events
export const TOOL_EVENTS = {
    /** Tool call starts agent creation process */
    AGENT_CREATION_REQUESTED: 'tool.agent_creation_requested',
    /** Tool completed agent creation */
    AGENT_CREATION_COMPLETED: 'tool.agent_creation_completed',
    /** Tool started agent execution */
    AGENT_EXECUTION_STARTED: 'tool.agent_execution_started',
    /** Tool completed agent execution */
    AGENT_EXECUTION_COMPLETED: 'tool.agent_execution_completed'
} as const;

// Team analysis events
export const TEAM_EVENTS = {
    /** Team analysis started */
    ANALYSIS_START: 'team.analysis_start',
    /** Team analysis completed */
    ANALYSIS_COMPLETE: 'team.analysis_complete'
} as const;

// Task management events
export const TASK_EVENTS = {
    /** Task assigned to agent */
    ASSIGNED: 'task.assigned',
    /** Task completed by agent */
    COMPLETED: 'task.completed'
} as const;

// Agent lifecycle events
export const AGENT_EVENTS = {
    /** Agent creation process started */
    CREATION_START: 'agent.creation_start',
    /** Agent creation process completed */
    CREATION_COMPLETE: 'agent.creation_complete',
    /** Agent execution started */
    EXECUTION_START: 'agent.execution_start',
    /** Agent execution completed */
    EXECUTION_COMPLETE: 'agent.execution_complete'
} as const;

export type TeamEventType =
    | typeof TOOL_EVENTS[keyof typeof TOOL_EVENTS]
    | typeof TEAM_EVENTS[keyof typeof TEAM_EVENTS]
    | typeof TASK_EVENTS[keyof typeof TASK_EVENTS]
    | typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];
