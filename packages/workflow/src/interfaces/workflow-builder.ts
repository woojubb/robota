// Workflow Builder Interfaces
// Domain-neutral workflow building and management

import type { WorkflowNode, WorkflowNodeUpdate } from './workflow-node.js';
import type { WorkflowEdge, WorkflowEdgeUpdate } from './workflow-edge.js';

/**
 * Workflow snapshot data structure
 */
export interface WorkflowSnapshot {
    id: string;
    timestamp: Date;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    metadata: {
        nodeCount: number;
        edgeCount: number;
        createdAt: Date;
        version: string;
        [key: string]: unknown;
    };
}

/**
 * Workflow update types
 */
export type WorkflowUpdate = WorkflowNodeUpdate | WorkflowEdgeUpdate;

/**
 * Workflow builder configuration
 */
export interface WorkflowBuilderConfig {
    autoTimestamp?: boolean;
    validateConnections?: boolean;
    maxNodes?: number;
    maxEdges?: number;
    logger?: {
        debug: (message: string, ...args: unknown[]) => void;
        info: (message: string, ...args: unknown[]) => void;
        warn: (message: string, ...args: unknown[]) => void;
        error: (message: string, ...args: unknown[]) => void;
        log: (message: string, ...args: unknown[]) => void;
    };
}

/**
 * Workflow subscription callback
 */
export type WorkflowUpdateCallback = (update: WorkflowUpdate) => void;

/**
 * Core workflow builder interface
 */
export interface WorkflowBuilder {
    /**
     * Get current workflow snapshot
     */
    getSnapshot(): WorkflowSnapshot;

    /**
     * Get all nodes
     */
    getAllNodes(): WorkflowNode[];

    /**
     * Get all edges
     */
    getAllEdges(): WorkflowEdge[];

    /**
     * Get node by ID
     */
    getNode(nodeId: string): WorkflowNode | undefined;

    /**
     * Get edge by ID
     */
    getEdge(edgeId: string): WorkflowEdge | undefined;

    /**
     * Check if node exists
     */
    hasNode(nodeId: string): boolean;

    /**
     * Check if edge exists
     */
    hasEdge(edgeId: string): boolean;

    /**
     * Subscribe to workflow updates
     */
    subscribe(callback: WorkflowUpdateCallback): () => void;

    /**
     * Unsubscribe from workflow updates
     */
    unsubscribe(callback: WorkflowUpdateCallback): void;

    /**
     * Clear all data
     */
    clear(): void;

    /**
     * Get workflow statistics
     */
    getStats(): {
        nodeCount: number;
        edgeCount: number;
        totalUpdates: number;
        lastUpdateTime?: Date;
    };
}

/**
 * Extended workflow builder with management capabilities
 */
export interface ExtendedWorkflowBuilder extends WorkflowBuilder {
    /**
     * Add node to workflow
     */
    addNode(node: Omit<WorkflowNode, 'timestamp'>, parentNodeId?: string): WorkflowNode;

    /**
     * Update existing node
     */
    updateNode(nodeId: string, updates: Partial<WorkflowNode>): WorkflowNode | null;

    /**
     * Remove node from workflow
     */
    removeNode(nodeId: string): boolean;

    /**
     * Add edge to workflow
     */
    addEdge(edge: Omit<WorkflowEdge, 'timestamp'>): WorkflowEdge;

    /**
     * Update existing edge
     */
    updateEdge(edgeId: string, updates: Partial<WorkflowEdge>): WorkflowEdge | null;

    /**
     * Remove edge from workflow
     */
    removeEdge(edgeId: string): boolean;

    /**
     * Batch operations for performance
     */
    batch(operations: Array<{
        type: 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'updateEdge' | 'removeEdge';
        data: unknown;
    }>): void;

    /**
     * Validate current workflow state
     */
    validate(): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    };

    /**
     * Raw accessors (append-only order) for source-of-truth export without any transformation
     */
    getRawNodes(): WorkflowNode[];
    getRawEdges(): WorkflowEdge[];
}

/**
 * Workflow query interface for advanced querying
 */
export interface WorkflowQuery {
    /**
     * Find nodes by criteria
     */
    findNodes(criteria: {
        type?: string | string[];
        status?: string | string[];
        level?: number | number[];
        parentId?: string;
        hasChildren?: boolean;
        [key: string]: unknown;
    }): WorkflowNode[];

    /**
     * Find edges by criteria
     */
    findEdges(criteria: {
        type?: string | string[];
        sourceId?: string;
        targetId?: string;
        hidden?: boolean;
        [key: string]: unknown;
    }): WorkflowEdge[];

    /**
     * Get connected nodes
     */
    getConnectedNodes(nodeId: string, direction?: 'incoming' | 'outgoing' | 'both'): WorkflowNode[];

    /**
     * Get node path from root
     */
    getNodePath(nodeId: string): WorkflowNode[];

    /**
     * Get workflow depth
     */
    getDepth(): number;

    /**
     * Find disconnected components
     */
    getDisconnectedComponents(): WorkflowNode[][];
}

/**
 * Workflow export/import interface
 */
export interface WorkflowPortable {
    /**
     * Export workflow to JSON
     */
    exportToJSON(): string;

    /**
     * Import workflow from JSON
     */
    importFromJSON(json: string): boolean;

    /**
     * Export to universal format (flat model for compatibility)
     */
    exportToUniversal(): {
        nodes: WorkflowNode[];
        edges: WorkflowEdge[];
        metadata: {
            version: string;
            format: 'universal-workflow';
            nodeCount: number;
            edgeCount: number;
            createdAt: Date;
            [key: string]: unknown;
        };
    };

    /**
     * Import from universal format
     */
    importFromUniversal(data: { version: string; format: string; data: WorkflowSnapshot }): boolean;
}
