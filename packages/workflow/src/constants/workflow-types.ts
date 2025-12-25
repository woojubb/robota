// Workflow Type Constants
// Based on existing WORKFLOW_NODE_TYPES from agents package

/**
 * Workflow Node Type Constants
 *
 * Purpose:
 * - Provide a domain-neutral and consistent node type system.
 * - Prevent external/custom node type creation.
 * - Centralize node type ownership in a single module.
 *
 * Principles:
 * 1. Domain neutrality: avoid domain-specific labels.
 * 2. Extensibility: support continuous interactions (no "final" semantics).
 * 3. Simplicity: avoid hierarchical naming patterns.
 * 4. Predictability: the type name should communicate intent.
 */

/**
 * Entry/Exit Points
 */
export const WORKFLOW_NODE_TYPES = {
    // Entry point: where a user starts a workflow
    USER_INPUT: 'user_input',

    // User message delivered to an agent (tool_call_response → user_message → agent)
    USER_MESSAGE: 'user_message',

    // Output node: where results are presented to a user (not necessarily terminal)
    OUTPUT: 'output',

    /**
     * Agent Core
     * All agents use the same node type ('agent').
     * Distinguish instances via node data (e.g., agentNumber/label).
     */
    AGENT: 'agent',

    // Container for tools available to an agent
    TOOLS_CONTAINER: 'tools_container',

    // Individual tool definition
    TOOL_DEFINITION: 'tool_definition',

    /**
     * Execution Flow
     */
    // Agent thinking / reasoning step
    AGENT_THINKING: 'agent_thinking',

    // Tool invocation / execution
    TOOL_CALL: 'tool_call',

    // Tool call response (tool_call → tool_call_response)
    TOOL_CALL_RESPONSE: 'tool_call_response',

    /**
     * Responses
     * No "final" concept: responses can be continuous.
     */
    // Agent response (thinking → response)
    RESPONSE: 'response',

    // Join point for multiple tool/agent results (parallel aggregation)
    TOOL_RESULT: 'tool_result', // Previously MERGE_RESULTS

    // Error node
    ERROR: 'error',

    /**
     * Team & Collaboration
     */
    // Team analysis (team.analysis_start/complete)
    TEAM_ANALYSIS: 'team_analysis',

    // Task assignment (team.task_assigned)
    TASK: 'task',

    // Agent creation process (team.agent_creation_*)
    AGENT_CREATION: 'agent_creation',

    // Aggregation (team.aggregation_complete)
    AGGREGATION: 'aggregation',

    /**
     * Tool Operations
     */
    // Tool response (tool.call_response_ready)
    TOOL_RESPONSE: 'tool_response',

    /**
     * Execution & Messages
     */
    // Execution node (execution.start/complete)
    EXECUTION: 'execution',

    // Assistant message (execution.assistant_message_*)
    ASSISTANT_MESSAGE: 'assistant_message',
} as const;

/**
 * TWorkflowNodeType
 *
 * Union type derived from WORKFLOW_NODE_TYPES.
 * Prevents using arbitrary node type strings outside the catalog.
 */
export type TWorkflowNodeType = typeof WORKFLOW_NODE_TYPES[keyof typeof WORKFLOW_NODE_TYPES];

/**
 * Validates a node type string against WORKFLOW_NODE_TYPES.
 *
 * @param nodeType - node type to validate
 * @returns true if nodeType is a valid workflow node type
 */
export function isValidWorkflowNodeType(nodeType: string): nodeType is TWorkflowNodeType {
    return Object.values(WORKFLOW_NODE_TYPES).includes(nodeType as TWorkflowNodeType);
}

/**
 * Node type descriptions (debugging/logging)
 */
export const WORKFLOW_NODE_TYPE_DESCRIPTIONS = {
    [WORKFLOW_NODE_TYPES.USER_INPUT]: 'User input (workflow entry)',
    [WORKFLOW_NODE_TYPES.USER_MESSAGE]: 'User message (delivered to agent)',
    [WORKFLOW_NODE_TYPES.OUTPUT]: 'Output (presented to user)',
    [WORKFLOW_NODE_TYPES.AGENT]: 'Agent (instance distinguished by node data)',
    [WORKFLOW_NODE_TYPES.TOOLS_CONTAINER]: 'Tools container',
    [WORKFLOW_NODE_TYPES.TOOL_DEFINITION]: 'Tool definition',
    [WORKFLOW_NODE_TYPES.AGENT_THINKING]: 'Agent thinking',
    [WORKFLOW_NODE_TYPES.TOOL_CALL]: 'Tool call',
    [WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE]: 'Tool call response',
    [WORKFLOW_NODE_TYPES.RESPONSE]: 'Agent response (continuous)',
    [WORKFLOW_NODE_TYPES.TOOL_RESULT]: 'Tool result (join point)',
    [WORKFLOW_NODE_TYPES.ERROR]: 'Error',

    // Team & Collaboration
    [WORKFLOW_NODE_TYPES.TEAM_ANALYSIS]: 'Team analysis',
    [WORKFLOW_NODE_TYPES.TASK]: 'Task assignment',
    [WORKFLOW_NODE_TYPES.AGENT_CREATION]: 'Agent creation',
    [WORKFLOW_NODE_TYPES.AGGREGATION]: 'Aggregation',

    // Tool Operations
    [WORKFLOW_NODE_TYPES.TOOL_RESPONSE]: 'Tool response',

    // Execution & Messages
    [WORKFLOW_NODE_TYPES.EXECUTION]: 'Execution',
    [WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE]: 'Assistant message'
} as const;

// Note: WORKFLOW_DEFAULTS and WORKFLOW_CONSTRAINTS have been moved to ./defaults.ts
// to avoid duplication and improve organization
