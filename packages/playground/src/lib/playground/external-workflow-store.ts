/**
 * ExternalWorkflowStore - external injection surface for the workflow store
 *
 * Purpose: allow manual node/edge injection without modifying the core SDK store.
 */

import type { IUniversalWorkflowEdge, IUniversalWorkflowNode } from '@robota-sdk/workflow';
import { SilentLogger, type ILogger } from '@robota-sdk/agents';

/**
 * External workflow store interface.
 * Provides a minimal API for adding manual nodes/edges into the store.
 */
export interface IExternalWorkflowStore {
    // Node management
    addNode(node: IUniversalWorkflowNode): void;
    getNodes(): IUniversalWorkflowNode[];

    // Edge management
    addEdge(edge: IUniversalWorkflowEdge): void;
    getEdges(): IUniversalWorkflowEdge[];

    // Manual node helpers
    addAgentNode(agentData: { id: string; name: string; level?: number; taskName?: string }): void;
    addUserInputNode(inputData: { id: string; content: string }): void;

    // Lifecycle
    clear(): void;

    // Update callback
    setUpdateCallback(callback: () => Promise<void>): void;
}

export interface IManualAgentData {
    id: string;
    name: string;
    level?: number;
    taskName?: string;
}

export interface IManualUserInputData {
    id: string;
    content: string;
}

/**
 * Default external workflow store implementation.
 * Stores injected nodes/edges using universal workflow shapes.
 */
export class DefaultExternalWorkflowStore implements IExternalWorkflowStore {
    private nodes: IUniversalWorkflowNode[] = [];
    private edges: IUniversalWorkflowEdge[] = [];
    private logger: ILogger;
    private updateCallback: (() => Promise<void>) | null = null;

    constructor(logger: ILogger = SilentLogger) {
        this.logger = logger;
        this.logger.debug('DefaultExternalWorkflowStore initialized');
    }

    /**
     * Add a node (universal shape).
     */
    addNode(node: IUniversalWorkflowNode): void {
        this.nodes.push(node);
        this.logger.debug(`Added node: ${node.id} (type: ${node.type})`);

        // Trigger store update after node insertion.
        this.triggerUpdate();
    }

    /**
     * Get all nodes.
     */
    getNodes(): IUniversalWorkflowNode[] {
        return [...this.nodes];
    }

    /**
     * Add an edge (universal shape).
     */
    addEdge(edge: IUniversalWorkflowEdge): void {
        this.edges.push(edge);
        this.logger.debug(`Added edge: ${edge.id} (${edge.source} → ${edge.target})`);

        // Trigger store update after edge insertion.
        this.triggerUpdate();
    }

    /**
     * Get all edges.
     */
    getEdges(): IUniversalWorkflowEdge[] {
        return [...this.edges];
    }

    /**
     * Add an agent node helper.
     */
    addAgentNode(agentData: IManualAgentData): void {
        const agentLevel = agentData.level ?? 1;
        const agentName = agentData.name ?? 'Agent';
        const now = Date.now();
        const agentNode: IUniversalWorkflowNode = {
            id: agentData.id,
            type: 'agent',
            level: agentLevel,
            status: 'pending',
            timestamp: now,
            connections: [],
            position: {
                x: 150 + agentLevel * 200,
                y: 200,
                level: agentLevel,
                order: 0
            },
            data: {
                label: agentName,
                description: agentData.taskName ?? '',
                tools: ['assignTask']
            },
            visualState: {
                status: 'pending',
                emphasis: 'normal',
                lastUpdated: new Date()
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.addNode(agentNode);
        this.logger.info(`Agent node added: ${agentName} (${agentData.id})`);
    }

    /**
     * User message node creation is disabled - the event system will create nodes.
     */
    addUserInputNode(_inputData: IManualUserInputData): void {
        this.logger.debug('User Input node creation disabled - event system will handle');
        // Manual node creation is intentionally removed.
    }

    /**
     * Clear all nodes and edges.
     */
    clear(): void {
        this.nodes = [];
        this.edges = [];
        this.logger.debug('External workflow store cleared');
    }

    /**
     * Set update callback (SDK Store trigger).
     */
    setUpdateCallback(callback: () => Promise<void>): void {
        this.updateCallback = callback;
        this.logger.debug('Update callback set for SDK Store trigger');
    }

    /**
     * Trigger SDK Store update (async).
     */
    private triggerUpdate(): void {
        if (this.updateCallback) {
            this.updateCallback().catch(error => {
                this.logger.error('Error triggering SDK Store update:', error);
            });
        }
    }
}