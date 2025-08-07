/**
 * RealTimeWorkflowBuilder - 실시간 Workflow 구축 시스템
 * 
 * Purpose: WorkflowEventSubscriber의 Node 업데이트를 받아 실시간으로 Workflow 구조 구축
 * Architecture: Builder Pattern으로 점진적 Workflow 구성
 * 
 * 목표 구조:
 * User Input → Agent → Agent Thinking → Tool Call (assignTask) → Sub-Agent → Sub-Agent Thinking → Sub-Tool Calls → Sub-Response → Main Merge → Final Response
 */

import {
    WorkflowEventSubscriber,
    WorkflowNode,
    WorkflowNodeUpdate,
    WorkflowConnection,
    WorkflowConnectionType
} from './workflow-event-subscriber';
import { EventService } from './event-service';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';
import { WORKFLOW_NODE_TYPES, WorkflowNodeType } from '../constants/workflow-node-types';
import type { GenericMetadata } from '../interfaces/base-types';
import type { WorkflowData } from '../interfaces/workflow-converter';

// Universal Workflow Integration
import { WorkflowToUniversalConverter } from './workflow-converter';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from './workflow-converter/universal-types';
import type { WorkflowConversionOptions } from '../interfaces/workflow-converter';

// External Store interface for minimal modification
export interface ExternalWorkflowStore {
    getNodes(): UniversalWorkflowNode[];
    getEdges(): UniversalWorkflowEdge[];
}

/**
 * Workflow 구조 (목표 AssignTask 분기 구조)
 */
export interface WorkflowStructure extends WorkflowData {
    readonly __workflowType: 'RobotaWorkflowStructure';
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
    branches: WorkflowBranch[];  // assignTask 분기들
    metadata: WorkflowMetadata;
}

/**
 * Workflow 분기 (assignTask 별로 구분)
 */
export interface WorkflowBranch {
    id: string;
    name: string;                // "시장 분석", "메뉴 구성" 등
    assignTaskCallId: string;    // assignTask tool call ID
    subAgentId: string;          // Sub-Agent ID
    nodes: WorkflowNode[];       // 이 분기에 속한 모든 Node들
    status: 'pending' | 'running' | 'completed' | 'error';
}

/**
 * Workflow 메타데이터
 */
export interface WorkflowMetadata extends GenericMetadata {
    startTime: Date;
    endTime?: Date;
    totalDuration?: number;
    mainAgentId: string;
    totalBranches: number;
    completedBranches: number;
    executionId: string; // 빌드 오류에서 요구되는 속성 추가
}

/**
 * Workflow Update Event
 */
export interface WorkflowUpdate {
    type: 'structure_changed' | 'branch_added' | 'branch_completed' | 'workflow_completed';
    workflow: WorkflowStructure;
    changedBranch?: WorkflowBranch;
}

/**
 * RealTimeWorkflowBuilder
 * 실시간으로 Workflow 구조를 구축하고 관리
 */
export class RealTimeWorkflowBuilder {
    private logger: SimpleLogger;
    private workflowSubscriber: WorkflowEventSubscriber;
    private currentWorkflow: WorkflowStructure;
    private workflowUpdateCallbacks: ((update: WorkflowUpdate) => void)[] = [];

    // Node 연결 관계 추적
    private pendingConnections = new Map<string, PendingConnection>();
    private nodeParentMap = new Map<string, string>(); // nodeId → parentId

    // Universal Workflow Integration
    private universalConverter: WorkflowToUniversalConverter;
    private universalUpdateCallbacks: ((universalData: UniversalWorkflowStructure) => void)[] = [];

    // External Store Integration (STEP 8.2.1)
    private externalStore: ExternalWorkflowStore | null = null;

    constructor(
        eventService: EventService,
        logger?: SimpleLogger,
        externalStore?: ExternalWorkflowStore  // STEP 8.2.1: 외부 Store 주입 옵션 추가
    ) {
        this.logger = logger || SilentLogger;
        this.workflowSubscriber = eventService as WorkflowEventSubscriber;

        // STEP 8.2.1: 외부 Store 설정
        this.externalStore = externalStore || null;
        if (this.externalStore) {
            this.logger.debug('RealTimeWorkflowBuilder initialized with ExternalWorkflowStore');
        }

        // Universal 변환기 초기화
        this.universalConverter = new WorkflowToUniversalConverter(this.logger);

        // 초기 Workflow 구조
        this.currentWorkflow = {
            __workflowType: 'RobotaWorkflowStructure',
            nodes: [],
            connections: [],
            branches: [],
            metadata: {
                startTime: new Date(),
                mainAgentId: '',
                totalBranches: 0,
                completedBranches: 0,
                executionId: 'workflow-' + Date.now().toString()
            }
        };

        this.setupWorkflowSubscription();
        this.logger.debug('RealTimeWorkflowBuilder initialized with Universal workflow support');
    }

    /**
     * Workflow 업데이트 구독
     */
    subscribeToWorkflowUpdates(callback: (update: WorkflowUpdate) => void): void {
        this.workflowUpdateCallbacks.push(callback);
        this.logger.debug('New workflow update subscriber registered');
    }

    /**
     * WorkflowEventSubscriber에서 Node 업데이트 구독
     */
    private setupWorkflowSubscription(): void {
        this.workflowSubscriber.subscribeToWorkflowEvents((nodeUpdate) => {
            this.handleNodeUpdate(nodeUpdate);
        });
    }

    /**
     * Node 업데이트 처리 - 핵심 로직
     */
    private handleNodeUpdate(nodeUpdate: WorkflowNodeUpdate): void {
        const { action, node } = nodeUpdate;

        this.logger.debug(`Processing node update: ${action} ${node.type} (${node.id})`);

        switch (action) {
            case 'create':
                this.addNodeToWorkflow(node);
                this.establishConnections(node);
                break;

            case 'update':
                this.updateNodeInWorkflow(node);
                break;

            case 'complete':
                this.completeNode(node);
                break;

            case 'error':
                this.handleNodeError(node);
                break;
        }

        // Workflow 구조 변경 알림
        this.emitWorkflowUpdate('structure_changed');
    }

    /**
     * Node를 Workflow에 추가
     */
    private addNodeToWorkflow(node: WorkflowNode): void {
        // 기존 Node 중복 확인
        const existingIndex = this.currentWorkflow.nodes.findIndex(n => n.id === node.id);
        if (existingIndex !== -1) {
            this.currentWorkflow.nodes[existingIndex] = node;
        } else {
            this.currentWorkflow.nodes.push(node);
        }

        // 특별한 Node 타입 처리
        switch (node.type) {
            case WORKFLOW_NODE_TYPES.USER_INPUT:
                this.handleUserInputNode(node);
                break;

            case WORKFLOW_NODE_TYPES.AGENT:
                this.handleMainAgentNode(node);
                break;

            case WORKFLOW_NODE_TYPES.TOOL_CALL:
                this.handleToolCallNode(node);
                break;

            // case 'sub_agent': // 제거됨 - 모든 agent는 동일한 'agent' 타입 사용
            //     this.handleSubAgentNode(node);
            //     break;
        }

        this.logger.debug(`Added node to workflow: ${node.type} (${node.id})`);
    }

    /**
     * User Input Node 처리 - Workflow 시작점
     */
    private handleUserInputNode(node: WorkflowNode): void {
        // Workflow 시작 시간 설정
        this.currentWorkflow.metadata.startTime = new Date(node.timestamp);
        this.logger.debug('Workflow started with user input');
    }

    /**
     * Main Agent Node 처리
     */
    private handleMainAgentNode(node: WorkflowNode): void {
        this.currentWorkflow.metadata.mainAgentId = node.id;
        this.logger.debug(`Main agent identified: ${node.id}`);
    }

    /**
     * Tool Call Node 처리 - assignTask 분기 생성의 핵심
     */
    private handleToolCallNode(node: WorkflowNode): void {
        // assignTask 호출인 경우 새 분기 생성
        if (node.data.toolName === 'assignTask') {
            this.createAssignTaskBranch(node);
        }
    }

    /**
     * assignTask 분기 생성
     */
    private createAssignTaskBranch(toolCallNode: WorkflowNode): void {
        const branch: WorkflowBranch = {
            id: `branch_${toolCallNode.id}`,
            name: this.extractBranchName(toolCallNode),
            assignTaskCallId: toolCallNode.id,
            subAgentId: '', // Sub-Agent 생성 시 설정
            nodes: [toolCallNode],
            status: 'pending'
        };

        this.currentWorkflow.branches.push(branch);
        this.currentWorkflow.metadata.totalBranches++;

        this.logger.debug(`Created assignTask branch: ${branch.name} (${branch.id})`);
        this.emitWorkflowUpdate('branch_added', branch);
    }

    /**
     * 분기 이름 추출 (assignTask parameters에서)
     */
    private extractBranchName(toolCallNode: WorkflowNode): string {
        const params = toolCallNode.data.parameters;
        if (params && params.jobDescription) {
            // "시장 분석을 해주세요" → "시장 분석"
            const desc = params.jobDescription as string;
            if (desc.includes('시장')) return '시장 분석';
            if (desc.includes('메뉴')) return '메뉴 구성';
            return desc.substring(0, 20) + '...';
        }
        return `Branch ${this.currentWorkflow.branches.length + 1}`;
    }

    // 🗑️ handleSubAgentNode removed - unified agent handling for domain neutrality

    /**
     * assignTask ID로 분기 찾기
     */
    private findBranchByAssignTaskId(assignTaskId: string): WorkflowBranch | undefined {
        return this.currentWorkflow.branches.find(branch =>
            branch.assignTaskCallId === assignTaskId ||
            branch.assignTaskCallId === `tool_call_${assignTaskId}`
        );
    }

    // 🗑️ createSpawnConnection removed - unified connection handling for domain neutrality

    /**
     * Node 간 연결 관계 설정
     */
    private establishConnections(node: WorkflowNode): void {
        // Parent-Child 연결 (🚀 와일드카드 방지: parentId가 확실히 존재하는 경우에만)
        if (node.parentId && !node.parentId.includes('*') && !node.parentId.includes('undefined')) {
            this.createParentChildConnection(node.parentId, node.id, node.type);
        } else if (node.parentId) {
            this.logger.warn(`🚨 [WILDCARD-PREVENTION] Skipping invalid parentId: ${node.parentId} for node: ${node.id}`);
        }

        // 🚀 CONVERTER BYPASS: Skip WorkflowConnection collection
        // NodeEdgeManager handles all edge creation directly
        // Removing converter dependency as per user's real-time data generation goal
        this.logger.debug(`🚀 [CONVERTER-BYPASS] Skipping WorkflowConnection collection for node: ${node.id}`);

        // 특별한 연결 규칙들
        this.applySpecialConnectionRules(node);
    }

    /**
     * Parent-Child 연결 생성
     */
    private createParentChildConnection(parentId: string, childId: string, childType: WorkflowNodeType): void {
        const connectionType = this.determineConnectionType(childType);

        const connection: WorkflowConnection = {
            fromId: parentId,
            toId: childId,
            type: connectionType,
            label: this.getConnectionLabel(connectionType)
        };

        this.currentWorkflow.connections.push(connection);
        this.nodeParentMap.set(childId, parentId);
    }

    /**
     * Node 타입에 따른 연결 타입 결정
     */
    private determineConnectionType(nodeType: WorkflowNodeType): WorkflowConnectionType {
        switch (nodeType) {
            case WORKFLOW_NODE_TYPES.AGENT: return 'receives';
            case WORKFLOW_NODE_TYPES.AGENT_THINKING: return 'processes';
            case WORKFLOW_NODE_TYPES.TOOL_CALL: return 'executes';
            case WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE: return 'result';
            case WORKFLOW_NODE_TYPES.RESPONSE: return 'return'; // 도메인 중립적 통일
            case WORKFLOW_NODE_TYPES.TOOL_RESULT: return 'analyze';
            default: return 'result';
        }
    }

    /**
     * 연결 타입별 라벨
     */
    private getConnectionLabel(connectionType: WorkflowConnectionType): string {
        const labels: Record<WorkflowConnectionType, string> = {
            'has_tools': 'has tools',
            'contains': 'contains',
            'receives': 'receives input',
            'processes': 'processes',
            'continues': 'continues thinking',
            'executes': 'executes',

            'creates': 'creates',
            'triggers': 'triggers message',
            'branch': 'branches to',
            'result': 'returns result',
            'analyze': 'analyzes',
            'return': 'returns to',

            'integrates': 'integrates',
            'finalizes': 'finalizes',
            'final': 'generates',
            'deliver': 'delivers'
        };
        return labels[connectionType] || '';
    }

    /**
     * 특별한 연결 규칙 적용
     */
    private applySpecialConnectionRules(node: WorkflowNode): void {
        // Agent Response → Main Agent Merge 연결 (도메인 중립적)
        if (node.type === WORKFLOW_NODE_TYPES.RESPONSE) {
            this.createReturnToMainConnection(node);
        }

        // Multiple Responses → Response 연결 (도메인 중립적)
        if (node.type === WORKFLOW_NODE_TYPES.RESPONSE) {
            this.createConsolidationConnections(node);
        }
    }

    /**
     * Sub-Agent Response를 Main Agent로 반환하는 연결
     */
    private createReturnToMainConnection(subResponseNode: WorkflowNode): void {
        const mainAgentId = this.currentWorkflow.metadata.mainAgentId;
        if (mainAgentId) {
            const connection: WorkflowConnection = {
                fromId: subResponseNode.id,
                toId: mainAgentId,
                type: 'return',
                label: 'returns result to main agent'
            };

            this.currentWorkflow.connections.push(connection);
        }
    }

    /**
     * 여러 Sub-Response를 Final Response로 통합하는 연결
     */
    private createConsolidationConnections(finalResponseNode: WorkflowNode): void {
        // 모든 Sub-Response Node 찾기
        const subResponseNodes = this.currentWorkflow.nodes.filter(n => n.type === WORKFLOW_NODE_TYPES.RESPONSE);

        subResponseNodes.forEach(subResponseNode => {
            const connection: WorkflowConnection = {
                fromId: subResponseNode.id,
                toId: finalResponseNode.id,
                type: 'analyze',
                label: 'consolidates into final response'
            };

            this.currentWorkflow.connections.push(connection);
        });
    }

    /**
     * Node 업데이트
     */
    private updateNodeInWorkflow(node: WorkflowNode): void {
        const index = this.currentWorkflow.nodes.findIndex(n => n.id === node.id);
        if (index !== -1) {
            this.currentWorkflow.nodes[index] = node;
        }

        // 분기 상태 업데이트
        this.updateBranchStatus(node);
    }

    /**
     * 분기 상태 업데이트
     */
    private updateBranchStatus(node: WorkflowNode): void {
        this.currentWorkflow.branches.forEach(branch => {
            if (branch.nodes.some(n => n.id === node.id)) {
                // 분기 내 모든 Node가 완료되었는지 확인
                const allCompleted = branch.nodes.every(n => n.status === 'completed');
                if (allCompleted && branch.status !== 'completed') {
                    branch.status = 'completed';
                    this.currentWorkflow.metadata.completedBranches++;

                    this.logger.debug(`Branch completed: ${branch.name}`);
                    this.emitWorkflowUpdate('branch_completed', branch);

                    // 모든 분기가 완료되었는지 확인
                    this.checkWorkflowCompletion();
                }
            }
        });
    }

    /**
     * Node 완료 처리
     */
    private completeNode(node: WorkflowNode): void {
        node.status = 'completed';
        this.updateNodeInWorkflow(node);
    }

    /**
     * Node 오류 처리
     */
    private handleNodeError(node: WorkflowNode): void {
        node.status = 'error';
        this.updateNodeInWorkflow(node);

        // 해당 분기도 오류로 표시
        this.currentWorkflow.branches.forEach(branch => {
            if (branch.nodes.some(n => n.id === node.id)) {
                branch.status = 'error';
            }
        });
    }

    /**
     * Workflow 완료 확인
     */
    private checkWorkflowCompletion(): void {
        const totalBranches = this.currentWorkflow.metadata.totalBranches;
        const completedBranches = this.currentWorkflow.metadata.completedBranches;

        if (totalBranches > 0 && completedBranches === totalBranches) {
            this.currentWorkflow.metadata.endTime = new Date();
            this.currentWorkflow.metadata.totalDuration =
                this.currentWorkflow.metadata.endTime.getTime() -
                this.currentWorkflow.metadata.startTime.getTime();

            this.logger.debug('Workflow completed');
            this.emitWorkflowUpdate('workflow_completed');
        }
    }

    /**
     * Workflow 업데이트 이벤트 발생
     */
    private emitWorkflowUpdate(type: WorkflowUpdate['type'], changedBranch?: WorkflowBranch): void {
        const update: WorkflowUpdate = {
            type,
            workflow: { ...this.currentWorkflow },
            changedBranch
        };

        // 기존 워크플로우 업데이트 알림
        this.workflowUpdateCallbacks.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error('Error in workflow update callback:', error);
            }
        });

        // Universal 워크플로우 업데이트 알림 (비동기)
        this.notifyUniversalUpdates().catch(error => {
            this.logger.error('Error notifying Universal workflow updates:', error);
        });
    }

    /**
     * 현재 Workflow 구조 가져오기
     */
    getCurrentWorkflow(): WorkflowStructure {
        return { ...this.currentWorkflow };
    }

    /**
     * 특정 분기 가져오기
     */
    getBranch(branchId: string): WorkflowBranch | undefined {
        return this.currentWorkflow.branches.find(b => b.id === branchId);
    }

    /**
     * Workflow 통계
     */
    getWorkflowStats(): {
        totalNodes: number;
        totalConnections: number;
        totalBranches: number;
        completedBranches: number;
        isCompleted: boolean;
        duration?: number;
    } {
        return {
            totalNodes: this.currentWorkflow.nodes.length,
            totalConnections: this.currentWorkflow.connections.length,
            totalBranches: this.currentWorkflow.metadata.totalBranches,
            completedBranches: this.currentWorkflow.metadata.completedBranches,
            isCompleted: this.currentWorkflow.metadata.endTime !== undefined,
            duration: this.currentWorkflow.metadata.totalDuration
        };
    }

    // ================================
    // Universal Workflow Integration Methods
    // ================================

    /**
     * Universal 워크플로우 데이터 구독
     */
    subscribeToUniversalUpdates(callback: (universalData: UniversalWorkflowStructure) => void): void {
        this.universalUpdateCallbacks.push(callback);
        this.logger.debug('New Universal workflow update subscriber registered');
    }

    /**
     * 현재 워크플로우를 Universal 형식으로 변환하여 반환
     * STEP 8.2.3: 외부 Store 노드들과 SDK 노드들 병합
     */
    async generateUniversalWorkflow(): Promise<UniversalWorkflowStructure | null> {
        try {
            this.logger.debug('Generating Universal workflow data from current workflow');

            // 1. 현재 워크플로우를 Universal 형식으로 변환
            const conversionOptions: WorkflowConversionOptions = {
                validateInput: true,
                validateOutput: true,
                includeDebug: false
            };

            // 🚀 CONVERTER BYPASS: Use NodeEdgeManager edges directly
            const nodeEdgeManagerEdges = this.workflowSubscriber.getNodeEdgeManagerEdges();
            this.logger.debug(`🚀 [CONVERTER-BYPASS] Using NodeEdgeManager edges: ${nodeEdgeManagerEdges.length} (skipping converter)`);

            // Basic conversion without converter dependency
            const universalNodes = this.currentWorkflow.nodes.map((node, index) => ({
                id: node.id,
                type: node.type,
                parentId: node.parentId,
                level: Math.floor(index / 3), // Basic level assignment
                position: {
                    x: 0,
                    y: 0,
                    level: Math.floor(index / 3),
                    order: index % 3
                },
                visualState: {
                    status: (node.status as 'pending' | 'running' | 'completed' | 'error' | 'skipped') || 'completed',
                    emphasis: 'normal' as const,
                    lastUpdated: new Date(node.timestamp)
                },
                data: {
                    label: node.data?.label || node.id,
                    description: node.data?.description || '',
                    ...node.data
                },
                createdAt: new Date(node.timestamp).toISOString(),
                updatedAt: new Date(node.timestamp).toISOString(),
                timestamp: node.timestamp
            }));

            const universalResult = {
                success: true,
                data: {
                    __workflowType: "UniversalWorkflowStructure" as const,
                    id: `workflow-${Date.now()}`,
                    name: 'Real-time Generated Workflow',
                    nodes: universalNodes,
                    edges: nodeEdgeManagerEdges, // 🚀 Direct NodeEdgeManager edges usage
                    layout: {
                        direction: 'TB' as const,
                        spacing: { x: 200, y: 100 },
                        algorithm: 'hierarchical' as const
                    },
                    metadata: {
                        ...this.currentWorkflow.metadata,
                        totalNodes: universalNodes.length,
                        totalEdges: nodeEdgeManagerEdges.length,
                        workflowType: 'real-time-generation'
                    }
                } as unknown as UniversalWorkflowStructure
            };

            // STEP 8.2.3: 외부 Store 노드들과 병합
            if (this.externalStore) {
                const externalNodes = this.externalStore.getNodes();
                const externalEdges = this.externalStore.getEdges();

                if (externalNodes.length > 0) {
                    // 기존 노드들과 외부 노드들 병합 (중복 제거)
                    const existingNodeIds = new Set(universalResult.data.nodes.map(n => n.id));
                    const newExternalNodes = externalNodes.filter(n => !existingNodeIds.has(n.id));

                    universalResult.data.nodes = [...newExternalNodes, ...universalResult.data.nodes];
                    this.logger.debug(`Merged ${newExternalNodes.length} external nodes with ${universalResult.data.nodes.length - newExternalNodes.length} SDK nodes`);
                }

                if (externalEdges.length > 0) {
                    // 기존 엣지들과 외부 엣지들 병합 (중복 제거)
                    const existingEdgeIds = new Set(universalResult.data.edges.map(e => e.id));
                    const newExternalEdges = externalEdges.filter(e => !existingEdgeIds.has(e.id));

                    universalResult.data.edges = [...newExternalEdges, ...universalResult.data.edges];
                    this.logger.debug(`Merged ${newExternalEdges.length} external edges`);
                }
            }

            this.logger.debug('Universal workflow data generated successfully', {
                nodeCount: universalResult.data.nodes.length,
                edgeCount: universalResult.data.edges.length,
                hasExternalStore: !!this.externalStore
            });

            return universalResult.data;

        } catch (error) {
            this.logger.error('Error generating Universal workflow data', { error });
            return null;
        }
    }

    /**
     * 워크플로우 업데이트 시 Universal 데이터도 함께 생성하여 알림
     */
    private async notifyUniversalUpdates(): Promise<void> {
        if (this.universalUpdateCallbacks.length === 0) {
            return; // 구독자가 없으면 처리하지 않음
        }

        try {
            const universalData = await this.generateUniversalWorkflow();
            if (universalData) {
                this.universalUpdateCallbacks.forEach(callback => {
                    try {
                        callback(universalData);
                    } catch (error) {
                        this.logger.error('Error in Universal workflow update callback', { error });
                    }
                });
            }
        } catch (error) {
            this.logger.error('Error notifying Universal workflow updates', { error });
        }
    }

    /**
     * Universal 워크플로우 관련 통계 정보
     */
    getUniversalStats(): {
        hasUniversalSubscribers: boolean;
        subscriberCount: number;
    } {
        return {
            hasUniversalSubscribers: this.universalUpdateCallbacks.length > 0,
            subscriberCount: this.universalUpdateCallbacks.length
        };
    }

    /**
     * Manual 업데이트 트리거 (External Store 변경 시 호출)
     * Purpose: External Store에 노드가 추가되었을 때 SDK Store 업데이트를 즉시 트리거
     */
    async triggerManualUpdate(): Promise<void> {
        this.logger.debug('Manual update triggered - notifying Universal workflow subscribers');

        // notifyUniversalUpdates를 직접 호출하여 즉시 업데이트
        await this.notifyUniversalUpdates();

        this.logger.debug('Manual update completed');
    }
}

/**
 * 대기 중인 연결 정보
 */
interface PendingConnection {
    fromId: string;
    toId: string;
    type: WorkflowConnectionType;
    waitingFor: 'node_creation' | 'node_completion';
}