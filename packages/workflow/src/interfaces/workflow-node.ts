// Workflow Node Interfaces
// Based on existing implementations in agents package

import type { TWorkflowNodeType } from '../constants/workflow-types.js';
import type { IToolResult, IOwnerPathSegment, TContextData, TLoggerData, TUniversalValue } from '@robota-sdk/agents';

export type TWorkflowNodeDataExtensionValue = TUniversalValue | Date | Error | TLoggerData | IToolResult | TContextData;

export interface IWorkflowOriginalEvent {
    eventType: string;
    timestamp: Date;
    sourceType?: string;
    sourceId?: string;
    path?: string[];
    parameters?: TContextData;
    result?: IToolResult | TContextData;
    metadata?: TLoggerData;
    error?: Error | string;
    context?: {
        ownerPath: IOwnerPathSegment[];
    };
}

export interface IWorkflowNodeExtensions {
    robota?: {
        originalEvent?: IWorkflowOriginalEvent;
        handlerType: 'tool' | 'agent' | 'execution';
        extra?: Record<string, TWorkflowNodeDataExtensionValue>;
    };
    /**
     * Other platform extensions must be explicit and constrained (no unknown).
     */
    other?: Record<string, Record<string, TWorkflowNodeDataExtensionValue | undefined>>;
}

/**
 * Base workflow node status types
 */
export type TWorkflowNodeStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * Connection types between workflow nodes
 * Based on existing WorkflowConnectionType from workflow-event-subscriber
 */
export type TWorkflowConnectionType =
    | 'has_tools'         // Agent → Tools Container
    | 'contains'          // Tools Container → Tool Definition
    | 'receives'          // User Input → Agent
    | 'processes'         // Agent → Agent Thinking
    | 'continues'         // Agent Thinking → Agent Thinking (continuous thinking)
    | 'executes'          // Agent Thinking → Tool Call
    | 'creates'           // Tool Call → Agent (agent created)
    | 'triggers'          // Tool Call Response → User Message (message triggers)
    | 'branch'            // Parallel branching (Thinking → multiple Tool Calls)
    | 'result'            // Tool Call → Merge
    | 'analyze'           // Chained analysis (Merge → next Thinking)
    | 'return'            // Response → Integration Instance (returns result)
    | 'final'             // Final result (Response → Output)
    | 'deliver'           // Output delivery
    | 'integrates'        // Response → Agent Integration Instance (integrates result)
    | 'finalizes';        // Final Thinking → Output (finalize)

/**
 * Workflow node connection information
 */
export interface IWorkflowConnection {
    fromId: string;
    toId: string;
    type: TWorkflowConnectionType;
    label?: string;
}

/**
 * Core workflow node data structure
 * Based on existing WorkflowNodeData interface
 */
export interface IWorkflowNodeData {
    // Core identification
    eventType?: string;
    sourceId?: string;
    sourceType?: string;
    executionId?: string;
    parentExecutionId?: string;
    
    // Time information
    originalEventTimestamp?: Date; // Original event occurrence time from EventService
    
    // Display information
    label?: string;
    description?: string;
    response?: string;
    status?: TWorkflowNodeStatus;
    
    // Tool-specific data
    toolName?: string;
    agentTemplate?: string;
    parameters?: TContextData;
    result?: IToolResult | TContextData;

    // Optional tool list for agent nodes
    tools?: string[];

    // Optional reserved thinking node id used by some handlers
    reservedThinkingId?: string;

    // Optional cross-node references used by workflow construction
    parentThinkingNodeId?: string;

    // Tool response UI data
    toolCall?: TContextData;
    toolResponse?: {
        toolName: string;
        content: string;
        success: boolean;
        timestamp: string;
    };
    responseMetrics?: {
        responseLength: number;
        contentType: string;
        hasError: boolean;
    };
    aggregationInfo?: {
        parentThinking: string;
        status: string;
    };
    error?: Error | string | TContextData;

    // Execution/assistant/user message info blocks used by execution handler
    executionInfo?: TContextData;
    messageInfo?: TContextData;
    messageMetrics?: TContextData;
    inputInfo?: TContextData;
    
    // Agent-specific data
    agentNumber?: number;
    copyNumber?: number;
    
    // Execution metadata
    metadata?: TLoggerData;

    statusHistory?: Array<{
        status: TWorkflowNodeStatus;
        eventType: string;
        timestamp: number;
    }>;

    // Platform extensions (typed, no unknown)
    extensions?: IWorkflowNodeExtensions;

    // Forward-compatible extra fields (typed, no unknown)
    extra?: Record<string, TWorkflowNodeDataExtensionValue>;
}

/**
 * Core workflow node interface
 * Compatible with existing WorkflowNode from workflow-event-subscriber
 */
export interface IWorkflowNode {
    id: string;
    type: TWorkflowNodeType;
    parentId?: string;
    level: number;
    status: TWorkflowNodeStatus;
    data: IWorkflowNodeData;
    timestamp: number; // Creation timestamp for sequential order validation
    connections: IWorkflowConnection[];
}

/**
 * Workflow node update event
 */
export interface IWorkflowNodeUpdate {
    action: 'create' | 'update' | 'complete' | 'error';
    node: IWorkflowNode;
    relatedNodes?: IWorkflowNode[]; // Related nodes (connection relationships)
}

/**
 * Node creation options
 */
export interface INodeCreationOptions {
    parentNodeId?: string;
    connectionType?: TWorkflowConnectionType;
    connectionLabel?: string;
    autoTimestamp?: boolean;
}

/**
 * Type guard for WorkflowNode
 */
export function isWorkflowNode(obj: object): obj is IWorkflowNode {
    return (
        typeof (obj as IWorkflowNode).id === 'string' &&
        typeof (obj as IWorkflowNode).type === 'string' &&
        typeof (obj as IWorkflowNode).level === 'number' &&
        typeof (obj as IWorkflowNode).status === 'string' &&
        typeof (obj as IWorkflowNode).timestamp === 'number'
    );
}
