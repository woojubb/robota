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
    WorkflowNodeType,
    WorkflowConnectionType
} from './workflow-event-subscriber';
import { EventService } from './event-service';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';
import type { GenericMetadata } from '../interfaces/base-types';
import type { WorkflowData } from '../interfaces/workflow-converter';

// Universal Workflow Integration
import { WorkflowToUniversalConverter } from './workflow-converter';
import type {
    UniversalWorkflowStructure
} from './workflow-converter/universal-types';
import type { WorkflowConversionOptions } from '../interfaces/workflow-converter';

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

    constructor(
        eventService: EventService,
        logger?: SimpleLogger
    ) {
        this.logger = logger || SilentLogger;
        this.workflowSubscriber = eventService as WorkflowEventSubscriber;

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
            case 'user_input':
                this.handleUserInputNode(node);
                break;

            case 'agent':
                this.handleMainAgentNode(node);
                break;

            case 'tool_call':
                this.handleToolCallNode(node);
                break;

            case 'sub_agent':
                this.handleSubAgentNode(node);
                break;
        }

        this.logger.debug(`Added node to workflow: ${node.type} (${node.id})`);
    }

    /**
     * User Input Node 처리 - Workflow 시작점
     */
    private handleUserInputNode(node: WorkflowNode): void {
        // Workflow 시작 시간 설정
        this.currentWorkflow.metadata.startTime = node.timestamp;
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

    /**
     * Sub-Agent Node 처리 - 분기에 Sub-Agent 연결
     */
    private handleSubAgentNode(node: WorkflowNode): void {
        // parentExecutionId를 통해 해당하는 assignTask 분기 찾기
        const parentExecutionId = node.data.parentExecutionId;
        if (!parentExecutionId) return;

        const branch = this.findBranchByAssignTaskId(parentExecutionId);
        if (branch) {
            branch.subAgentId = node.id;
            branch.nodes.push(node);
            branch.status = 'running';

            // Tool Call → Sub-Agent spawn 연결 생성
            this.createSpawnConnection(branch.assignTaskCallId, node.id);

            this.logger.debug(`Sub-Agent connected to branch: ${branch.name} → ${node.id}`);
        }
    }

    /**
     * assignTask ID로 분기 찾기
     */
    private findBranchByAssignTaskId(assignTaskId: string): WorkflowBranch | undefined {
        return this.currentWorkflow.branches.find(branch =>
            branch.assignTaskCallId === assignTaskId ||
            branch.assignTaskCallId === `tool_call_${assignTaskId}`
        );
    }

    /**
     * spawn 연결 생성 (Tool Call → Sub-Agent)
     */
    private createSpawnConnection(fromNodeId: string, toNodeId: string): void {
        const connection: WorkflowConnection = {
            fromId: fromNodeId,
            toId: toNodeId,
            type: 'spawn',
            label: 'creates sub-agent'
        };

        this.currentWorkflow.connections.push(connection);

        // 해당 Tool Call Node에도 연결 추가
        const toolCallNode = this.currentWorkflow.nodes.find(n => n.id === fromNodeId);
        if (toolCallNode) {
            toolCallNode.connections.push(connection);
        }

        this.logger.debug(`Created spawn connection: ${fromNodeId} → ${toNodeId}`);
    }

    /**
     * Node 간 연결 관계 설정
     */
    private establishConnections(node: WorkflowNode): void {
        // Parent-Child 연결
        if (node.parentId) {
            this.createParentChildConnection(node.parentId, node.id, node.type);
        }

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
            case 'agent': return 'receives';
            case 'agent_thinking': return 'processes';
            case 'tool_call': return 'executes';
            case 'sub_agent': return 'spawn';
            case 'sub_tool_call': return 'executes';
            case 'sub_response': return 'return';
            case 'final_response': return 'final';
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
            'executes': 'executes',
            'branch': 'branches to',
            'result': 'returns result',
            'analyze': 'analyzes',
            'spawn': 'creates',
            'delegate': 'delegates to',
            'return': 'returns to',
            'consolidate': 'consolidates',
            'final': 'generates',
            'deliver': 'delivers'
        };
        return labels[connectionType] || '';
    }

    /**
     * 특별한 연결 규칙 적용
     */
    private applySpecialConnectionRules(node: WorkflowNode): void {
        // Sub-Agent Response → Main Agent Merge 연결
        if (node.type === 'sub_response') {
            this.createReturnToMainConnection(node);
        }

        // Multiple Sub-Responses → Final Response 연결
        if (node.type === 'final_response') {
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
        const subResponseNodes = this.currentWorkflow.nodes.filter(n => n.type === 'sub_response');

        subResponseNodes.forEach(subResponseNode => {
            const connection: WorkflowConnection = {
                fromId: subResponseNode.id,
                toId: finalResponseNode.id,
                type: 'consolidate',
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

            const universalResult = await this.universalConverter.convert(
                this.currentWorkflow,
                conversionOptions
            );

            if (!universalResult.success || !universalResult.data) {
                this.logger.error('Failed to convert workflow to Universal format', {
                    error: universalResult.errors
                });
                return null;
            }

            this.logger.debug('Universal workflow data generated successfully', {
                nodeCount: universalResult.data.nodes.length,
                edgeCount: universalResult.data.edges.length
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