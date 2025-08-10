// Workflow Node Interfaces
// Based on existing implementations in agents package

import type { WorkflowNodeType } from '../constants/workflow-types.js';

/**
 * Base workflow node status types
 */
export type WorkflowNodeStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * Connection types between workflow nodes
 * Based on existing WorkflowConnectionType from workflow-event-subscriber
 */
export type WorkflowConnectionType =
    | 'has_tools'         // Agent → Tools Container
    | 'contains'          // Tools Container → Tool Definition
    | 'receives'          // User Input → Agent
    | 'processes'         // Agent → Agent Thinking
    | 'continues'         // Agent Thinking → Agent Thinking (thinking 연속)
    | 'executes'          // Agent Thinking → Tool Call
    | 'creates'           // Tool Call → Agent (Agent 생성)
    | 'triggers'          // Tool Call Response → User Message (메시지 트리거)
    | 'branch'            // 병렬 분기 (Thinking → multiple Tool Calls)
    | 'result'            // Tool Call → Merge
    | 'analyze'           // 연쇄 분석 (Merge → next Thinking)
    | 'return'            // Response → Integration Instance (결과 반환)
    | 'final'             // 최종 결과 (Response → Output)
    | 'deliver'           // 출력 전달
    | 'integrates'        // Response → Agent Integration Instance (결과 통합)
    | 'finalizes';        // Final Thinking → Output (최종 완료)

/**
 * Workflow node connection information
 */
export interface WorkflowConnection {
    fromId: string;
    toId: string;
    type: WorkflowConnectionType;
    label?: string;
}

/**
 * Core workflow node data structure
 * Based on existing WorkflowNodeData interface
 */
export interface WorkflowNodeData {
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
    
    // Tool-specific data
    toolName?: string;
    agentTemplate?: string;
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    
    // Agent-specific data
    agentNumber?: number;
    copyNumber?: number;
    
    // Execution metadata
    metadata?: Record<string, unknown>;
    
    // Extensible data for domain-specific fields
    [key: string]: unknown;
}

/**
 * Core workflow node interface
 * Compatible with existing WorkflowNode from workflow-event-subscriber
 */
export interface WorkflowNode {
    id: string;
    type: WorkflowNodeType;
    parentId?: string;
    level: number;
    status: WorkflowNodeStatus;
    data: WorkflowNodeData;
    timestamp: number; // Creation timestamp for sequential order validation
    connections: WorkflowConnection[];
}

/**
 * Workflow node update event
 */
export interface WorkflowNodeUpdate {
    action: 'create' | 'update' | 'complete' | 'error';
    node: WorkflowNode;
    relatedNodes?: WorkflowNode[]; // 연관된 노드들 (연결 관계)
}

/**
 * Node creation options
 */
export interface NodeCreationOptions {
    parentNodeId?: string;
    connectionType?: WorkflowConnectionType;
    connectionLabel?: string;
    autoTimestamp?: boolean;
}

/**
 * Type guard for WorkflowNode
 */
export function isWorkflowNode(obj: unknown): obj is WorkflowNode {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof (obj as WorkflowNode).id === 'string' &&
        typeof (obj as WorkflowNode).type === 'string' &&
        typeof (obj as WorkflowNode).level === 'number' &&
        typeof (obj as WorkflowNode).status === 'string' &&
        typeof (obj as WorkflowNode).timestamp === 'number'
    );
}
