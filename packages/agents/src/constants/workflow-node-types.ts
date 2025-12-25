/**
 * Workflow Node Type Constants
 *
 * Purpose:
 * - Provide a domain-neutral and consistent workflow node type system.
 * - Prevent arbitrary external node type creation.
 * - Centralize workflow node types in one module.
 *
 * Principles:
 * - Domain neutrality: avoid domain-specific labels.
 * - Extensibility: do not assume "final" responses; conversations can continue.
 * - Simplicity: avoid hierarchy/roles like sub-* or main-*.
 * - Predictability: the type name should imply intent.
 */

/**
 * Entry/Exit Points - workflow start and end.
 */
export const WORKFLOW_NODE_TYPES = {
    // Entry point: user initiates a workflow.
    USER_INPUT: 'user_input',

    // User message delivered to an agent (tool_call_response → user_message → agent).
    USER_MESSAGE: 'user_message',

    // Output delivered to the user (not necessarily the final message).
    OUTPUT: 'output',

    /**
     * Agent core:
     * - All agents share the same 'agent' node type.
     * - Agent number/label is represented in node data (e.g., data.agentNumber, data.label).
     */
    AGENT: 'agent',

    // Container for tools available to an agent.
    TOOLS_CONTAINER: 'tools_container',

    // Individual tool definition.
    TOOL_DEFINITION: 'tool_definition',

    /**
     * Execution flow
     */
    // Agent thinking / reasoning phase.
    AGENT_THINKING: 'agent_thinking',

    // Tool call execution.
    TOOL_CALL: 'tool_call',

    // Tool call response (tool_call → tool_call_response).
    TOOL_CALL_RESPONSE: 'tool_call_response',

    /**
     * Response types:
     * - No "final" concept; responses may continue.
     */
    // Agent response (thinking → response).
    RESPONSE: 'response',

    // Join point for merging multiple tool/agent results (parallel aggregation).
    TOOL_RESULT: 'tool_result', // Previously MERGE_RESULTS
} as const;

/**
 * Workflow node type union.
 *
 * Prevents using node types outside of WORKFLOW_NODE_TYPES.
 */
export type TWorkflowNodeType = typeof WORKFLOW_NODE_TYPES[keyof typeof WORKFLOW_NODE_TYPES];

/**
 * Validate a node type string.
 */
export function isValidWorkflowNodeType(nodeType: string): nodeType is TWorkflowNodeType {
    return Object.values(WORKFLOW_NODE_TYPES).includes(nodeType as TWorkflowNodeType);
}

/**
 * Node type descriptions (debugging/logging).
 */
export const WORKFLOW_NODE_TYPE_DESCRIPTIONS = {
    [WORKFLOW_NODE_TYPES.USER_INPUT]: 'User input (workflow entry)',
    [WORKFLOW_NODE_TYPES.USER_MESSAGE]: 'User message',
    [WORKFLOW_NODE_TYPES.OUTPUT]: 'Output to user',
    [WORKFLOW_NODE_TYPES.AGENT]: 'Agent',
    [WORKFLOW_NODE_TYPES.TOOLS_CONTAINER]: 'Tools container',
    [WORKFLOW_NODE_TYPES.TOOL_DEFINITION]: 'Tool definition',
    [WORKFLOW_NODE_TYPES.AGENT_THINKING]: 'Agent thinking',
    [WORKFLOW_NODE_TYPES.TOOL_CALL]: 'Tool call',
    [WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE]: 'Tool call response',
    [WORKFLOW_NODE_TYPES.RESPONSE]: 'Agent response',
    [WORKFLOW_NODE_TYPES.TOOL_RESULT]: 'Tool result join'
} as const;