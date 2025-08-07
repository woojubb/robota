import { SimpleLogger, SilentLogger } from '../utils/simple-logger.js';
import type { UniversalWorkflowEdge } from './workflow-converter/universal-types.js';
import type { WorkflowNodeType } from '../constants/workflow-node-types.js';
import type {
    WorkflowNodeStatus,
    WorkflowConnection,
    WorkflowConnectionType
} from './workflow-event-subscriber.js';

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

    // 🎯 순차 실행 큐: 생성 작업만 순서대로 처리 (timestamp는 각자 생성 시점)
    private executionQueue: Array<() => void> = [];
    private isProcessing = false;
    private retryCount?: Map<string, number>;

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    /**
     * 🎯 순차 실행 큐 - 생성 작업을 순서대로 처리
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.executionQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.executionQueue.length > 0) {
            const task = this.executionQueue.shift()!;
            try {
                task(); // 즉시 실행 (각자의 timestamp로 생성)
            } catch (error) {
                this.logger.error(`❌ [QUEUE-ERROR] Task execution failed: ${error}`);
            }
        }

        this.isProcessing = false;
    }

    /**
     * 🎯 작업을 큐에 추가하고 순차 처리 시작
     */
    private enqueueTask(task: () => void): void {
        this.executionQueue.push(task);

        // 즉시 처리 시작 (비동기로 다음 tick에서)
        process.nextTick(() => this.processQueue());
    }

    /**
     * 🎯 임시 Edge 객체 생성 (재시도용)
     */
    private createTempEdge(sourceId: string, targetId: string, type: WorkflowConnectionType, label?: string): UniversalWorkflowEdge {
        const now = new Date();
        return {
            id: `temp_edge_${sourceId}_to_${targetId}_${Date.now()}`,
            source: sourceId,
            target: targetId,
            type,
            label: label || type,
            timestamp: Date.now(),
            createdAt: now,
            updatedAt: now
        };
    }

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
        // 🎯 순차 실행을 위해 일단 임시 노드 생성 (동기식 반환용)
        const nodeWithTimestamp: WorkflowNode = {
            ...node,
            timestamp: Date.now()
        } as WorkflowNode;

        // 🎯 실제 생성 작업을 큐에 추가
        this.enqueueTask(() => {
            // 실제 생성 시점의 timestamp로 재설정
            nodeWithTimestamp.timestamp = Date.now();

            this.nodeMap.set(nodeWithTimestamp.id, nodeWithTimestamp);
            this.logger.debug(`✅ [NODE-CREATED] ${nodeWithTimestamp.type} (${nodeWithTimestamp.id}) at ${nodeWithTimestamp.timestamp}`);

            // 🎯 Fork/Join 패턴 지원: 단일 또는 다중 부모 처리
            if (parentNodeIds) {
                const parentIds = Array.isArray(parentNodeIds) ? parentNodeIds : [parentNodeIds];

                if (parentIds.length > 1) {
                    this.logger.debug(`🔀 [JOIN-PATTERN] Creating ${parentIds.length} edges for join node: ${nodeWithTimestamp.id}`);
                }

                // 각 부모에 대해 독립적으로 edge 생성 (각자의 timestamp)
                parentIds.forEach((parentId, index) => {
                    const edgeLabel = parentIds.length > 1
                        ? `${connectionLabel || 'join'}_${index}`
                        : connectionLabel;
                    this.addEdgeInternal(parentId, nodeWithTimestamp.id, connectionType, edgeLabel);
                });
            }
        });

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
        // 🎯 임시 edge 객체 생성 (동기식 반환용)
        const now = new Date();
        const tempEdge: UniversalWorkflowEdge = {
            id: `edge_${sourceId}_to_${targetId}_${this.edges.length}`,
            source: sourceId,
            target: targetId,
            type,
            label: label || type,
            timestamp: Date.now(),
            createdAt: now,
            updatedAt: now
        };

        // 🎯 실제 생성 작업을 큐에 추가
        this.enqueueTask(() => {
            this.addEdgeInternal(sourceId, targetId, type, label);
        });

        return tempEdge;
    }

    /**
     * 엣지 추가 (내부 실행용 - 큐에서 순차 호출)
     */
    private addEdgeInternal(
        sourceId: string,
        targetId: string,
        type: WorkflowConnectionType,
        label?: string
    ): UniversalWorkflowEdge {
        const sourceNode = this.nodeMap.get(sourceId);
        const targetNode = this.nodeMap.get(targetId);

        // 🎯 Node가 아직 생성되지 않았다면 큐 끝으로 재배치 (최대 3회 재시도)
        if (!sourceNode || !targetNode) {
            // retry counter 추가
            const retryKey = `${sourceId}_${targetId}_${type}`;
            if (!this.retryCount) {
                this.retryCount = new Map();
            }

            const currentRetries = this.retryCount.get(retryKey) || 0;
            if (currentRetries < 3) {
                this.retryCount.set(retryKey, currentRetries + 1);
                this.logger.debug(`⏳ [EDGE-RETRY] Node not ready, retrying edge creation (${currentRetries + 1}/3): ${sourceId} → ${targetId}`);

                // 큐 끝으로 재배치
                this.enqueueTask(() => this.addEdgeInternal(sourceId, targetId, type, label));
                return this.createTempEdge(sourceId, targetId, type, label);
            }

            // 3회 재시도 후에도 실패하면 에러
            throw new Error(`❌ [EDGE-ORDER-VIOLATION] Cannot create edge after 3 retries: source '${sourceId}' (${!sourceNode ? 'missing' : 'ok'}), target '${targetId}' (${!targetNode ? 'missing' : 'ok'}).`);
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

        // 🚀 Natural Timestamp: Edge gets timestamp at actual creation moment
        const edgeTimestamp = Date.now(); // Natural creation time

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
}
