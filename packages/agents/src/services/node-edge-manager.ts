/**
 * NodeEdgeManager: 노드/엣지 생성 순서 보장 및 무결성 관리
 * 
 * 핵심 원칙:
 * 1. 모든 노드/엣지는 이 Manager를 통해서만 생성
 * 2. timestamp는 내부에서 자동 생성 (Date.now()) - 외부 주입 금지
 * 3. 생성 후 timestamp 수정 절대 불가
 * 4. Source Node → Target Node → Edge 순서 강제
 */

import type { UniversalWorkflowEdge } from './workflow-converter/universal-types';
import { SimpleLogger } from '../utils/simple-logger';
import type { WorkflowNode, WorkflowConnection, WorkflowConnectionType } from './workflow-event-subscriber';

export class NodeEdgeManager {
    private nodes = new Map<string, WorkflowNode>();
    private edges: UniversalWorkflowEdge[] = [];
    private logger: SimpleLogger;

    constructor(logger: SimpleLogger) {
        this.logger = logger;
    }

    /**
     * 노드 생성 및 선택적 연결
     * @param node 생성할 노드 (timestamp는 내부에서 자동 설정)
     * @param targetNodeId 연결할 대상 노드 ID (선택적)
     * @param connectionType 연결 타입 (targetNodeId 제공 시 필수)
     * @param connectionLabel 연결 라벨 (선택적)
     */
    addNode(
        node: Omit<WorkflowNode, 'timestamp'>,
        targetNodeId?: string,
        connectionType?: WorkflowConnectionType,
        connectionLabel?: string
    ): WorkflowNode {
        // 🚨 [STRICT-ORDER-ENFORCEMENT] targetNodeId가 null인 경우는 첫 번째 노드일 때만 허용
        if (!targetNodeId) {
            if (this.nodes.size > 0) {
                throw new Error(`🚨 [ORDER-VIOLATION] targetNodeId is required when nodes already exist. Current nodes: ${this.nodes.size}. This node must connect to an existing node to maintain proper workflow order.`);
            }
            this.logger.debug(`🔒 [FIRST-NODE] Creating first node in workflow: ${node.id}`);
        }

        // 🔒 내부에서 timestamp 자동 생성 - 외부 주입 불가
        const finalNode: WorkflowNode = {
            ...node,
            timestamp: Date.now() // 🔒 무결성: 절대 수정 불가
        };

        // 1️⃣ Source Node 생성 및 저장
        this.nodes.set(finalNode.id, finalNode);
        this.logger.debug(`🔒 [NODE-MANAGER] Created node: ${finalNode.id} (timestamp: ${finalNode.timestamp})`);

        // 2️⃣ Target Node 존재 확인 및 Edge 생성
        if (targetNodeId && connectionType) {
            const targetNode = this.nodes.get(targetNodeId);
            if (!targetNode) {
                throw new Error(`🚨 [ORDER-VIOLATION] Target node ${targetNodeId} does not exist. Must create target before connecting to it.`);
            }

            // 3️⃣ Edge 생성 (Source와 Target 모두 존재 보장됨)
            this.createEdge(finalNode.id, targetNodeId, connectionType, connectionLabel);
        }

        return finalNode;
    }

    /**
     * 직접 엣지 생성 (addNode에서 내부적으로 사용)
     * 외부에서 직접 호출 금지 - addNode를 통해서만 사용
     */
    private createEdge(
        sourceId: string,
        targetId: string,
        type: WorkflowConnectionType,
        label?: string
    ): UniversalWorkflowEdge {
        // 순서 검증: Source와 Target 노드가 모두 존재해야 함
        const sourceNode = this.nodes.get(sourceId);
        const targetNode = this.nodes.get(targetId);

        if (!sourceNode || !targetNode) {
            throw new Error(`🚨 [ORDER-VIOLATION] Cannot create edge: missing nodes (source: ${!!sourceNode}, target: ${!!targetNode})`);
        }

        // 🔒 내부에서 timestamp 자동 생성 - 외부 주입 불가
        const edge: UniversalWorkflowEdge = {
            id: `edge_${sourceId}_to_${targetId}_${this.edges.length}`,
            source: sourceId,
            target: targetId,
            type: type,
            label: label || type,
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
            createdAt: new Date(),
            updatedAt: new Date(),
            timestamp: Date.now() // 🔒 무결성: 절대 수정 불가
        };

        // timestamp 순서 검증 (Rule 11 준수)
        if (edge.timestamp < sourceNode.timestamp || edge.timestamp < targetNode.timestamp) {
            throw new Error(`🚨 [TIMESTAMP-VIOLATION] Edge created before its nodes (edge: ${edge.timestamp}, source: ${sourceNode.timestamp}, target: ${targetNode.timestamp})`);
        }

        this.edges.push(edge);
        this.logger.debug(`🔒 [EDGE-MANAGER] Created edge: ${sourceId} → ${targetId} (${type}, timestamp: ${edge.timestamp})`);

        // 기존 노드의 connections도 업데이트 (호환성)
        if (!sourceNode.connections.some(c => c.toId === targetId)) {
            sourceNode.connections.push({ fromId: sourceId, toId: targetId, type, label });
        }

        return edge;
    }

    /**
     * 모든 노드 반환
     */
    getAllNodes(): WorkflowNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * 모든 엣지 반환
     */
    getAllEdges(): UniversalWorkflowEdge[] {
        return [...this.edges];
    }

    /**
     * 특정 노드 조회
     */
    getNode(id: string): WorkflowNode | undefined {
        return this.nodes.get(id);
    }

    /**
     * 노드 존재 여부 확인
     */
    hasNode(id: string): boolean {
        return this.nodes.has(id);
    }

    /**
     * 통계 정보
     */
    getStats(): { nodeCount: number; edgeCount: number } {
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.length
        };
    }
}