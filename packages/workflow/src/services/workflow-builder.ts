// Workflow Builder Implementation
// Core workflow building and management service

import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
import type {
    IExtendedWorkflowBuilder,
    IWorkflowQuery,
    IWorkflowPortable,
    IWorkflowSnapshot,
    TWorkflowBatchOperation,
    TWorkflowBuilderExtensionValue,
    TWorkflowUpdate,
    TWorkflowUpdateCallback,
    IWorkflowBuilderConfig
} from '../interfaces/workflow-builder.js';
import type { IWorkflowNode, TWorkflowConnectionType } from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import type { IUniversalWorkflowEdge } from '../types/universal-types.js';
import { NodeEdgeManager } from './node-edge-manager.js';
import { WORKFLOW_DEFAULTS, WORKFLOW_CONSTRAINTS } from '../constants/defaults.js';

/**
 * Core WorkflowBuilder implementation
 * Provides comprehensive workflow building and management capabilities
 */
export class CoreWorkflowBuilder implements IExtendedWorkflowBuilder, IWorkflowQuery, IWorkflowPortable {
    private logger: SimpleLogger;
    private nodeEdgeManager: NodeEdgeManager;
    private subscribers: Set<TWorkflowUpdateCallback> = new Set();
    private config: Required<IWorkflowBuilderConfig>;
    private updateCounter = 0;
    private lastUpdateTime?: Date;

    constructor(config: IWorkflowBuilderConfig = {}) {
        this.config = {
            autoTimestamp: config.autoTimestamp ?? WORKFLOW_DEFAULTS.AUTO_TIMESTAMP,
            validateConnections: config.validateConnections ?? WORKFLOW_DEFAULTS.VALIDATE_CONNECTIONS,
            maxNodes: config.maxNodes ?? WORKFLOW_CONSTRAINTS.MAX_NODES,
            maxEdges: config.maxEdges ?? WORKFLOW_CONSTRAINTS.MAX_EDGES,
            logger: config.logger ?? {
                debug: SilentLogger.debug.bind(SilentLogger),
                info: SilentLogger.info.bind(SilentLogger),
                warn: SilentLogger.warn.bind(SilentLogger),
                error: SilentLogger.error.bind(SilentLogger),
                log: SilentLogger.log.bind(SilentLogger),
            },
        };

        this.logger = this.config.logger;
        this.nodeEdgeManager = new NodeEdgeManager(this.logger);

        this.logger.debug('🏗️ [WORKFLOW-BUILDER] Initialized', {
            autoTimestamp: this.config.autoTimestamp,
            validateConnections: this.config.validateConnections,
            maxNodes: this.config.maxNodes,
            maxEdges: this.config.maxEdges
        });
    }

    // =================================================================
    // Core WorkflowBuilder Interface Implementation
    // =================================================================

    getSnapshot(): IWorkflowSnapshot {
        const nodes = this.nodeEdgeManager.getAllNodes();
        const edges = this.nodeEdgeManager.getAllEdges().map(edge => this.convertUniversalEdgeToWorkflowEdge(edge));

        return {
            id: `snapshot_${Date.now()}`,
            timestamp: new Date(),
            nodes,
            edges,
            metadata: {
                nodeCount: nodes.length,
                edgeCount: edges.length,
                createdAt: new Date(),
                version: '1.0.0',
                builderOptions: {
                    autoTimestamp: this.config.autoTimestamp,
                    validateConnections: this.config.validateConnections,
                    maxNodes: this.config.maxNodes,
                    maxEdges: this.config.maxEdges
                }
            },
        };
    }

    getAllNodes(): IWorkflowNode[] {
        return this.nodeEdgeManager.getAllNodes();
    }

    getAllEdges(): IWorkflowEdge[] {
        // Convert UniversalWorkflowEdge to WorkflowEdge
        return this.nodeEdgeManager.getAllEdges().map(edge => this.convertUniversalEdgeToWorkflowEdge(edge));
    }

    /**
     * Raw accessors (append-only order) for source-of-truth export without any transformation
     */
    getRawNodes(): IWorkflowNode[] {
        return this.nodeEdgeManager.getAllNodes();
    }

    getRawEdges(): IWorkflowEdge[] {
        return this.getAllEdges();
    }

    getNode(nodeId: string): IWorkflowNode | undefined {
        return this.nodeEdgeManager.getNode(nodeId);
    }

    getEdge(edgeId: string): IWorkflowEdge | undefined {
        const universalEdge = this.nodeEdgeManager.getEdge(edgeId);
        return universalEdge ? this.convertUniversalEdgeToWorkflowEdge(universalEdge) : undefined;
    }

    hasNode(nodeId: string): boolean {
        return this.nodeEdgeManager.hasNode(nodeId);
    }

    hasEdge(edgeId: string): boolean {
        return this.nodeEdgeManager.hasEdge(edgeId);
    }

    subscribe(callback: TWorkflowUpdateCallback): () => void {
        this.subscribers.add(callback);
        this.logger.debug(`📡 [SUBSCRIPTION] Added subscriber, total: ${this.subscribers.size}`);

        // Return unsubscribe function
        return () => {
            this.unsubscribe(callback);
        };
    }

    unsubscribe(callback: TWorkflowUpdateCallback): void {
        const removed = this.subscribers.delete(callback);
        if (removed) {
            this.logger.debug(`📡 [UNSUBSCRIPTION] Removed subscriber, total: ${this.subscribers.size}`);
        }
    }

    clear(): void {
        this.nodeEdgeManager.clear();
        this.updateCounter = 0;
        this.lastUpdateTime = undefined;
        this.notifySubscribers({ action: 'clear' });
        this.logger.debug('🧹 [CLEAR] Workflow cleared');
    }

    getStats() {
        const stats = this.nodeEdgeManager.getStats();
        return {
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
            totalUpdates: this.updateCounter,
            lastUpdateTime: this.lastUpdateTime,
        };
    }

    // =================================================================
    // ExtendedWorkflowBuilder Interface Implementation
    // =================================================================

    addNode(node: Omit<IWorkflowNode, 'timestamp'>, parentNodeId?: string): IWorkflowNode {
        // Validate constraints
        if (this.nodeEdgeManager.getAllNodes().length >= this.config.maxNodes) {
            throw new Error(`Cannot add node: Maximum node limit (${this.config.maxNodes}) reached`);
        }

        // Create node using NodeEdgeManager
        const createdNode = this.nodeEdgeManager.addNode(node, parentNodeId);

        // Notify subscribers
        this.notifySubscribers({
            action: 'create',
            node: createdNode,
        });

        this.updateCounter++;
        this.lastUpdateTime = new Date();
        this.logger.debug(`➕ [ADD-NODE] Added node: ${createdNode.id}`);

        return createdNode;
    }

    updateNode(nodeId: string, updates: Partial<IWorkflowNode>): IWorkflowNode | null {
        const updatedNode = this.nodeEdgeManager.updateNode(nodeId, updates);
        if (!updatedNode) return null;

        // Notify subscribers
        this.notifySubscribers({
            action: 'update',
            node: updatedNode,
        });

        this.updateCounter++;
        this.lastUpdateTime = new Date();
        this.logger.debug(`🔄 [UPDATE-NODE] Updated node: ${nodeId}`);

        return updatedNode;
    }

    removeNode(nodeId: string): boolean {
        const node = this.nodeEdgeManager.getNode(nodeId);
        if (!node) return false;

        const success = this.nodeEdgeManager.removeNode(nodeId);
        if (success) {
            // Notify subscribers
            this.notifySubscribers({
                action: 'update', // Use 'update' for removal to maintain consistency
                node: node,
            });

            this.updateCounter++;
            this.lastUpdateTime = new Date();
            this.logger.debug(`🗑️ [REMOVE-NODE] Removed node: ${nodeId}`);
        }

        return success;
    }

    addEdge(edge: Omit<IWorkflowEdge, 'timestamp'>): IWorkflowEdge {
        // Validate constraints
        if (this.nodeEdgeManager.getAllEdges().length >= this.config.maxEdges) {
            throw new Error(`Cannot add edge: Maximum edge limit (${this.config.maxEdges}) reached`);
        }

        // Convert WorkflowEdge to UniversalWorkflowEdge format for NodeEdgeManager
        const universalEdge = this.nodeEdgeManager.addEdge(
            edge.source,
            edge.target,
            edge.type,
            edge.label
        );

        const workflowEdge = this.convertUniversalEdgeToWorkflowEdge(universalEdge);

        this.updateCounter++;
        this.lastUpdateTime = new Date();
        this.logger.debug(`🔗 [ADD-EDGE] Added edge: ${workflowEdge.id}`);

        return workflowEdge;
    }

    updateEdge(edgeId: string, updates: Partial<IWorkflowEdge>): IWorkflowEdge | null {
        const nextData =
            updates.data || typeof updates.executionOrder !== 'undefined' || typeof updates.dependsOn !== 'undefined'
                ? {
                    executionOrder: updates.executionOrder,
                    dependsOn: updates.dependsOn,
                    className: updates.data?.className,
                    extensions: updates.data?.extensions,
                    metadata: updates.data?.metadata,
                    extra: updates.data?.extra
                }
                : undefined;

        // Convert updates to UniversalWorkflowEdge format
        const universalUpdates: Partial<IUniversalWorkflowEdge> = {
            id: updates.id,
            source: updates.source,
            target: updates.target,
            type: updates.type,
            label: updates.label,
            description: updates.description,
            sourceHandle: updates.sourceHandle,
            targetHandle: updates.targetHandle,
            hidden: updates.hidden,
            conditional: updates.conditional,
            data: nextData,
            updatedAt: new Date(),
        };

        const updatedUniversalEdge = this.nodeEdgeManager.updateEdge(edgeId, universalUpdates);
        if (!updatedUniversalEdge) return null;

        const workflowEdge = this.convertUniversalEdgeToWorkflowEdge(updatedUniversalEdge);

        this.updateCounter++;
        this.lastUpdateTime = new Date();
        this.logger.debug(`🔄 [UPDATE-EDGE] Updated edge: ${edgeId}`);

        return workflowEdge;
    }

    removeEdge(edgeId: string): boolean {
        const success = this.nodeEdgeManager.removeEdge(edgeId);
        if (success) {
            this.updateCounter++;
            this.lastUpdateTime = new Date();
            this.logger.debug(`🗑️ [REMOVE-EDGE] Removed edge: ${edgeId}`);
        }

        return success;
    }

    batch(operations: TWorkflowBatchOperation[]): void {
        this.logger.debug(`📦 [BATCH] Starting batch operation with ${operations.length} operations`);

        const startTime = Date.now();
        let successCount = 0;
        let errorCount = 0;

        for (const operation of operations) {
            try {
                switch (operation.type) {
                    case 'addNode':
                        this.addNode(operation.data);
                        break;
                    case 'updateNode':
                        this.updateNode(operation.data.nodeId, operation.data.updates);
                        break;
                    case 'removeNode':
                        this.removeNode(operation.data.nodeId);
                        break;
                    case 'addEdge':
                        this.addEdge(operation.data);
                        break;
                    case 'updateEdge':
                        this.updateEdge(operation.data.edgeId, operation.data.updates);
                        break;
                    case 'removeEdge':
                        this.removeEdge(operation.data.edgeId);
                        break;
                    default:
                        // Exhaustiveness check: all operation types must be handled above.
                        // If this fails, update TWorkflowBatchOperation to include the new case.
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const _exhaustive: never = operation;
                        throw new Error('Unhandled batch operation');
                }
                successCount++;
            } catch (error) {
                errorCount++;
                this.logger.error(`❌ [BATCH-ERROR] Operation ${operation.type} failed:`, error);
            }
        }

        const duration = Date.now() - startTime;
        this.logger.debug(`📦 [BATCH] Completed: ${successCount} success, ${errorCount} errors, ${duration}ms`);
    }

    validate() {
        return this.nodeEdgeManager.validate();
    }

    // =================================================================
    // WorkflowQuery Interface Implementation
    // =================================================================

    findNodes(criteria: {
        type?: string | string[];
        status?: string | string[];
        level?: number | number[];
        parentId?: string;
        hasChildren?: boolean;
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    }): IWorkflowNode[] {
        const nodes = this.nodeEdgeManager.getAllNodes();

        return nodes.filter(node => {
            // Type filter
            if (criteria.type) {
                const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
                if (!types.includes(node.type)) return false;
            }

            // Status filter
            if (criteria.status) {
                const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status];
                if (!statuses.includes(node.status)) return false;
            }

            // Level filter
            if (criteria.level !== undefined) {
                const levels = Array.isArray(criteria.level) ? criteria.level : [criteria.level];
                if (!levels.includes(node.level)) return false;
            }

            // Parent ID filter
            if (criteria.parentId !== undefined) {
                if (node.parentId !== criteria.parentId) return false;
            }

            // Has children filter
            if (criteria.hasChildren !== undefined) {
                const hasChildren = this.nodeEdgeManager.getAllEdges().some(edge => edge.source === node.id);
                if (hasChildren !== criteria.hasChildren) return false;
            }

            return true;
        });
    }

    findEdges(criteria: {
        type?: string | string[];
        sourceId?: string;
        targetId?: string;
        hidden?: boolean;
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    }): IWorkflowEdge[] {
        const edges = this.getAllEdges();

        return edges.filter(edge => {
            // Type filter
            if (criteria.type) {
                const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
                if (!types.includes(edge.type)) return false;
            }

            // Source ID filter
            if (criteria.sourceId && edge.source !== criteria.sourceId) return false;

            // Target ID filter
            if (criteria.targetId && edge.target !== criteria.targetId) return false;

            // Hidden filter
            if (criteria.hidden !== undefined && edge.hidden !== criteria.hidden) return false;

            return true;
        });
    }

    getConnectedNodes(nodeId: string, direction: 'incoming' | 'outgoing' | 'both' = 'both'): IWorkflowNode[] {
        const { incoming, outgoing } = this.nodeEdgeManager.getNodeEdges(nodeId);
        const connectedNodeIds = new Set<string>();

        if (direction === 'incoming' || direction === 'both') {
            incoming.forEach(edge => connectedNodeIds.add(edge.source));
        }

        if (direction === 'outgoing' || direction === 'both') {
            outgoing.forEach(edge => connectedNodeIds.add(edge.target));
        }

        return Array.from(connectedNodeIds)
            .map(id => this.nodeEdgeManager.getNode(id))
            .filter((node): node is IWorkflowNode => node !== undefined);
    }

    getNodePath(nodeId: string): IWorkflowNode[] {
        const path: IWorkflowNode[] = [];
        let currentNodeId: string | undefined = nodeId;

        while (currentNodeId) {
            const node = this.nodeEdgeManager.getNode(currentNodeId);
            if (!node) break;

            path.unshift(node); // Add to beginning for root-to-target order
            currentNodeId = node.parentId;
        }

        return path;
    }

    getDepth(): number {
        const nodes = this.nodeEdgeManager.getAllNodes();
        return Math.max(...nodes.map(node => node.level), 0);
    }

    getDisconnectedComponents(): IWorkflowNode[][] {
        const nodes = this.nodeEdgeManager.getAllNodes();
        const edges = this.nodeEdgeManager.getAllEdges();
        const visited = new Set<string>();
        const components: IWorkflowNode[][] = [];

        const dfs = (nodeId: string, component: IWorkflowNode[]) => {
            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            const node = this.nodeEdgeManager.getNode(nodeId);
            if (node) component.push(node);

            // Find connected nodes (both directions)
            edges.forEach(edge => {
                if (edge.source === nodeId && !visited.has(edge.target)) {
                    dfs(edge.target, component);
                }
                if (edge.target === nodeId && !visited.has(edge.source)) {
                    dfs(edge.source, component);
                }
            });
        };

        nodes.forEach(node => {
            if (!visited.has(node.id)) {
                const component: IWorkflowNode[] = [];
                dfs(node.id, component);
                if (component.length > 0) {
                    components.push(component);
                }
            }
        });

        return components;
    }

    // =================================================================
    // WorkflowPortable Interface Implementation
    // =================================================================

    exportToJSON(): string {
        const data = this.nodeEdgeManager.exportData();
        return JSON.stringify({
            format: 'workflow-builder',
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            data,
        }, null, 2);
    }

    importFromJSON(json: string): boolean {
        try {
            const parsed = JSON.parse(json);

            if (parsed.format !== 'workflow-builder') {
                this.logger.error('❌ [IMPORT] Invalid format, expected: workflow-builder');
                return false;
            }

            // Clear existing data
            this.clear();

            // Import nodes
            if (parsed.data?.nodes) {
                for (const node of parsed.data.nodes) {
                    this.nodeEdgeManager.addNode(node);
                }
            }

            // Import edges would need to be handled differently since we need to convert formats
            // This is a simplified implementation
            this.logger.debug('✅ [IMPORT] Successfully imported workflow data');
            return true;

        } catch (error) {
            this.logger.error('❌ [IMPORT] Failed to import JSON:', error);
            return false;
        }
    }

    exportToUniversal() {
        const snapshot = this.getSnapshot();
        // Flat model export for example/verification/playground compatibility.
        return {
            nodes: snapshot.nodes,
            edges: snapshot.edges,
            metadata: {
                ...snapshot.metadata,
                version: '1.0.0',
                format: 'universal-workflow' as const
            }
        };
    }

    importFromUniversal(data: { version: string; format: string; data: IWorkflowSnapshot }): boolean {
        if (data.format !== 'universal-workflow') {
            this.logger.error('❌ [IMPORT] Invalid format, expected: universal-workflow');
            return false;
        }

        try {
            // Clear existing data
            this.clear();

            // Import nodes
            for (const node of data.data.nodes) {
                this.addNode(node);
            }

            // Import edges
            for (const edge of data.data.edges) {
                this.addEdge(edge);
            }

            this.logger.debug('✅ [IMPORT] Successfully imported universal workflow data');
            return true;

        } catch (error) {
            this.logger.error('❌ [IMPORT] Failed to import universal data:', error);
            return false;
        }
    }

    // =================================================================
    // Private Helper Methods
    // =================================================================

    private notifySubscribers(update: TWorkflowUpdate): void {
        this.subscribers.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error('❌ [SUBSCRIBER-ERROR] Error in update callback:', error);
            }
        });
    }

    private convertUniversalEdgeToWorkflowEdge(universalEdge: IUniversalWorkflowEdge): IWorkflowEdge {
        return {
            id: universalEdge.id,
            source: universalEdge.source,
            target: universalEdge.target,
            type: universalEdge.type as TWorkflowConnectionType,
            label: universalEdge.label,
            description: universalEdge.description,
            sourceHandle: universalEdge.sourceHandle,
            targetHandle: universalEdge.targetHandle,
            executionOrder: universalEdge.data?.executionOrder,
            dependsOn: universalEdge.data?.dependsOn,
            hidden: universalEdge.hidden,
            conditional: universalEdge.conditional,
            data: universalEdge.data ? {
                className: universalEdge.data.className,
                metadata: universalEdge.data.metadata,
                extensions: universalEdge.data.extensions,
                extra: universalEdge.data.extra
            } : undefined,
            timestamp: universalEdge.timestamp || Date.now(),
            createdAt: universalEdge.createdAt,
            updatedAt: universalEdge.updatedAt,
        };
    }
}
