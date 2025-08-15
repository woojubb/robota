/**
 * ⚠️ LEGACY CODE - DELETE AFTER MIGRATION COMPLETE ⚠️
 * 
 * 🔄 MIGRATION STATUS: Being replaced by @robota-sdk/workflow package
 * 📁 NEW LOCATION: packages/workflow/src/services/node-edge-manager.ts
 * 🗑️ DELETE TARGET: This entire file after migration verification
 */

import { SimpleLogger, SilentLogger } from '../utils/simple-logger.js';
import type { UniversalWorkflowEdge } from './workflow-converter/universal-types.js';
import type { WorkflowNodeType } from '../constants/workflow-node-types.js';
// Minimal local replicas of types to avoid coupling to legacy subscriber
type WorkflowNodeStatus = 'pending' | 'running' | 'completed' | 'error';
interface WorkflowConnection { fromId: string; toId: string; type: WorkflowConnectionType; label?: string }
type WorkflowConnectionType =
    | 'has_tools'
    | 'contains'
    | 'receives'
    | 'processes'
    | 'continues'
    | 'executes'
    | 'creates'
    | 'triggers'
    | 'branch'
    | 'result'
    | 'analyze'
    | 'return'
    | 'final'
    | 'deliver'
    | 'integrates'
    | 'finalizes';

// 단순화된 타입 정의 (Phase 1 임시)
interface WorkflowNode extends Record<string, unknown> {
    id: string;
    type: WorkflowNodeType;
    level: number;
    status: WorkflowNodeStatus;
    data: Record<string, any>;
    connections: WorkflowConnection[];
    timestamp: number;
}

/**
 * NodeEdgeManager - 노드/엣지 생성 순서 및 무결성 보장
 */
export class NodeEdgeManager {
    private logger: SimpleLogger;
    private nodeMap = new Map<string, WorkflowNode>();
    private edges: UniversalWorkflowEdge[] = [];
    // Natural timestamps only; no artificial adjustments

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    // 🔒 Queue and retry mechanisms are removed to enforce strict event ordering and immediate failure on misuse

    /**
     * 노드 추가 (자동 timestamp 설정 + Fork/Join 패턴 지원)
     * @param node 노드 데이터 (timestamp 제외)
     * @param parentNodeIds 부모 노드 ID (단일 또는 배열 - Join 패턴 지원)
     * @param connectionType 연결 타입
     * @param connectionLabel 연결 라벨
     */
    addNode(
        node: Omit<WorkflowNode, 'timestamp'>,
        parentNodeIds?: string | string[],
        connectionType: WorkflowConnectionType = 'processes',
        connectionLabel?: string
    ): WorkflowNode {
        const nodeWithTimestamp: WorkflowNode = {
            ...node,
            timestamp: Date.now()
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
     * 엣지 추가 (순차 실행 큐 사용)
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
            throw new Error(`❌ [EDGE-ORDER-VIOLATION] Cannot create edge: source '${sourceId}' (${!sourceNode ? 'missing' : 'ok'}), target '${targetId}' (${!targetNode ? 'missing' : 'ok'}).`);
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

        // Natural timestamp for edge creation
        const edgeTimestamp = Date.now();

        const edge: UniversalWorkflowEdge = {
            id: `edge_${sourceId}_to_${targetId}_${this.edges.length}`,
            source: sourceId,
            target: targetId,
            type: type,
            label: label || type,
            timestamp: edgeTimestamp, // 🚀 Rule 10: Add timestamp field
            style: {
                type: 'default',
                animated: false,
                strokeColor: '#666666'
            },
            data: {
                executionOrder: this.edges.length,
                extensions: {
                    robota: {
                        originalType: type,
                        originalConnection: { fromId: sourceId, toId: targetId, type, label }
                    }
                }
            },
            createdAt: new Date(edgeTimestamp),
            updatedAt: new Date(edgeTimestamp)
        };

        this.edges.push(edge);

        if (!sourceNode.connections.some(c => c.toId === targetId)) {
            sourceNode.connections.push({ fromId: sourceId, toId: targetId, type, label });
        }

        this.logger.debug(`✅ [EDGE-CREATED] ${sourceId} → ${targetId} (${type}) at ${edge.timestamp}`);
        return edge;
    }

    /**
     * 기존 connectNodes 메서드 호환성 제공
     */
    connectNodes(fromNode: any, toNode: any, type: WorkflowConnectionType, label?: string): UniversalWorkflowEdge {
        return this.addEdge(fromNode.id, toNode.id, type, label);
    }

    /**
     * 기존 connectNodesById 메서드 호환성 제공
     */
    connectNodesById(fromId: string, toId: string, type: WorkflowConnectionType, label?: string): UniversalWorkflowEdge {
        return this.addEdge(fromId, toId, type, label);
    }

    getNode(nodeId: string): WorkflowNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    getAllNodes(): WorkflowNode[] {
        return Array.from(this.nodeMap.values());
    }

    getAllEdges(): UniversalWorkflowEdge[] {
        return this.edges;
    }

    hasNode(nodeId: string): boolean {
        return this.nodeMap.has(nodeId);
    }

    exportForJSON(): { nodes: WorkflowNode[], edges: UniversalWorkflowEdge[] } {
        return {
            nodes: this.getAllNodes(),
            edges: this.getAllEdges()
        };
    }

    getStats(): { nodeCount: number, edgeCount: number } {
        return {
            nodeCount: this.nodeMap.size,
            edgeCount: this.edges.length
        };
    }

    // Safe removal utilities for atomic operations
    removeNode(nodeId: string): void {
        if (!this.nodeMap.has(nodeId)) return;
        // Remove edges attached to this node
        this.edges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        this.nodeMap.delete(nodeId);
    }

    removeEdgeByEndpoints(sourceId: string, targetId: string, type?: string): void {
        this.edges = this.edges.filter(e => !(e.source === sourceId && e.target === targetId && (!type || e.type === type)));
    }
}
