/**
 * WorkflowEventSubscriber - 실시간 이벤트 구독 시스템
 * 
 * Purpose: 모든 EventService 이벤트를 실시간으로 구독하여 Workflow Node로 변환
 * Architecture: Observer Pattern으로 이벤트 → Node 변환 처리
 */

import { EventService, ServiceEventType, ServiceEventData, ActionTrackingEventService } from './event-service';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Workflow Node 기본 구조
 */
export interface WorkflowNode {
    id: string;
    type: WorkflowNodeType;
    parentId?: string;
    level: number;
    status: WorkflowNodeStatus;
    data: WorkflowNodeData;
    timestamp: Date;
    connections: WorkflowConnection[];
}

/**
 * Node Types (목표 구조에 맞춘 정의)
 */
export type WorkflowNodeType =
    // Entry/Exit Points
    | 'user_input'        // 사용자 입력 (시작점)
    | 'output'            // 사용자 출력 (종료점)

    // Agent Core
    | 'agent'             // Agent 중심 노드 (Team Leader)
    | 'sub_agent'         // Sub-Agent (시장 분석 전문, 메뉴 구성 전문)
    | 'tools_container'   // Tools 컨테이너
    | 'tool_definition'   // 개별 Tool 정의

    // Execution Flow
    | 'agent_thinking'    // Agent 사고/판단 과정
    | 'tool_call'         // 개별 Tool 실행 (assignTask 등)
    | 'sub_tool_call'     // Sub-Agent 내부 Tool 호출
    | 'merge_results'     // 여러 Tool 결과 합류
    | 'sub_merge'         // Sub-Agent 내부 결과 합류
    | 'final_response'    // 최종 응답 생성
    | 'sub_response';     // Sub-Agent 응답

/**
 * Node Status
 */
export type WorkflowNodeStatus =
    | 'pending'           // 대기 중
    | 'running'           // 실행 중
    | 'completed'         // 완료
    | 'error';            // 오류

/**
 * Connection Types (목표 구조의 연결 타입)
 */
export type WorkflowConnectionType =
    | 'has_tools'         // Agent → Tools Container
    | 'contains'          // Tools Container → Tool Definition
    | 'receives'          // User Input → Agent
    | 'processes'         // Agent → Agent Thinking
    | 'executes'          // Agent Thinking → Tool Call
    | 'branch'            // 병렬 분기 (Thinking → multiple Tool Calls)
    | 'result'            // Tool Call → Merge
    | 'analyze'           // 연쇄 분석 (Merge → next Thinking)
    | 'spawn'             // Tool Call → Sub-Agent (assignTask 분기)
    | 'delegate'          // Tool Call → Sub-Agent (작업 위임)
    | 'return'            // Sub-Agent Response → Main Merge (결과 반환)
    | 'consolidate'       // Multiple Sub-Responses → Main Agent (통합)
    | 'final'             // 최종 결과 (Response → Output)
    | 'deliver';          // 출력 전달

/**
 * Workflow Connection
 */
export interface WorkflowConnection {
    fromId: string;
    toId: string;
    type: WorkflowConnectionType;
    label?: string;
}

/**
 * Node Data
 */
export interface WorkflowNodeData {
    eventType?: ServiceEventType;
    sourceId?: string;
    sourceType?: string;
    toolName?: string;
    agentTemplate?: string;
    executionId?: string;
    parentExecutionId?: string;
    parameters?: any;
    result?: any;
    metadata?: any;
}

/**
 * Node Update Event
 */
export interface WorkflowNodeUpdate {
    action: 'create' | 'update' | 'complete' | 'error';
    node: WorkflowNode;
    relatedNodes?: WorkflowNode[]; // 연관된 노드들 (연결 관계)
}

/**
 * WorkflowEventSubscriber
 * EventService 이벤트를 모니터링하여 Workflow Node로 변환
 * EventService에 구독 메서드가 없으므로 ActionTrackingEventService를 확장하여 사용
 */
export class WorkflowEventSubscriber extends ActionTrackingEventService {
    private logger: SimpleLogger;
    private nodeUpdateCallbacks: ((update: WorkflowNodeUpdate) => void)[] = [];
    private nodeMap = new Map<string, WorkflowNode>(); // Node 캐시

    constructor(logger?: SimpleLogger) {
        super(); // ActionTrackingEventService 생성자와 호환 (baseEventService 기본값 사용)
        this.logger = logger || SilentLogger;
        console.log('🏗️ [WorkflowEventSubscriber] Constructor called - Instance created');
        this.logger.debug('WorkflowEventSubscriber initialized');
    }

    /**
     * Workflow Node 업데이트 구독
     */
    subscribeToWorkflowEvents(callback: (nodeUpdate: WorkflowNodeUpdate) => void): void {
        this.nodeUpdateCallbacks.push(callback);
        this.logger.debug('New workflow event subscriber registered');
    }

    /**
     * 이벤트 구독 해제
     */
    unsubscribe(callback: (nodeUpdate: WorkflowNodeUpdate) => void): void {
        const index = this.nodeUpdateCallbacks.indexOf(callback);
        if (index !== -1) {
            this.nodeUpdateCallbacks.splice(index, 1);
            this.logger.debug('Workflow event subscriber removed');
        }
    }

    /**
     * emit 메서드 오버라이드하여 이벤트 모니터링
     * 모든 이벤트가 이 메서드를 통과하므로 여기서 Node 생성 처리
     */
    public override emit(eventType: ServiceEventType, data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Received event: ${eventType}`, {
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            executionId: data.executionId
        });

        // 부모 클래스의 emit 호출 (hierarchy 추적 등)
        super.emit(eventType, data);

        // 이벤트 타입별 Node 생성 처리
        this.handleEventForWorkflow(eventType, data);
    }

    /**
     * 이벤트를 Workflow Node로 변환
     */
    private handleEventForWorkflow(eventType: ServiceEventType, data: ServiceEventData): void {
        switch (eventType) {
            case 'user.message':
                this.handleUserMessage(data);
                break;
            case 'execution.start':
                this.handleExecutionStart(data);
                break;
            case 'execution.complete':
                this.handleExecutionComplete(data);
                break;
            case 'assistant.message_start':
                this.handleAssistantMessageStart(data);
                break;
            case 'assistant.message_complete':
                this.handleAssistantMessageComplete(data);
                break;
            case 'tool_call_start':
                this.handleToolCallStart(data);
                break;
            case 'tool_call_complete':
                this.handleToolCallComplete(data);
                break;
            case 'agent.creation_start':
                this.handleAgentCreationStart(data);
                break;
            case 'agent.creation_complete':
                this.handleAgentCreationComplete(data);
                break;
            case 'agent.execution_start':
                this.handleAgentExecutionStart(data);
                break;
            case 'agent.execution_complete':
                this.handleAgentExecutionComplete(data);
                break;
            case 'task.completed':
                this.handleTaskCompleted(data);
                break;
            case 'task.aggregation_start':
                this.handleTaskAggregationStart(data);
                break;
            case 'task.aggregation_complete':
                this.handleTaskAggregationComplete(data);
                break;
            case 'tool_results_to_llm':
                this.handleToolResultsToLLM(data);
                break;
            case 'task.assigned':
                this.handleTaskAssigned(data);
                break;
            case 'team.analysis_start':
                this.handleTeamAnalysisStart(data);
                break;
            case 'team.analysis_complete':
                this.handleTeamAnalysisComplete(data);
                break;
        }
    }

    /**
     * User Message 이벤트 처리 → user_input Node
     */
    private handleUserMessage(data: ServiceEventData): void {
        const node = this.createUserInputNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Execution Start 이벤트 처리 → agent Node 또는 sub_agent Node
     */
    private handleExecutionStart(data: ServiceEventData): void {
        // Sub-Agent vs Main Agent 구분
        if (data.sourceType === 'sub-agent') {
            const node = this.createSubAgentNode(data);
            this.emitNodeUpdate('create', node);
        } else {
            const node = this.createAgentNode(data);
            this.emitNodeUpdate('create', node);
        }
    }

    /**
     * Assistant Message Start 이벤트 처리 → agent_thinking Node
     */
    private handleAssistantMessageStart(data: ServiceEventData): void {
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Tool Call Start 이벤트 처리 → tool_call Node (assignTask 분기 핵심)
     */
    private handleToolCallStart(data: ServiceEventData): void {
        // assignTask vs 일반 Tool 구분
        if (data.toolName === 'assignTask') {
            const node = this.createAssignTaskCallNode(data);
            this.emitNodeUpdate('create', node);
        } else {
            // Sub-Agent 내부 Tool 호출
            const node = this.createSubToolCallNode(data);
            this.emitNodeUpdate('create', node);
        }
    }

    /**
     * Agent Creation Complete 이벤트 처리 → Sub-Agent 연결
     */
    private handleAgentCreationComplete(data: ServiceEventData): void {
        // assignTask Tool Call과 Sub-Agent 연결
        this.connectAssignTaskToSubAgent(data);
    }

    /**
     * 기타 이벤트 처리 메서드들
     */
    private handleExecutionComplete(data: ServiceEventData): void {
        this.updateNodeStatus(data.executionId || data.sourceId, 'completed');
    }

    private handleAssistantMessageComplete(data: ServiceEventData): void {
        if (data.sourceType === 'sub-agent') {
            const node = this.createSubResponseNode(data);
            this.emitNodeUpdate('create', node);
        } else {
            const node = this.createFinalResponseNode(data);
            this.emitNodeUpdate('create', node);
        }
    }

    private handleToolCallComplete(data: ServiceEventData): void {
        this.updateNodeStatus(data.executionId || data.sourceId, 'completed');
    }

    private handleAgentCreationStart(data: ServiceEventData): void {
        this.updateNodeStatus(data.sourceId, 'running');
    }

    private handleAgentExecutionStart(data: ServiceEventData): void {
        this.updateNodeStatus(data.sourceId, 'running');
    }

    private handleAgentExecutionComplete(data: ServiceEventData): void {
        this.updateNodeStatus(data.sourceId, 'completed');
    }

    /**
     * Node 생성 메서드들
     */
    private createUserInputNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `user_input_${data.sourceId}`,
            type: 'user_input',
            level: 0,
            status: 'completed',
            data: {
                eventType: 'user.message',
                sourceId: data.sourceId,
                parameters: data.parameters
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createAgentNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `agent_${data.sourceId}`,
            type: 'agent',
            level: 1,
            status: 'running',
            data: {
                eventType: 'execution.start',
                sourceId: data.sourceId,
                executionId: data.executionId
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createSubAgentNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `sub_agent_${data.sourceId}`,
            type: 'sub_agent',
            parentId: data.parentExecutionId,
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'execution.start',
                sourceId: data.sourceId,
                sourceType: 'sub-agent',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createAgentThinkingNode(data: ServiceEventData): WorkflowNode {
        const nodeType: WorkflowNodeType = data.sourceType === 'sub-agent' ? 'agent_thinking' : 'agent_thinking';

        return {
            id: `thinking_${data.sourceId}_${Date.now()}`,
            type: nodeType,
            parentId: data.sourceType === 'sub-agent' ? `sub_agent_${data.sourceId}` : `agent_${data.sourceId}`,
            level: data.executionLevel || (data.sourceType === 'sub-agent' ? 3 : 2),
            status: 'running',
            data: {
                eventType: 'assistant.message_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createAssignTaskCallNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `tool_call_${data.executionId}`,
            type: 'tool_call',
            parentId: `thinking_${data.sourceId}_*`, // 가장 최근 thinking node에 연결
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'tool_call_start',
                toolName: 'assignTask',
                executionId: data.executionId,
                parameters: data.parameters
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createSubToolCallNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `sub_tool_call_${data.executionId}`,
            type: 'sub_tool_call',
            parentId: `thinking_${data.sourceId}_*`, // Sub-Agent thinking에 연결
            level: data.executionLevel || 3,
            status: 'running',
            data: {
                eventType: 'tool_call_start',
                toolName: data.toolName,
                executionId: data.executionId,
                sourceType: 'sub-agent'
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createSubResponseNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `sub_response_${data.sourceId}`,
            type: 'sub_response',
            parentId: `sub_agent_${data.sourceId}`,
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: 'assistant.message_complete',
                sourceId: data.sourceId,
                sourceType: 'sub-agent',
                result: data.result
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    private createFinalResponseNode(data: ServiceEventData): WorkflowNode {
        return {
            id: `final_response_${data.sourceId}`,
            type: 'final_response',
            parentId: `agent_${data.sourceId}`,
            level: data.executionLevel || 2,
            status: 'completed',
            data: {
                eventType: 'assistant.message_complete',
                sourceId: data.sourceId,
                result: data.result
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    /**
     * assignTask Tool Call과 Sub-Agent 연결
     * 핵심: Tool Call → Sub-Agent spawn 연결 생성
     */
    private connectAssignTaskToSubAgent(data: ServiceEventData): void {
        // parentExecutionId는 assignTask tool call ID
        const toolCallNodeId = `tool_call_${data.parentExecutionId}`;
        const subAgentNodeId = `sub_agent_${data.sourceId}`;

        // Tool Call Node에 spawn 연결 추가
        const toolCallNode = this.nodeMap.get(toolCallNodeId);
        if (toolCallNode) {
            toolCallNode.connections.push({
                fromId: toolCallNodeId,
                toId: subAgentNodeId,
                type: 'spawn',
                label: 'creates sub-agent'
            });

            this.emitNodeUpdate('update', toolCallNode);
            this.logger.debug(`Connected assignTask ${toolCallNodeId} → Sub-Agent ${subAgentNodeId}`);
        }
    }

    /**
     * Node 상태 업데이트
     */
    private updateNodeStatus(nodeId: string, status: WorkflowNodeStatus): void {
        // 여러 가능한 Node ID 패턴 확인
        const possibleIds = [
            nodeId,
            `agent_${nodeId}`,
            `sub_agent_${nodeId}`,
            `tool_call_${nodeId}`,
            `sub_tool_call_${nodeId}`
        ];

        for (const id of possibleIds) {
            const node = this.nodeMap.get(id);
            if (node) {
                node.status = status;
                this.emitNodeUpdate('update', node);
                break;
            }
        }
    }

    /**
     * Node Update 이벤트 발생
     */
    private emitNodeUpdate(action: 'create' | 'update' | 'complete' | 'error', node: WorkflowNode): void {
        // Node 캐시에 저장
        this.nodeMap.set(node.id, node);

        const update: WorkflowNodeUpdate = {
            action,
            node
        };

        // 모든 구독자에게 알림
        this.nodeUpdateCallbacks.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error('Error in workflow node update callback:', error);
            }
        });

        this.logger.debug(`WorkflowNode ${action}: ${node.type} (${node.id})`);
    }

    /**
     * 현재 모든 Node 가져오기
     */
    getAllNodes(): WorkflowNode[] {
        return Array.from(this.nodeMap.values());
    }

    /**
     * 특정 Node 가져오기
     */
    getNode(nodeId: string): WorkflowNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    /**
     * Node 연결 관계 가져오기
     */
    getConnections(): WorkflowConnection[] {
        const connections: WorkflowConnection[] = [];

        this.nodeMap.forEach(node => {
            connections.push(...node.connections);
        });

        return connections;
    }

    /**
     * Task Completed 이벤트 처리 → merge_results Node
     */
    private handleTaskCompleted(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing task.completed event`);
        const node = this.createSubResponseNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Aggregation Start 이벤트 처리 → agent_thinking Node
     */
    private handleTaskAggregationStart(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing task.aggregation_start event`);
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Aggregation Complete 이벤트 처리 → merge_results Node
     */
    private handleTaskAggregationComplete(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing task.aggregation_complete event`);
        const node = this.createFinalResponseNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Tool Results to LLM 이벤트 처리 → agent_thinking Node
     */
    private handleToolResultsToLLM(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing tool_results_to_llm event`);
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Assigned 이벤트 처리 → tool_call Node (assignTask 도구 호출)
     */
    private handleTaskAssigned(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing task.assigned event`);
        const node = this.createAssignTaskCallNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Team Analysis Start 이벤트 처리 → agent_thinking Node
     */
    private handleTeamAnalysisStart(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing team.analysis_start event`);
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Team Analysis Complete 이벤트 처리 → merge_results Node
     */
    private handleTeamAnalysisComplete(data: ServiceEventData): void {
        console.log(`🔔 [WorkflowEventSubscriber] Processing team.analysis_complete event`);
        const node = this.createFinalResponseNode(data); // merge_results 역할
        this.emitNodeUpdate('create', node);
    }
}