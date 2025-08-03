/**
 * WorkflowEventSubscriber - 실시간 이벤트 구독 시스템
 * 
 * Purpose: 모든 EventService 이벤트를 실시간으로 구독하여 Workflow Node로 변환
 * Architecture: Observer Pattern으로 이벤트 → Node 변환 처리
 */

import { EventService, ServiceEventType, ServiceEventData, ActionTrackingEventService } from './event-service';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';
import type { WorkflowData } from '../interfaces/workflow-converter';
import { WORKFLOW_NODE_TYPES, WorkflowNodeType, isValidWorkflowNodeType } from '../constants/workflow-node-types';

/**
 * Agent 표준 구성 요소 구조
 */
interface AgentStandardStructure {
    agentId: string;
    thinkingId: string;
    responseId: string;
    agentNumber: number;
    copyNumber: number;
}

/**
 * Agent Copy Manager - 표준 Agent 복사본 생성 및 관리
 */
class AgentCopyManager {
    private copyCounters = new Map<number, number>(); // agentNumber → 복사본 카운터
    private logger: SimpleLogger;

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    /**
     * 새로운 Agent 복사본 구조 생성
     */
    createAgentCopy(agentNumber: number, sourceId: string): AgentStandardStructure {
        const copyNumber = this.getNextCopyNumber(agentNumber);
        const agentId = `agent_${agentNumber}_copy_${copyNumber}`;
        const thinkingId = `thinking_${agentId}`;
        const responseId = `response_${agentId}`;

        this.logger.debug(`🎯 [AGENT-COPY] Created Agent ${agentNumber} Copy ${copyNumber} for sourceId: ${sourceId}`);

        return {
            agentId,
            thinkingId,
            responseId,
            agentNumber,
            copyNumber
        };
    }

    /**
     * 다음 복사본 번호 생성
     */
    private getNextCopyNumber(agentNumber: number): number {
        const current = this.copyCounters.get(agentNumber) || 0;
        const next = current + 1;
        this.copyCounters.set(agentNumber, next);
        return next;
    }

    /**
     * Agent 번호별 복사본 수 조회
     */
    getCopyCount(agentNumber: number): number {
        return this.copyCounters.get(agentNumber) || 0;
    }
}

/**
 * Workflow Node 기본 구조
 */
export interface WorkflowNode extends Record<string, unknown> {
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
 * Node Types는 이제 중앙집중 관리됩니다.
 * @see ../constants/workflow-node-types.ts
 */
// export type WorkflowNodeType - 상수 파일에서 import

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
    | 'calls'             // Agent Thinking → Tool Call (alias for executes)
    | 'creates'           // Tool Call → Agent (Agent 생성)
    | 'branch'            // 병렬 분기 (Thinking → multiple Tool Calls)
    | 'result'            // Tool Call → Merge
    | 'analyze'           // 연쇄 분석 (Merge → next Thinking)
    // 🗑️ Sub-related connection types removed for domain neutrality
    | 'return'            // Response → Integration Instance (결과 반환)
    | 'final'             // 최종 결과 (Response → Output)
    | 'deliver'           // 출력 전달
    // Agent Integration Instance connection types for Playground-level quality
    | 'integrates'        // Response → Agent Integration Instance (결과 통합)
    | 'consolidates'      // Agent Integration Instance → Final Thinking (최종 통합)
    | 'finalizes';        // Final Thinking → Output (최종 완료)

/**
 * Workflow Connection
 */
export interface WorkflowConnection extends Record<string, unknown> {
    fromId: string;
    toId: string;
    type: WorkflowConnectionType;
    label?: string;
}

/**
 * Node Data
 */
export interface WorkflowNodeData extends Record<string, unknown> {
    eventType?: ServiceEventType;
    sourceId?: string;
    sourceType?: string;
    toolName?: string;
    agentTemplate?: string;
    executionId?: string;
    parentExecutionId?: string;
    description?: string; // 빌드 오류 해결을 위해 추가
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
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
    private workflowLogger: SimpleLogger;
    private nodeUpdateCallbacks: ((update: WorkflowNodeUpdate) => void)[] = [];
    private nodeMap = new Map<string, WorkflowNode>(); // Node 캐시
    private agentCounter = 0; // Agent 번호 시스템: Agent 0, Agent 1, Agent 2...
    private agentNumberMap = new Map<string, number>(); // sourceId → Agent 번호 매핑
    private agentNodeIdMap = new Map<string, string>(); // 🔧 sourceId → 실제 생성된 Agent Node ID 매핑
    private agentToThinkingMap = new Map<string, string>(); // 🎯 Agent ID → 가장 최근 Thinking Node ID 매핑

    // 🎯 Agent Copy Manager - 표준 구성 요소 관리
    private agentCopyManager: AgentCopyManager;

    // Agent Integration Instance system for Playground-level connection quality
    private integrationInstanceMap = new Map<string, string>(); // rootExecutionId → Agent Integration Instance ID
    private responseIntegrationQueue = new Map<string, string[]>(); // rootExecutionId → pending response IDs

    // 🎯 Tool Call Response 추적 (executionId/sourceId -> tool response node IDs)
    private toolResponsesByExecution = new Map<string, string[]>();

    // ExecutionId-based mapping system for wildcard elimination (핵심 연결 문제 해결)
    private executionToThinkingMap = new Map<string, string>(); // executionId → thinking node ID

    constructor(logger?: SimpleLogger) {
        super(); // ActionTrackingEventService 생성자와 호환 (baseEventService 기본값 사용)
        this.workflowLogger = logger || SilentLogger;
        this.agentCopyManager = new AgentCopyManager(this.workflowLogger);
        this.workflowLogger.info('🏗️ [WorkflowEventSubscriber] Constructor called - Instance created');
        this.workflowLogger.debug('WorkflowEventSubscriber initialized');
    }

    /**
     * Workflow Node 업데이트 구독
     */
    subscribeToWorkflowEvents(callback: (nodeUpdate: WorkflowNodeUpdate) => void): void {
        this.nodeUpdateCallbacks.push(callback);
        this.workflowLogger.debug('New workflow event subscriber registered');
    }

    /**
     * 이벤트 구독 해제
     */
    unsubscribe(callback: (nodeUpdate: WorkflowNodeUpdate) => void): void {
        const index = this.nodeUpdateCallbacks.indexOf(callback);
        if (index !== -1) {
            this.nodeUpdateCallbacks.splice(index, 1);
            this.workflowLogger.debug('Workflow event subscriber removed');
        }
    }

    /**
     * emit 메서드 오버라이드하여 이벤트 모니터링
     * 모든 이벤트가 이 메서드를 통과하므로 여기서 Node 생성 처리
     * 비동기 처리로 이벤트 블로킹 방지
     */
    public override emit(eventType: ServiceEventType, data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Received event: ${eventType}`, {
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            executionId: data.executionId
        });

        // 부모 클래스의 emit 호출 (hierarchy 추적 등)
        super.emit(eventType, data);

        // 이벤트 타입별 Node 생성 처리를 비동기로 실행
        // setTimeout을 사용하여 이벤트 루프를 블로킹하지 않도록 함
        setTimeout(() => {
            try {
                this.handleEventForWorkflow(eventType, data);
            } catch (error) {
                this.workflowLogger.error(`Error handling workflow event ${eventType}:`, error);
            }
        }, 0);
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
            // Agent Integration Instance events for Playground-level connection quality
            case 'agent.integration_start':
                this.handleAgentIntegrationStart(data);
                break;
            case 'agent.integration_complete':
                this.handleAgentIntegrationComplete(data);
                break;
            case 'response.integration':
                this.handleResponseIntegration(data);
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
            // 🗑️ subtool events removed - unified into standard tool_call events
        }
    }

    /**
     * User Message 이벤트 처리 → user_input Node + 연결 생성
     */
    private handleUserMessage(data: ServiceEventData): void {
        const node = this.createUserInputNode(data);
        this.emitNodeUpdate('create', node);

        // 🎯 User Input → 첫 번째 Agent/Team 연결 생성 (비동기로 처리)
        this.scheduleUserInputConnection(node.id, String(data.sourceId));
    }

    /**
     * Execution Start 이벤트 처리 → agent Node 또는 sub_agent Node
     */
    private handleExecutionStart(data: ServiceEventData): void {
        // 🎯 Sub-Agent 개념 제거: 모든 Agent를 동등하게 처리
        const node = this.createAgentNode(data);
        this.emitNodeUpdate('create', node);

        // 🔧 Team 모드에서 Agent 번호 시스템 지원
        // assignTask로 생성된 Agent들을 위한 기본 매핑 추가
        if (data.sourceType === 'team' && data.sourceId) {
            const agentNumber = this.assignAgentNumber(String(data.sourceId));
            this.workflowLogger.debug(`🎯 [TEAM-AGENT-MAPPING] Team mode Agent ${agentNumber} created: ${data.sourceId} → ${node.id}`);
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
     * Tool Call Start 이벤트 처리 → tool_call Node (도메인 중립적)
     */
    private handleToolCallStart(data: ServiceEventData): void {
        // 🎯 도메인 중립적 처리: 모든 tool을 동등하게 처리
        const node = this.createUniversalToolCallNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Agent Creation Complete 이벤트 처리 → 도메인 중립적
     */
    private handleAgentCreationComplete(data: ServiceEventData): void {
        // 🎯 도메인 중립적: 모든 Agent 생성을 동등하게 처리
        this.connectToolCallToAgent(data);
    }

    /**
     * 기타 이벤트 처리 메서드들
     */
    private handleExecutionComplete(data: ServiceEventData): void {
        const nodeId = String(data.executionId || data.sourceId || 'unknown');
        this.updateNodeStatus(nodeId, 'completed');
    }

    private handleAssistantMessageComplete(data: ServiceEventData): void {
        // 🎯 모든 응답은 도메인 중립적 response 타입으로 통일
        // Agent, sub-agent, team 모든 sourceType을 동일하게 처리
        const node = this.createAgentResponseNode(data);
        this.emitNodeUpdate('create', node);
    }

    private handleToolCallComplete(data: ServiceEventData): void {
        // 🎯 Tool Call 완료 시 Tool Call Response 노드 생성
        const responseNode = this.createToolCallResponseNode(data);
        this.emitNodeUpdate('create', responseNode);

        // Tool Response 추적 - 나중에 merge results와 연결하기 위해
        const key = String(data.rootExecutionId || data.sourceId || data.executionId || 'unknown');
        if (key && key !== 'unknown') {
            const existing = this.toolResponsesByExecution.get(key) || [];
            existing.push(responseNode.id);
            this.toolResponsesByExecution.set(key, existing);

            this.workflowLogger.debug(`🎯 [TOOL-RESPONSE-TRACKING] Tracked tool response: ${responseNode.id} for execution: ${key}`);
        }

        // 기존 Tool Call 노드 상태도 업데이트
        const nodeId = String(data.executionId || data.sourceId || 'unknown');
        this.updateNodeStatus(nodeId, 'completed');
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
            type: WORKFLOW_NODE_TYPES.USER_INPUT,
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
        // 🎯 Agent 표준 구성: 복사본만 생성 (원본 제거)
        const agentNumber = this.assignAgentNumber(String(data.sourceId || 'unknown'));
        const agentStructure = this.agentCopyManager.createAgentCopy(agentNumber, String(data.sourceId));

        // 🔧 Agent Copy ID → sourceId 역방향 매핑 저장
        this.agentNodeIdMap.set(String(data.sourceId), agentStructure.agentId);

        this.workflowLogger.debug(`🎯 [AGENT-COPY] Created Agent ${agentNumber} Copy ${agentStructure.copyNumber} for sourceId: ${data.sourceId}`);
        this.workflowLogger.debug(`🔧 [AGENT-ID-MAPPING] Stored mapping: ${data.sourceId} → ${agentStructure.agentId}`);

        return {
            id: agentStructure.agentId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: agentNumber === 0 ? 1 : 4,
            status: 'running',
            data: {
                eventType: 'execution.start',
                sourceId: String(data.sourceId || 'unknown'),
                executionId: String(data.executionId || 'unknown'),
                agentNumber: agentNumber,
                copyNumber: agentStructure.copyNumber,
                label: `Agent ${agentNumber} Copy ${agentStructure.copyNumber}`,
                // 🎯 표준 구성 요소 미리 예약
                reservedThinkingId: agentStructure.thinkingId,
                reservedResponseId: agentStructure.responseId
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    /**
     * 🎯 Agent 번호 할당 시스템
     */
    private assignAgentNumber(sourceId: string): number {
        // 이미 할당된 번호가 있으면 반환
        if (this.agentNumberMap.has(sourceId)) {
            return this.agentNumberMap.get(sourceId)!;
        }

        // 새로운 Agent 번호 할당
        const agentNumber = this.agentCounter;
        this.agentNumberMap.set(sourceId, agentNumber);
        this.agentCounter++;

        this.workflowLogger.info(`🎯 [AGENT-NUMBERING] Assigned Agent ${agentNumber} to sourceId: ${sourceId}`);
        return agentNumber;
    }

    // 🎯 createSubAgentNode 제거: createAgentNode로 통합됨

    private createAgentThinkingNode(data: ServiceEventData): WorkflowNode {
        // 🎯 표준 구성: Agent Copy의 예약된 Thinking ID 사용
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;

        if (!agentNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No agent copy found for sourceId: ${data.sourceId}`);
        }

        // 🎯 Agent 노드에서 예약된 Thinking ID 가져오기
        const agentNode = this.nodeMap.get(agentNodeId);
        const reservedThinkingId = agentNode?.data?.reservedThinkingId as string;

        if (!reservedThinkingId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No reserved thinking ID found for agent: ${agentNodeId}`);
        }

        // 🎯 핵심: Agent ID → Thinking Node ID 매핑 저장
        this.agentToThinkingMap.set(String(data.sourceId), reservedThinkingId);

        this.workflowLogger.debug(`🎯 [STANDARD-STRUCTURE] Agent ${data.sourceId} → Reserved Thinking ${reservedThinkingId}`);
        this.workflowLogger.debug(`🔧 [AGENT-COPY] Using Agent Copy ID: ${agentNodeId}`);

        // 🎯 Agent → Thinking 연결 생성 (표준 룰 1: Agent → Thinking)
        const connections: WorkflowConnection[] = [];

        // Agent 노드가 존재하므로 항상 연결 생성
        connections.push({
            fromId: agentNodeId,
            toId: reservedThinkingId,
            type: 'processes' as const,
            label: `Agent ${agentNumber} processes`
        });

        this.workflowLogger.debug(`✅ [STANDARD-RULE-1] Agent → Thinking 연결 생성: ${agentNodeId} → ${reservedThinkingId}`)

        return {
            id: reservedThinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            parentId: agentNodeId,
            level: agentNumber === 0 ? 2 : 5, // Agent 0 thinking = level 2, 위임 Agent thinking = level 5
            status: 'running',
            data: {
                eventType: 'assistant.message_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Thinking`
            },
            timestamp: data.timestamp || new Date(),
            connections: connections
        };
    }

    /**
     * 🎯 도메인 중립적 Tool Call Node 생성
     * 모든 tool을 동등하게 처리 (assignTask 특화 제거)
     */
    private createUniversalToolCallNode(data: ServiceEventData): WorkflowNode {
        // 🎯 Direct parent ID provision (no mapping/inference needed)
        const directParentId = data.metadata?.directParentId as string;
        const toolCallId = data.metadata?.toolCallId as string;

        if (!directParentId) {
            throw new Error(`❌ [DIRECT-MAPPING] No directParentId provided in tool_call_start event`);
        }

        // 🔧 Tool Call ID 생성 (undefined 방지)
        const finalToolCallId = data.executionId || toolCallId || `generated_${Date.now()}`;

        this.workflowLogger.debug(`🎯 [DIRECT-MAPPING] Tool Call ${finalToolCallId} → Thinking ${directParentId} 직접 제공됨 (추론 없음)`);

        return {
            id: `tool_call_${finalToolCallId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            parentId: directParentId, // 🚀 직접 제공된 Parent ID 사용 (추론 없음)
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'tool_call_start',
                toolName: String(data.toolName || 'unknown_tool'), // 🎯 동적 tool 이름
                executionId: String(data.executionId || 'unknown'),
                parameters: data.parameters
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    // 🗑️ createSubToolCallNode removed - unified into createUniversalToolCallNode for domain neutrality

    private createAgentResponseNode(data: ServiceEventData): WorkflowNode {
        // 🎯 표준 구성: Agent Copy의 예약된 Response ID 사용
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;

        if (!agentNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No agent copy found for sourceId: ${data.sourceId}`);
        }

        // 🎯 Agent 노드에서 예약된 Response ID 가져오기
        const agentNode = this.nodeMap.get(agentNodeId);
        const reservedResponseId = agentNode?.data?.reservedResponseId as string;

        if (!reservedResponseId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No reserved response ID found for agent: ${agentNodeId}`);
        }

        // 🎯 정석적 방법: 매핑에서 정확한 Thinking Node ID 가져오기
        const thinkingNodeId = this.agentToThinkingMap.get(String(data.sourceId));

        if (!thinkingNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No thinking node found for Agent ${data.sourceId}`);
        }

        this.workflowLogger.debug(`🎯 [STANDARD-STRUCTURE] Agent ${data.sourceId} → Reserved Response ${reservedResponseId}, Thinking: ${thinkingNodeId}`);

        // 🎯 Thinking → Response 연결 생성 (표준 룰 4: Thinking → Response)
        const connections: WorkflowConnection[] = [];
        connections.push({
            fromId: thinkingNodeId,
            toId: reservedResponseId,
            type: 'return' as const,
            label: `Agent ${agentNumber} result`
        });

        this.workflowLogger.debug(`✅ [STANDARD-RULE-4] Thinking → Response 연결 생성: ${thinkingNodeId} → ${reservedResponseId}`);

        return {
            id: reservedResponseId,
            type: WORKFLOW_NODE_TYPES.RESPONSE, // 🎯 상수 사용으로 도메인 중립성 보장
            parentId: agentNodeId, // 🎯 표준 구성: Agent Copy ID 사용
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: 'assistant.message_complete',
                sourceId: data.sourceId,
                sourceType: 'agent',
                result: data.result,
                agentNumber: agentNumber,
                label: `Response ${agentNumber}`
            },
            timestamp: data.timestamp || new Date(),
            connections: connections
        };
    }

    private createMergeResultsNode(data: ServiceEventData): WorkflowNode {
        // Generate a unique ID for merge results if executionId is missing
        const mergeResultsId = data.executionId ||
            data.metadata?.executionId ||
            `${data.sourceId}_${Date.now()}`;

        const nodeId = `merge_results_${mergeResultsId}`;
        const connections: WorkflowConnection[] = [];

        // 🎯 Tool Response들과 연결 (당신의 아이디어 구현)
        const key = String(data.rootExecutionId || data.sourceId || data.executionId || 'unknown');
        const toolResponses = this.toolResponsesByExecution.get(key) || [];

        this.workflowLogger.debug(`🎯 [MERGE-RESULTS] Creating merge results node with ${toolResponses.length} tool responses`);

        // 각 Tool Response와 연결
        toolResponses.forEach(toolResponseId => {
            connections.push({
                fromId: toolResponseId,
                toId: nodeId,
                type: 'consolidates',
                label: 'merge tool results'
            });
        });

        // Tool Response가 없을 경우에만 agent와 직접 연결 (fallback)
        if (toolResponses.length === 0) {
            const actualSourceId = this.agentNodeIdMap.get(data.sourceId) || data.sourceId;
            if (this.nodeExists(actualSourceId)) {
                connections.push({
                    fromId: actualSourceId,
                    toId: nodeId,
                    type: 'consolidates',
                    label: 'merge results'
                });
            }
        }

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.MERGE_RESULTS,
            parentId: undefined, // Tool responses가 parent이므로 parentId는 필요없음
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'task.aggregation_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                connectedToolResponses: toolResponses
            },
            timestamp: data.timestamp || new Date(),
            connections: connections
        };
    }

    /**
     * Check if a node exists in the workflow
     */
    private nodeExists(nodeId: string): boolean {
        // Check in the current workflow state through event emission
        // For now, we'll assume the node exists if it's in our agentNodeIdMap
        return this.agentNodeIdMap.has(nodeId) ||
            nodeId.startsWith('agent_') ||
            nodeId.startsWith('tool_response_');
    }

    /**
     * 🎯 Tool Call Response Node 생성
     * Tool 실행 완료 후 결과를 담는 응답 노드
     */
    private createToolCallResponseNode(data: ServiceEventData): WorkflowNode {
        // 🔧 ExecutionId undefined 방지
        const finalExecutionId = data.executionId || data.metadata?.executionId || `generated_${Date.now()}`;

        return {
            id: `tool_response_${finalExecutionId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE,
            parentId: `tool_call_${finalExecutionId}`, // Tool Call과 연결
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: 'tool_call_complete',
                sourceId: data.sourceId,
                executionId: String(finalExecutionId),
                result: data.result,
                toolName: String(data.toolName || 'unknown_tool')
            },
            timestamp: data.timestamp || new Date(),
            connections: [{
                fromId: `tool_call_${finalExecutionId}`,
                toId: `tool_response_${finalExecutionId}`,
                type: 'result' as const,
                label: 'tool result'
            }]
        };
    }



    /**
     * 🎯 도메인 중립적 Tool Call과 Agent 연결
     * 모든 tool call → agent 생성을 동등하게 처리
     */
    private connectToolCallToAgent(data: ServiceEventData): void {
        // parentExecutionId는 tool call ID
        const toolCallNodeId = `tool_call_${data.parentExecutionId}`;
        const agentNodeId = `agent_${data.sourceId}`;

        // Tool Call Node에 연결 추가
        const toolCallNode = this.nodeMap.get(toolCallNodeId);
        if (toolCallNode) {
            toolCallNode.connections.push({
                fromId: toolCallNodeId,
                toId: agentNodeId,
                type: 'creates',
                label: 'creates agent'
            });

            this.emitNodeUpdate('update', toolCallNode);
            this.workflowLogger.debug(`Connected tool call ${toolCallNodeId} → Agent ${agentNodeId}`);
        }
    }

    /**
     * Node 상태 업데이트
     */
    private updateNodeStatus(nodeId: string, status: WorkflowNodeStatus): void {
        // 🗑️ Sub-related ID patterns removed - domain neutral patterns only
        const possibleIds = [
            nodeId,
            `agent_${nodeId}`,
            `tool_call_${nodeId}`
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
                this.workflowLogger.error('Error in workflow node update callback:', error);
            }
        });

        this.workflowLogger.debug(`WorkflowNode ${action}: ${node.type} (${node.id})`);
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
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing task.completed event`);
        const node = this.createMergeResultsNode(data); // 🎯 Task 완료는 merge_results Node
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Aggregation Start 이벤트 처리 → merge_results Node
     */
    private handleTaskAggregationStart(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing task.aggregation_start event`);
        const node = this.createMergeResultsNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Aggregation Complete 이벤트 처리 → merge_results Node
     */
    private handleTaskAggregationComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing task.aggregation_complete event`);
        const node = this.createMergeResultsNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Tool Results to LLM 이벤트 처리 → agent_thinking Node
     */
    private handleToolResultsToLLM(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing tool_results_to_llm event`);
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Task Assigned 이벤트 처리 → tool_call Node (범용 도구 호출)
     */
    private handleTaskAssigned(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing task.assigned event`);
        const node = this.createUniversalToolCallNode(data); // createAssignTaskCallNode → createUniversalToolCallNode
        this.emitNodeUpdate('create', node);
    }

    /**
     * Team Analysis Start 이벤트 처리 → agent_thinking Node
     */
    private handleTeamAnalysisStart(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing team.analysis_start event`);
        const node = this.createAgentThinkingNode(data);
        this.emitNodeUpdate('create', node);
    }

    // ===== 🎯 Agent Integration Instance System (Playground-level connection quality) =====

    /**
     * Agent Integration Instance 시작 이벤트 처리
     * 여러 Response를 통합할 전용 Agent 인스턴스 생성
     */
    private handleAgentIntegrationStart(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing agent.integration_start event`);
        const node = this.createAgentIntegrationInstance(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Agent Integration Instance 완료 이벤트 처리
     * 최종 통합 Thinking Node 생성 및 연결
     */
    private handleAgentIntegrationComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing agent.integration_complete event`);
        const node = this.createFinalIntegrationThinking(data);
        this.emitNodeUpdate('create', node);
    }

    /**
     * Response 통합 이벤트 처리  
     * Response → Agent Integration Instance 연결 생성
     */
    private handleResponseIntegration(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing response.integration event`);
        this.connectResponseToIntegrationInstance(data);
    }

    /**
     * Agent Integration Instance Node 생성
     * 도메인 중립적 결과 통합 전용 Agent 인스턴스
     */
    private createAgentIntegrationInstance(data: ServiceEventData): WorkflowNode {
        const integrationInstanceId = `agent_integration_${data.integrationId || Date.now()}`;
        const rootId = data.rootExecutionId || data.sourceId;

        // Integration Instance ID 매핑 저장
        this.integrationInstanceMap.set(rootId, integrationInstanceId);

        this.workflowLogger.debug(`🎯 [INTEGRATION] Created Agent Integration Instance: ${integrationInstanceId}`);

        return {
            id: integrationInstanceId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            parentId: undefined, // 최상위 통합 인스턴스
            level: 3, // Integration Instance level
            status: 'running',
            data: {
                eventType: 'agent.integration_start',
                sourceId: data.sourceId,
                sourceType: 'agent',
                integrationId: data.integrationId,
                label: 'Agent Integration Instance', // 도메인 중립적 명명
                description: 'Dedicated instance for response integration and final processing'
            },
            timestamp: data.timestamp || new Date(),
            connections: []
        };
    }

    /**
     * 최종 통합 Thinking Node 생성
     * Agent Integration Instance의 최종 처리 단계
     */
    private createFinalIntegrationThinking(data: ServiceEventData): WorkflowNode {
        const rootId = data.rootExecutionId || data.sourceId;
        const integrationInstanceId = this.integrationInstanceMap.get(rootId);
        const finalThinkingId = `thinking_integration_final_${Date.now()}`;

        // Agent Integration Instance → Final Thinking 연결
        const connections: WorkflowConnection[] = [];
        if (integrationInstanceId) {
            connections.push({
                fromId: integrationInstanceId,
                toId: finalThinkingId,
                type: 'consolidates',
                label: 'Final integration processing'
            });
        }

        this.workflowLogger.debug(`🎯 [INTEGRATION] Created Final Integration Thinking: ${finalThinkingId}`);

        return {
            id: finalThinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            parentId: integrationInstanceId,
            level: 4, // Final integration thinking level
            status: 'running',
            data: {
                eventType: 'agent.integration_complete',
                sourceId: data.sourceId,
                sourceType: 'agent',
                integrationId: data.integrationId,
                label: 'Final Integration Thinking',
                description: 'Final processing and result consolidation'
            },
            timestamp: data.timestamp || new Date(),
            connections: connections
        };
    }

    /**
     * Response를 Agent Integration Instance로 연결
     * 교차 연결 방지를 위한 핵심 로직
     */
    private connectResponseToIntegrationInstance(data: ServiceEventData): void {
        const rootId = data.rootExecutionId || data.sourceId;
        const integrationInstanceId = this.integrationInstanceMap.get(rootId);

        if (!integrationInstanceId) {
            this.workflowLogger.warn(`🚨 [INTEGRATION] No integration instance found for root: ${rootId}`);
            return;
        }

        // Response IDs 처리
        const responseIds = data.sourceResponseIds || [data.sourceId];

        responseIds.forEach(responseId => {
            const responseNode = this.nodeMap.get(responseId);
            if (responseNode) {
                // Response → Agent Integration Instance 연결 추가
                responseNode.connections.push({
                    fromId: responseId,
                    toId: integrationInstanceId,
                    type: 'integrates',
                    label: 'Integration into final processing'
                });

                this.emitNodeUpdate('update', responseNode);
                this.workflowLogger.debug(`🎯 [INTEGRATION] Connected Response ${responseId} → Integration Instance ${integrationInstanceId}`);
            }
        });
    }

    /**
     * Team Analysis Complete 이벤트 처리 → 도메인 중립적 response Node
     */
    private handleTeamAnalysisComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing team.analysis_complete event`);
        // 🎯 도메인 중립성: Team 분석 완료도 동일한 response 타입으로 처리
        const node = this.createAgentResponseNode(data);
        this.emitNodeUpdate('create', node);
    }

    // ================================
    // 🔗 User Input Connection Management
    // ================================

    /**
     * User Input 연결을 지연 처리하여 첫 번째 Agent/Team 노드와 연결
     */
    private scheduleUserInputConnection(userInputId: string, sourceId: string): void {
        // 짧은 지연 후 연결 처리 (Agent/Team 노드가 생성될 시간 확보)
        setTimeout(() => {
            this.createUserInputConnection(userInputId, sourceId);
        }, 100);
    }

    /**
     * User Input → Agent/Team 연결 생성
     */
    private createUserInputConnection(userInputId: string, sourceId: string): void {
        // 🎯 Team 모드 우선 처리 (Team 환경에서 연결 실패 방지)
        // 1. Team 노드 찾기 (Team 모드인 경우)  
        const teamNodes = Array.from(this.nodeMap.values()).filter(n =>
            (n.data?.label && typeof n.data.label === 'string' && n.data.label.toLowerCase().includes('team')) ||
            (typeof n.type === 'string' && n.type.toLowerCase().includes('team')));

        if (teamNodes.length > 0) {
            const teamNode = teamNodes[0]; // 첫 번째 Team 노드
            const userInputNode = this.nodeMap.get(userInputId);
            if (userInputNode) {
                const connection: WorkflowConnection = {
                    fromId: userInputId,
                    toId: teamNode.id,
                    type: 'receives' as const,
                    label: 'User input to team'
                };

                userInputNode.connections.push(connection);
                this.workflowLogger.debug(`🔗 [USER-INPUT-CONNECTION] Team mode: ${userInputId} → ${teamNode.id} (receives)`);
                this.emitNodeUpdate('update', userInputNode);
                return;
            }
        }

        // 2. Agent Copy 시스템에서 해당 sourceId의 Agent 노드 찾기 (Agent 모드)
        const agentNodeId = this.agentNodeIdMap.get(sourceId);

        if (agentNodeId && this.nodeMap.has(agentNodeId)) {
            // Agent 모드: User Input → Agent Copy 연결
            const userInputNode = this.nodeMap.get(userInputId);
            if (userInputNode) {
                const connection: WorkflowConnection = {
                    fromId: userInputId,
                    toId: agentNodeId,
                    type: 'receives' as const,
                    label: 'User input received'
                };

                userInputNode.connections.push(connection);
                this.workflowLogger.debug(`🔗 [USER-INPUT-CONNECTION] Agent mode: ${userInputId} → ${agentNodeId} (receives)`);
                this.emitNodeUpdate('update', userInputNode);
                return;
            }
        }

        // 3. 연결할 대상이 없는 경우 경고
        this.workflowLogger.debug(`⚠️ [USER-INPUT-CONNECTION] No target found for User Input: ${userInputId} (checked Team and Agent modes)`);
    }
}