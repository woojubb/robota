// NodeEdgeManager - workflow node/edge creation with ordering and integrity
// Migrated from agents package to workflow package

import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
import type { UniversalWorkflowEdge } from '../types/universal-types.js';
import type { WorkflowNode, WorkflowConnectionType } from '../interfaces/workflow-node.js';

/**
 * NodeEdgeManager - guarantees sequential creation order and edge integrity.
 *
 * Core principles:
 * 1. Nodes/edges receive an internal monotonic numeric timestamp (no Date.now collisions).
 * 2. Edges are created only after validating source/target node existence.
 * 3. Immediate execution (no queues, no waits, no retries).
 * 4. Fail fast on design errors (no fallback).
 */
export class NodeEdgeManager {
    private logger: SimpleLogger;
    private nodeMap = new Map<string, WorkflowNode>();
    private edges: UniversalWorkflowEdge[] = [];
    private timestampCounter = 0;

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    private nextTimestamp(): number {
        this.timestampCounter += 1;
        return this.timestampCounter;
    }

    /**
     * Add a node (auto timestamp + fork/join pattern support)
     * @param node Node data (without timestamp)
     * @param parentNodeIds Parent node ids (single or array for join)
     * @param connectionType Connection type
     * @param connectionLabel Optional edge label
     */
    addNode(
        node: Omit<WorkflowNode, 'timestamp'>,
        parentNodeIds?: string | string[],
        connectionType: WorkflowConnectionType = 'processes',
        connectionLabel?: string
    ): WorkflowNode {
        const nodeWithTimestamp: WorkflowNode = {
            ...node,
            timestamp: this.nextTimestamp()
        } as WorkflowNode;

        // Immediate creation without queue
        this.nodeMap.set(nodeWithTimestamp.id, nodeWithTimestamp);
        this.logger.debug(`✅ [NODE-CREATED] ${nodeWithTimestamp.type} (${nodeWithTimestamp.id}) at ${nodeWithTimestamp.timestamp}`);

        // Optional immediate parent connections
        if (parentNodeIds) {
            const parentIds = Array.isArray(parentNodeIds) ? parentNodeIds : [parentNodeIds];

            if (parentIds.length > 1) {
                this.logger.debug(`🔀 [JOIN-PATTERN] Creating ${parentIds.length} edges for join node: ${nodeWithTimestamp.id}`);
            }

            parentIds.forEach((parentId, index) => {
                const edgeLabel = parentIds.length > 1
                    ? `${connectionLabel || 'join'}_${index}`
                    : connectionLabel;
                this.addEdge(parentId, nodeWithTimestamp.id, connectionType, edgeLabel);
            });
        }

        return nodeWithTimestamp;
    }

    /**
     * Add an edge (sequential, no queue)
     */
    addEdge(
        sourceId: string,
        targetId: string,
        type: WorkflowConnectionType,
        label?: string
    ): UniversalWorkflowEdge {
        const sourceNode = this.nodeMap.get(sourceId);
        const targetNode = this.nodeMap.get(targetId);

        if (!sourceNode || !targetNode) {
            throw new Error(
                `❌ [EDGE-ORDER-VIOLATION] Cannot create edge: source '${sourceId}' (${!sourceNode ? 'missing' : 'ok'}), target '${targetId}' (${!targetNode ? 'missing' : 'ok'}). ` +
                `STRICT POLICY: Edge creation must be atomic and sequential. Fix the emitter/handler to satisfy PATH-ONLY relationships. ` +
                `No fallback, no retries, no suppression — stop and correct the design.`
            );
        }

        const existingEdge = this.edges.find(edge =>
            edge.source === sourceId &&
            edge.target === targetId &&
            edge.type === type
        );

        if (existingEdge) {
            this.logger.debug(`🔄 [EDGE-DUPLICATE] Edge already exists: ${sourceId} → ${targetId} (${type})`);
            return existingEdge;
        }

        const ts = this.nextTimestamp();
        const edgeId = `edge_${sourceId}_${targetId}_${type}_${ts}`;
        const edge: UniversalWorkflowEdge = {
            id: edgeId,
            source: sourceId,
            target: targetId,
            type: type,
            label: label,
            timestamp: ts,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        this.edges.push(edge);
        this.logger.debug(`🔗 [EDGE-CREATED] ${sourceId} → ${targetId} (${type}) [${edgeId}]`);

        return edge;
    }

    /**
     * 노드 연결 (기존 노드들을 연결)
     */
    connectNodes(
        fromNode: WorkflowNode,
        toNode: WorkflowNode,
        type: WorkflowConnectionType,
        label?: string
    ): UniversalWorkflowEdge {
        return this.addEdge(fromNode.id, toNode.id, type, label);
    }

    /**
     * 노드 존재 확인
     */
    hasNode(nodeId: string): boolean {
        return this.nodeMap.has(nodeId);
    }

    /**
     * 엣지 존재 확인
     */
    hasEdge(edgeId: string): boolean {
        return this.edges.some(edge => edge.id === edgeId);
    }

    /**
     * 노드 조회
     */
    getNode(nodeId: string): WorkflowNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    /**
     * 엣지 조회
     */
    getEdge(edgeId: string): UniversalWorkflowEdge | undefined {
        return this.edges.find(edge => edge.id === edgeId);
    }

    /**
     * 모든 노드 반환
     */
    getAllNodes(): WorkflowNode[] {
        return Array.from(this.nodeMap.values());
    }

    /**
     * 모든 엣지 반환
     */
    getAllEdges(): UniversalWorkflowEdge[] {
        return [...this.edges];
    }

    /**
     * 노드 업데이트
     */
    updateNode(nodeId: string, updates: Partial<WorkflowNode>): WorkflowNode | null {
        const node = this.nodeMap.get(nodeId);
        if (!node) {
            this.logger.warn(`⚠️ [NODE-UPDATE] Node not found: ${nodeId}`);
            return null;
        }

        const updatedNode: WorkflowNode = {
            ...node,
            ...updates,
            // Preserve essential fields
            id: node.id,
            timestamp: node.timestamp,
        };

        this.nodeMap.set(nodeId, updatedNode);
        this.logger.debug(`🔄 [NODE-UPDATED] ${nodeId}`);

        return updatedNode;
    }

    /**
     * 엣지 업데이트
     */
    updateEdge(edgeId: string, updates: Partial<UniversalWorkflowEdge>): UniversalWorkflowEdge | null {
        const edgeIndex = this.edges.findIndex(edge => edge.id === edgeId);
        if (edgeIndex === -1) {
            this.logger.warn(`⚠️ [EDGE-UPDATE] Edge not found: ${edgeId}`);
            return null;
        }

        const edge = this.edges[edgeIndex];
        const updatedEdge: UniversalWorkflowEdge = {
            ...edge,
            ...updates,
            // Preserve essential fields
            id: edge.id,
            source: edge.source,
            target: edge.target,
            // Allow explicit timestamp override when provided
            timestamp: updates.timestamp !== undefined ? updates.timestamp : edge.timestamp,
            updatedAt: new Date(),
        };

        this.edges[edgeIndex] = updatedEdge;
        this.logger.debug(`🔄 [EDGE-UPDATED] ${edgeId}`);

        return updatedEdge;
    }

    /**
     * 노드 삭제
     */
    removeNode(nodeId: string): boolean {
        const node = this.nodeMap.get(nodeId);
        if (!node) {
            this.logger.warn(`⚠️ [NODE-REMOVE] Node not found: ${nodeId}`);
            return false;
        }

        // Remove associated edges
        this.edges = this.edges.filter(edge =>
            edge.source !== nodeId && edge.target !== nodeId
        );

        // Remove node
        this.nodeMap.delete(nodeId);
        this.logger.debug(`🗑️ [NODE-REMOVED] ${nodeId}`);

        return true;
    }

    /**
     * 엣지 삭제
     */
    removeEdge(edgeId: string): boolean {
        const edgeIndex = this.edges.findIndex(edge => edge.id === edgeId);
        if (edgeIndex === -1) {
            this.logger.warn(`⚠️ [EDGE-REMOVE] Edge not found: ${edgeId}`);
            return false;
        }

        this.edges.splice(edgeIndex, 1);
        this.logger.debug(`🗑️ [EDGE-REMOVED] ${edgeId}`);

        return true;
    }

    /**
     * 특정 노드의 연결된 엣지 조회
     */
    getNodeEdges(nodeId: string): {
        incoming: UniversalWorkflowEdge[];
        outgoing: UniversalWorkflowEdge[];
    } {
        const incoming = this.edges.filter(edge => edge.target === nodeId);
        const outgoing = this.edges.filter(edge => edge.source === nodeId);

        return { incoming, outgoing };
    }

    /**
     * 워크플로우 통계 조회
     */
    getStats(): {
        nodeCount: number;
        edgeCount: number;
        nodesByType: Record<string, number>;
        edgesByType: Record<string, number>;
    } {
        const nodesByType: Record<string, number> = {};
        const edgesByType: Record<string, number> = {};

        // Count nodes by type
        for (const node of this.nodeMap.values()) {
            nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
        }

        // Count edges by type
        for (const edge of this.edges) {
            edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
        }

        return {
            nodeCount: this.nodeMap.size,
            edgeCount: this.edges.length,
            nodesByType,
            edgesByType,
        };
    }

    /**
     * 워크플로우 검증
     */
    validate(): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check for orphaned edges
        for (const edge of this.edges) {
            if (!this.nodeMap.has(edge.source)) {
                errors.push(`Edge ${edge.id} references missing source node: ${edge.source}`);
            }
            if (!this.nodeMap.has(edge.target)) {
                errors.push(`Edge ${edge.id} references missing target node: ${edge.target}`);
            }
        }

        // Check for isolated nodes
        const connectedNodes = new Set<string>();
        for (const edge of this.edges) {
            connectedNodes.add(edge.source);
            connectedNodes.add(edge.target);
        }

        for (const nodeId of this.nodeMap.keys()) {
            if (!connectedNodes.has(nodeId) && this.nodeMap.size > 1) {
                warnings.push(`Node ${nodeId} is isolated (not connected to any other node)`);
            }
        }

        // Check for potential cycles (basic detection)
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (nodeId: string): boolean => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const outgoingEdges = this.edges.filter(edge => edge.source === nodeId);
            for (const edge of outgoingEdges) {
                if (hasCycle(edge.target)) return true;
            }

            recursionStack.delete(nodeId);
            return false;
        };

        for (const nodeId of this.nodeMap.keys()) {
            if (!visited.has(nodeId) && hasCycle(nodeId)) {
                warnings.push(`Potential cycle detected starting from node: ${nodeId}`);
                break; // Only report one cycle to avoid spam
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * 모든 데이터 정리
     */
    clear(): void {
        this.nodeMap.clear();
        this.edges = [];
        this.logger.debug(`🧹 [CLEAR] All nodes and edges cleared`);
    }

    /**
     * 워크플로우 데이터 Export
     */
    exportData(): {
        nodes: WorkflowNode[];
        edges: UniversalWorkflowEdge[];
        metadata: {
            exportedAt: Date;
            nodeCount: number;
            edgeCount: number;
        };
    } {
        return {
            nodes: this.getAllNodes(),
            edges: this.getAllEdges(),
            metadata: {
                exportedAt: new Date(),
                nodeCount: this.nodeMap.size,
                edgeCount: this.edges.length,
            },
        };
    }
}
