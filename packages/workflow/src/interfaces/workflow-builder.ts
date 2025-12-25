// Workflow Builder Interfaces
// Domain-neutral workflow building and management

import type { IWorkflowNode, IWorkflowNodeUpdate } from './workflow-node.js';
import type { IWorkflowEdge, IWorkflowEdgeUpdate } from './workflow-edge.js';
import type { TLoggerData, TUniversalValue } from '@robota-sdk/agents';

export type TWorkflowBuilderExtensionValue = TUniversalValue | Date | Error | TLoggerData;

/**
 * Workflow snapshot data structure
 */
export interface IWorkflowSnapshot {
    id: string;
    timestamp: Date;
    nodes: IWorkflowNode[];
    edges: IWorkflowEdge[];
    metadata: {
        nodeCount: number;
        edgeCount: number;
        createdAt: Date;
        version: string;
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    };
}

/**
 * Workflow update types
 */
export interface IWorkflowClearUpdate {
    action: 'clear';
}

export type TWorkflowUpdate = IWorkflowNodeUpdate | IWorkflowEdgeUpdate | IWorkflowClearUpdate;

export type TWorkflowBatchOperation =
    | { type: 'addNode'; data: Omit<IWorkflowNode, 'timestamp'> }
    | { type: 'updateNode'; data: { nodeId: string; updates: Partial<IWorkflowNode> } }
    | { type: 'removeNode'; data: { nodeId: string } }
    | { type: 'addEdge'; data: Omit<IWorkflowEdge, 'timestamp'> }
    | { type: 'updateEdge'; data: { edgeId: string; updates: Partial<IWorkflowEdge> } }
    | { type: 'removeEdge'; data: { edgeId: string } };

/**
 * Workflow builder configuration
 */
export interface IWorkflowBuilderConfig {
    autoTimestamp?: boolean;
    validateConnections?: boolean;
    maxNodes?: number;
    maxEdges?: number;
    logger?: {
        debug: (message: string, ...args: TWorkflowBuilderExtensionValue[]) => void;
        info: (message: string, ...args: TWorkflowBuilderExtensionValue[]) => void;
        warn: (message: string, ...args: TWorkflowBuilderExtensionValue[]) => void;
        error: (message: string, ...args: TWorkflowBuilderExtensionValue[]) => void;
        log: (message: string, ...args: TWorkflowBuilderExtensionValue[]) => void;
    };
}

/**
 * Workflow subscription callback
 */
export type TWorkflowUpdateCallback = (update: TWorkflowUpdate) => void;

/**
 * Core workflow builder interface
 */
export interface IWorkflowBuilder {
    /**
     * Get current workflow snapshot
     */
    getSnapshot(): IWorkflowSnapshot;

    /**
     * Get all nodes
     */
    getAllNodes(): IWorkflowNode[];

    /**
     * Get all edges
     */
    getAllEdges(): IWorkflowEdge[];

    /**
     * Get node by ID
     */
    getNode(nodeId: string): IWorkflowNode | undefined;

    /**
     * Get edge by ID
     */
    getEdge(edgeId: string): IWorkflowEdge | undefined;

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
    subscribe(callback: TWorkflowUpdateCallback): () => void;

    /**
     * Unsubscribe from workflow updates
     */
    unsubscribe(callback: TWorkflowUpdateCallback): void;

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
export interface IExtendedWorkflowBuilder extends IWorkflowBuilder {
    /**
     * Add node to workflow
     */
    addNode(node: Omit<IWorkflowNode, 'timestamp'>, parentNodeId?: string): IWorkflowNode;

    /**
     * Update existing node
     */
    updateNode(nodeId: string, updates: Partial<IWorkflowNode>): IWorkflowNode | null;

    /**
     * Remove node from workflow
     */
    removeNode(nodeId: string): boolean;

    /**
     * Add edge to workflow
     */
    addEdge(edge: Omit<IWorkflowEdge, 'timestamp'>): IWorkflowEdge;

    /**
     * Update existing edge
     */
    updateEdge(edgeId: string, updates: Partial<IWorkflowEdge>): IWorkflowEdge | null;

    /**
     * Remove edge from workflow
     */
    removeEdge(edgeId: string): boolean;

    /**
     * Batch operations for performance
     */
    batch(operations: TWorkflowBatchOperation[]): void;

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
    getRawNodes(): IWorkflowNode[];
    getRawEdges(): IWorkflowEdge[];
}

/**
 * Workflow query interface for advanced querying
 */
export interface IWorkflowQuery {
    /**
     * Find nodes by criteria
     */
    findNodes(criteria: {
        type?: string | string[];
        status?: string | string[];
        level?: number | number[];
        parentId?: string;
        hasChildren?: boolean;
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    }): IWorkflowNode[];

    /**
     * Find edges by criteria
     */
    findEdges(criteria: {
        type?: string | string[];
        sourceId?: string;
        targetId?: string;
        hidden?: boolean;
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    }): IWorkflowEdge[];

    /**
     * Get connected nodes
     */
    getConnectedNodes(nodeId: string, direction?: 'incoming' | 'outgoing' | 'both'): IWorkflowNode[];

    /**
     * Get node path from root
     */
    getNodePath(nodeId: string): IWorkflowNode[];

    /**
     * Get workflow depth
     */
    getDepth(): number;

    /**
     * Find disconnected components
     */
    getDisconnectedComponents(): IWorkflowNode[][];
}

/**
 * Workflow export/import interface
 */
export interface IWorkflowPortable {
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
        nodes: IWorkflowNode[];
        edges: IWorkflowEdge[];
        metadata: {
            version: string;
            format: 'universal-workflow';
            nodeCount: number;
            edgeCount: number;
            createdAt: Date;
            [key: string]: TWorkflowBuilderExtensionValue | undefined;
        };
    };

    /**
     * Import from universal format
     */
    importFromUniversal(data: { version: string; format: string; data: IWorkflowSnapshot }): boolean;
}
