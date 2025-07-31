/**
 * Workflow Converter Local Types
 * 
 * Local type definitions for workflow conversion services.
 * These types are used within this workflow converter service and don't need to be shared globally.
 */

/**
 * Domain-specific mapping types for workflow conversion
 */
export type NodeTypeMapping = Record<string, string>;
export type EdgeTypeMapping = Record<string, string>;
export type WorkflowStatusMapping = Record<string, 'pending' | 'running' | 'completed' | 'error' | 'skipped'>;
export type EdgeStyleMapping = Record<string, 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier'>;
export type NodeIconMapping = Record<string, string>;
export type NodeColorMapping = Record<string, string>;
export type EdgeColorMapping = Record<string, string>;

/**
 * Workflow node data structure - local to workflow converter
 */
export interface WorkflowNodeData {
    label: string;
    description?: string;
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

/**
 * Workflow connection structure - local to workflow converter
 */
export interface WorkflowConnection {
    id: string;
    fromId: string;
    toId: string;
    type: string;
    metadata?: Record<string, unknown>;
}

/**
 * Workflow node structure - local to workflow converter
 */
export interface WorkflowNode {
    id: string;
    type: string;
    parentId?: string;
    level: number;
    data: WorkflowNodeData;
    metadata?: Record<string, unknown>;
}