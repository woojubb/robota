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
import type { UniversalWorkflowEdge } from './workflow-converter/universal-types';
import { NodeEdgeManager } from './node-edge-manager';

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
    timestamp: number; // Creation timestamp for sequential order validation
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
    | 'continues'         // Agent Thinking → Agent Thinking (thinking 연속)
    | 'executes'          // Agent Thinking → Tool Call
    | 'calls'             // Agent Thinking → Tool Call (alias for executes)
    | 'creates'           // Tool Call → Agent (Agent 생성)
    | 'triggers'          // Tool Call Response → User Message (메시지 트리거)
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
    private nodeMap = new Map<string, WorkflowNode>(); // Node 캐시 (기존 호환성)
    private edges: UniversalWorkflowEdge[] = []; // 🎯 직접 edges 배열 관리 (기존 호환성)

    // 🔒 NodeEdgeManager: 순서 보장 및 무결성 관리
    private nodeEdgeManager: NodeEdgeManager;
    private agentRound1ThinkingMap = new Map<string, string>(); // sourceId -> round1ThinkingId
    private agentCounter = 0; // Agent 번호 시스템: Agent 0, Agent 1, Agent 2...
    private agentNumberMap = new Map<string, number>(); // sourceId → Agent 번호 매핑
    private agentNodeIdMap = new Map<string, string>(); // 🔧 sourceId → 실제 생성된 Agent Node ID 매핑
    private agentToThinkingMap = new Map<string, string>(); // 🎯 Agent ID → 가장 최근 Thinking Node ID 매핑
    private agentToToolResultNodeMap = new Map<string, string>(); // 🎯 Agent ID → 해당 Agent가 시작한 Tool Result Node ID 매핑
    private thinkingToToolResultMap = new Map<string, string>(); // 🎯 Thinking Node ID(Fork) → Tool Result Node ID(Join) 매핑
    private toolCallToThinkingMap = new Map<string, string>(); // 🎯 Tool Call ID -> Thinking Node ID 매핑

    // 🎯 Agent Copy Manager - 표준 구성 요소 관리
    private agentCopyManager: AgentCopyManager;

    // Agent Integration Instance system for Playground-level connection quality
    private integrationInstanceMap = new Map<string, string>(); // rootExecutionId → Agent Integration Instance ID
    private responseIntegrationQueue = new Map<string, string[]>(); // rootExecutionId → pending response IDs

    // 🎯 Tool Call Response 추적 (executionId/sourceId -> tool response node IDs)
    private toolResponsesByExecution = new Map<string, string[]>();

    // 🎯 올바른 워크플로우 구조를 위한 매핑 시스템
    private toolCallToAgentMap = new Map<string, string>(); // tool call ID → created agent ID
    private agentToResponseMap = new Map<string, string>(); // agent ID → response node ID
    private agentZeroToolCalls = new Map<string, string[]>(); // agent 0 sourceId → tool call IDs
    private conversationIdToAgentIdMap = new Map<string, string>(); // conversationId(conv_...) → agentId(agent-...) 매핑

    // ExecutionId-based mapping system for wildcard elimination (핵심 연결 문제 해결)
    private executionToThinkingMap = new Map<string, string>(); // executionId → thinking node ID

    // 🎯 Fork Pattern 순차 처리 시스템 (Rule 11 Sequential Order 준수)
    private pendingForkEdges = new Map<string, Array<{ fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string }>>(); // thinking node ID → pending edges
    private forkCompletionTimers = new Map<string, NodeJS.Timeout>(); // thinking node ID → completion timer

    // [RACE-CONDITION-FIX] 경쟁 상태 해결을 위한 큐
    private pendingThinkingEvents = new Map<string, ServiceEventData>(); // key: previousThinkingNodeId

    constructor(logger?: SimpleLogger) {
        super(); // ActionTrackingEventService 생성자와 호환 (baseEventService 기본값 사용)
        this.workflowLogger = logger || SilentLogger;
        this.agentCopyManager = new AgentCopyManager(this.workflowLogger);

        // 🔒 NodeEdgeManager 초기화: 순서 보장 및 무결성 관리
        this.nodeEdgeManager = new NodeEdgeManager(this.workflowLogger);

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
        setTimeout(async () => {
            try {
                await this.handleEventForWorkflow(eventType, data);
            } catch (error) {
                this.workflowLogger.error(`Error handling workflow event ${eventType}:`, error);
            }
        }, 0);
    }

    /**
     * 이벤트를 Workflow Node로 변환
     */
    private async handleEventForWorkflow(eventType: ServiceEventType, data: ServiceEventData): Promise<void> {
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

            case 'task.assigned':
                this.handleTaskAssigned(data);
                break;
            case 'team.analysis_start':
                this.handleTeamAnalysisStart(data);
                break;
            case 'team.analysis_complete':
                this.handleTeamAnalysisComplete(data);
                break;
            case 'task.aggregation_start':
                this.handleToolResultAggregationStart(data);
                break;
            case 'task.aggregation_complete':
                await this.handleToolResultAggregationComplete(data);
                break;
            // 🗑️ subtool events removed - unified into standard tool_call events for domain neutrality
        }
    }

    /**
     * User Message 이벤트 처리 → user_message Node 생성 및 agent 연결
     */
    private handleUserMessage(data: ServiceEventData): void {
        const userMessageNode = this.createUserMessageNode(data);
        this.emitNodeUpdate('create', userMessageNode);

        // 🎯 [CONNECTION-FIX] agent -> user_message 연결만 처리
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        if (agentNodeId) {
            const agentNode = this.nodeMap.get(agentNodeId);
            if (agentNode) {
                this.connectNodes(agentNode, userMessageNode, 'receives', 'receives input');
                this.workflowLogger.info(`🔗 [USER-MESSAGE] Connected ${agentNodeId} → ${userMessageNode.id}`);
            } else {
                this.workflowLogger.error(`❌ [MISSING-AGENT-NODE] Agent node ${agentNodeId} not found in nodeMap for sourceId ${data.sourceId}`);
            }
        } else {
            this.workflowLogger.error(`❌ [NO-AGENT-MAPPING] No agent mapping found for sourceId ${data.sourceId}`);
        }
    }


    /**
     * Execution Start 이벤트 처리 → agent Node 생성 및 연결
     */
    private handleExecutionStart(data: ServiceEventData): void {
        // 🎯 [DUPLICATE-PREVENTION] 기존 agent node가 있으면 재사용, 없으면 생성
        const existingAgentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        let node: WorkflowNode;

        if (existingAgentNodeId) {
            // 기존 agent node 재사용
            const existingNode = this.nodeMap.get(existingAgentNodeId);
            if (!existingNode) {
                // nodeMap에서 찾을 수 없으면 새로 생성
                node = this.createAgentNode(data);
                this.emitNodeUpdate('create', node);
                this.workflowLogger.info(`🔄 [AGENT-RECREATION] Recreated missing agent ${node.id} for sourceId ${data.sourceId}`);
            } else {
                node = existingNode;
                this.workflowLogger.info(`♻️ [AGENT-REUSE] Reusing existing agent ${node.id} for sourceId ${data.sourceId}`);
            }
        } else {
            // 새로운 agent node 생성
            node = this.createAgentNode(data);
            this.emitNodeUpdate('create', node);
            this.workflowLogger.info(`🆕 [AGENT-CREATE] Created new agent ${node.id} for sourceId ${data.sourceId}`);
        }

        // 🎯 [CONNECTION-FIX] parentNodeId가 있으면 부모 tool_call 노드와 연결
        if (data.parentNodeId) {
            const parentNode = this.nodeMap.get(String(data.parentNodeId));
            if (parentNode) {
                this.connectNodes(parentNode, node, 'creates', 'creates agent');
                this.workflowLogger.info(`🔗 [AGENT-CREATION] Connected ${parentNode.id} → ${node.id}`);
            } else {
                this.workflowLogger.error(`❌ [MISSING-PARENT] Parent node ${data.parentNodeId} not found for agent ${node.id}`);
            }
        } else {
            this.workflowLogger.info(`🎯 [ROOT-AGENT] Agent ${node.id} created without parent (root agent)`);
        }
    }


    /**
     * Assistant Message Start 이벤트 처리 → agent_thinking Node 생성 및 user_message 연결
     */
    private handleAssistantMessageStart(data: ServiceEventData): void {
        const node = this.createAgentThinkingNode(data);
        if (node) {
            this.emitNodeUpdate('create', node);

            // 🎯 [DIRECT-EDGES] 연결 로직을 직접 edges 시스템으로 처리
            const round = (data.parameters as any)?.round || 1;
            const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));

            if (round > 1) {
                // Round 2+: tool_result -> thinking 연결
                // 🎯 [FIX] Round 1 thinking node ID를 별도 맵에서 정확히 찾기
                const round1ThinkingNodeId = this.agentRound1ThinkingMap.get(String(data.sourceId));

                this.workflowLogger.debug(`🔍 [ROUND2-FIX] Looking for Round 1 thinking: ${round1ThinkingNodeId} for sourceId: ${data.sourceId} Round ${round} connection`);

                if (round1ThinkingNodeId) {
                    const toolResultNodeId = this.thinkingToToolResultMap.get(round1ThinkingNodeId);
                    this.workflowLogger.debug(`🔍 [ROUND2-FIX] Tool result node ID: ${toolResultNodeId} for Round 1 thinking: ${round1ThinkingNodeId}`);

                    if (toolResultNodeId) {
                        const toolResultNode = this.nodeMap.get(toolResultNodeId);
                        this.workflowLogger.debug(`🔍 [ROUND2-FIX] Tool result node exists: ${!!toolResultNode}, status: ${toolResultNode?.status}`);

                        if (toolResultNode) {
                            // tool_result -> round 2+ thinking 연결
                            this.connectNodes(toolResultNode, node, 'analyze', 'analyzes results');
                            this.workflowLogger.debug(`✅ [FORK-JOIN] Round ${round} thinking connected to Join Point ${toolResultNodeId} (status: ${toolResultNode.status})`);

                            // Round 1 thinking의 매핑은 유지 (다른 round에서 사용할 수 있음)
                            this.workflowLogger.debug(`🔧 [FORK-JOIN] Keeping map entry for Round 1 thinking: ${round1ThinkingNodeId}`);
                        } else {
                            this.workflowLogger.warn(`⚠️ [ROUND2-FIX] Tool result node not found in nodeMap: ${toolResultNodeId}`);
                        }
                    } else {
                        this.workflowLogger.warn(`⚠️ [ROUND2-FIX] No tool result node ID found for Round 1 thinking: ${round1ThinkingNodeId}`);
                    }
                } else {
                    this.workflowLogger.warn(`⚠️ [ROUND2-FIX] No Round 1 thinking node found for sourceId: ${data.sourceId}`);
                }
            }

            // 🎯 [SINGLE-CONNECTION] Round 1에서만 User Message 연결, Round 2+는 tool_result만 연결
            if (round === 1) {
                const userMessageNodeId = `user_message_${data.sourceId}`;
                const userMessageNode = this.nodeMap.get(userMessageNodeId);
                if (userMessageNode) {
                    this.connectNodes(userMessageNode, node, 'processes', 'triggers thinking');
                }
            }
        }
    }


    /**
     * Tool Call Start 이벤트 처리 → tool_call Node 생성 및 thinking 연결
     */
    private handleToolCallStart(data: ServiceEventData): void {
        const sourceAgent = String(data.sourceId || 'unknown');
        const thinkingNodeId = this.agentToThinkingMap.get(sourceAgent);

        if (!thinkingNodeId) {
            this.workflowLogger.debug(`⚠️ [THINKING-TOOL-CONNECTION] No thinking node found for agent ${sourceAgent}`);
            return;
        }

        // 🎯 [Fork/Join] Tool Call ID와 Thinking Node ID 매핑 저장
        const finalToolCallId = String(data.executionId || data.metadata?.toolCallId as string || `generated_${Date.now()}`);
        if (finalToolCallId) {
            this.toolCallToThinkingMap.set(finalToolCallId, thinkingNodeId);
            this.workflowLogger.debug(`[FORK-JOIN-MAPPING] Mapped tool call ${finalToolCallId} to thinking node ${thinkingNodeId}`);
        }

        // 🔒 NodeEdgeManager를 통한 정석 노드 생성 + 연결
        const nodeWithoutTimestamp = this.createToolCallNodeWithoutTimestamp(data);

        try {
            // 🎯 Source(thinking) Node 존재 확인 후 Target(tool_call) Node 생성 + Edge 생성
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                thinkingNodeId,
                'executes',
                `executes ${data.toolName || 'tool'}`
            );

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🔒 [NODE-MANAGER] Tool call created with enforced order: ${thinkingNodeId} → ${finalNode.id}`);

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create tool_call with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }

        // 🎯 Agent 0의 tool call 추적 (assignTask 등)
        if (data.toolName === 'assignTask' && data.metadata?.toolCallId) {
            const agentNumber = this.agentNumberMap.get(sourceAgent);
            if (agentNumber === 0) {
                const existingToolCalls = this.agentZeroToolCalls.get(sourceAgent) || [];
                existingToolCalls.push(String(data.metadata.toolCallId));
                this.agentZeroToolCalls.set(sourceAgent, existingToolCalls);
                this.workflowLogger.debug(`🎯 [TOOL-CALL-TRACKING] Agent 0 tool call tracked: ${data.metadata.toolCallId} for agent: ${sourceAgent}`);
            }
        }
    }

    /**
     * Agent Creation Complete 이벤트 처리 → ID 매핑
     */
    private handleAgentCreationComplete(data: ServiceEventData): void {
        if (data.parentExecutionId && data.sourceId) {
            this.toolCallToAgentMap.set(data.parentExecutionId, String(data.sourceId));
            this.workflowLogger.debug(`[ID-UNIFICATION] Tool call ${data.parentExecutionId} → Agent ${data.sourceId}`);
        }

        const conversationId = data.result?.conversationId as string;
        if (conversationId && data.sourceId) {
            this.conversationIdToAgentIdMap.set(conversationId, String(data.sourceId));
            this.workflowLogger.debug(`[ID-UNIFICATION] Conversation ${conversationId} → Agent ${data.sourceId}`);
        }
    }

    /**
     * 기타 이벤트 처리 메서드들
     */
    private handleExecutionComplete(data: ServiceEventData): void {
        const nodeId = String(data.executionId || data.sourceId || 'unknown');
        this.updateNodeStatus(nodeId, 'completed');
    }

    /**
     * [수정] Assistant Message Complete 이벤트 처리 (단순화)
     */
    private async handleAssistantMessageComplete(data: ServiceEventData): Promise<void> {
        this.workflowLogger.debug(`🔔 [ASSISTANT-COMPLETE] Processing assistant.message_complete for: ${data.sourceId}`);
        this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] Event data: sourceType=${data.sourceType}, sourceId=${data.sourceId}, executionId=${data.executionId}`);
        const node = this.createAgentResponseNode(data);
        this.emitNodeUpdate('create', node);

        // 🎯 [DIRECT-EDGES] Agent와 Thinking에서 Response로의 연결 생성
        if (data.sourceId && data.sourceType === 'agent') {
            const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
            const thinkingNodeId = this.agentToThinkingMap.get(String(data.sourceId));

            this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] Processing response connection for: ${data.sourceId}`);
            this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] AgentNodeId: ${agentNodeId}, ThinkingNodeId: ${thinkingNodeId}`);
            this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] AgentToThinkingMap contents: ${Array.from(this.agentToThinkingMap.entries()).map(([k, v]) => `${k}→${v}`).join(', ')}`);

            // Thinking → Response 연결
            if (thinkingNodeId) {
                const thinkingNode = this.nodeMap.get(thinkingNodeId);
                this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] ThinkingNode found: ${!!thinkingNode}, ThinkingNode type: ${thinkingNode?.type}`);
                this.workflowLogger.debug(`🔍 [MAIN-AGENT-DEBUG] Response for ${data.sourceId}: thinking=${thinkingNodeId}, isRound2=${thinkingNodeId?.includes('_round2')}`);

                if (thinkingNode) {
                    this.connectNodes(thinkingNode, node, 'return', 'generates response');
                    this.workflowLogger.debug(`🔗 [RULE-9-FIX] Connected thinking ${thinkingNodeId} → response ${node.id}`);

                    // Round 2 thinking의 경우 추가 로깅
                    if (thinkingNodeId.includes('_round2')) {
                        this.workflowLogger.debug(`🔗 [MAIN-AGENT-FIX] Connected Round 2 thinking → response for main agent ${data.sourceId}`);
                    }
                } else {
                    this.workflowLogger.debug(`⚠️ [RULE-9-DEBUG] ThinkingNode not found in nodeMap for ID: ${thinkingNodeId}`);
                }
            } else {
                this.workflowLogger.debug(`⚠️ [MAIN-AGENT-DEBUG] No thinking node found for ${data.sourceId} in agentToThinkingMap`);
                this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] AgentToThinkingMap contents: ${Array.from(this.agentToThinkingMap.entries()).map(([k, v]) => `${k}→${v}`).join(', ')}`);
            }

            this.agentToResponseMap.set(String(data.sourceId), node.id);
            this.workflowLogger.debug(`[RESPONSE-MAPPING] Agent ${data.sourceId} → Response ${node.id}`);

            // 🎯 [RULE-7-COMPLIANCE] agent response → tool_response 연결 생성
            const conversationId = String(data.sourceId);
            this.workflowLogger.debug(`🔍 [RULE-7-DEBUG] Processing response for conversation: ${conversationId}`);

            // 1. 현재 conversation의 agent 노드 찾기
            let currentAgentNodeId: string | undefined;
            for (const [nodeId, nodeData] of this.nodeMap.entries()) {
                if (nodeData.type === 'agent' && nodeData.data?.sourceId === conversationId) {
                    currentAgentNodeId = nodeId;
                    break;
                }
            }

            if (!currentAgentNodeId) {
                this.workflowLogger.debug(`⚠️ [RULE-7-DEBUG] No agent node found for conversation: ${conversationId}`);
                return;
            }

            this.workflowLogger.debug(`🔍 [RULE-7-DEBUG] Found agent node: ${currentAgentNodeId} for conversation: ${conversationId}`);

            // 2. 해당 agent를 생성한 tool_call 찾기
            let parentToolCallNodeId: string | undefined;
            for (const edge of this.edges) {
                if (edge.target === currentAgentNodeId && edge.source.startsWith('tool_call_') && edge.type === 'creates') {
                    parentToolCallNodeId = edge.source;
                    break;
                }
            }

            if (!parentToolCallNodeId) {
                this.workflowLogger.debug(`🔍 [RULE-7-DEBUG] No parent tool_call found for agent: ${currentAgentNodeId} (this is normal for root agent)`);
                return;
            }

            this.workflowLogger.debug(`🔍 [RULE-7-DEBUG] Found parent tool_call: ${parentToolCallNodeId} for agent: ${currentAgentNodeId}`);

            // 3. 해당 tool_call에서 tool_response로의 임시 연결 찾기
            const toolResponseEdge = this.edges.find(edge =>
                edge.source === parentToolCallNodeId &&
                edge.target.startsWith('tool_response_') &&
                edge.type === 'result'
            );

            if (toolResponseEdge) {
                const toolResponseNodeId = toolResponseEdge.target;
                const toolResponseNode = this.nodeMap.get(toolResponseNodeId);

                if (toolResponseNode) {
                    // 기존 tool_call → tool_response 연결 제거
                    this.edges = this.edges.filter(edge =>
                        !(edge.source === parentToolCallNodeId && edge.target === toolResponseNodeId && edge.type === 'result')
                    );
                    this.workflowLogger.debug(`🗑️ [RULE-7-COMPLIANCE] Removed temp connection ${parentToolCallNodeId} → ${toolResponseNodeId}`);

                    // 새로운 agent response → tool_response 연결 생성
                    this.connectNodes(node, toolResponseNode, 'result', 'produces tool result');
                    this.workflowLogger.debug(`🔗 [RULE-7-FIX] Connected agent response ${node.id} → tool_response ${toolResponseNodeId} (replaced temp connection)`);
                } else {
                    this.workflowLogger.debug(`⚠️ [RULE-7-DEBUG] Tool response node not found in nodeMap: ${toolResponseNodeId}`);
                }
            } else {
                this.workflowLogger.debug(`⚠️ [RULE-7-DEBUG] No tool_response edge found for tool_call: ${parentToolCallNodeId}`);
            }
        }
    }

    /**
     * [신규] tool_call → tool_response 연결을 agent_response → tool_response로 교체
     */
    private replaceToolCallResponseConnection(toolCallNodeId: string, toolResponseNodeId: string): void {
        this.workflowLogger.debug(`🔄 [RULE-7-FIX] Attempting to replace connection for ${toolCallNodeId} → ${toolResponseNodeId}`);

        // 1. 이 tool_call에 의해 생성된 agent 찾기
        let agentNodeId: string | undefined;
        for (const edge of this.edges) {
            if (edge.source === toolCallNodeId && edge.type === 'creates') {
                agentNodeId = edge.target;
                break;
            }
        }

        if (!agentNodeId) {
            this.workflowLogger.debug(`⚠️ [RULE-7-FIX] No agent found for tool_call: ${toolCallNodeId}`);
            return;
        }

        this.workflowLogger.debug(`🔍 [RULE-7-FIX] Found agent: ${agentNodeId} for tool_call: ${toolCallNodeId}`);

        // 2. 해당 agent의 response 노드 찾기
        let agentResponseNodeId: string | undefined;
        this.workflowLogger.debug(`🔍 [RULE-7-FIX] Searching agentToResponseMap for agent: ${agentNodeId}`);
        this.workflowLogger.debug(`🔍 [RULE-7-FIX] AgentToResponseMap entries: ${Array.from(this.agentToResponseMap.entries()).map(([k, v]) => `${k}→${v}`).join(', ')}`);

        // agentToResponseMap의 키는 conversation ID이므로 해당 agent의 conversation ID를 찾아야 함
        let agentConversationId: string | undefined;
        for (const [nodeId, nodeData] of this.nodeMap.entries()) {
            if (nodeId === agentNodeId && nodeData.data?.sourceId) {
                agentConversationId = nodeData.data.sourceId;
                break;
            }
        }

        if (agentConversationId) {
            agentResponseNodeId = this.agentToResponseMap.get(agentConversationId);
            this.workflowLogger.debug(`🔍 [RULE-7-FIX] Found conversation ID: ${agentConversationId} → response: ${agentResponseNodeId}`);
        }

        if (agentResponseNodeId) {
            // 기존 tool_call → tool_response 연결 제거
            this.edges = this.edges.filter(edge =>
                !(edge.source === toolCallNodeId && edge.target === toolResponseNodeId && edge.type === 'result')
            );
            this.workflowLogger.debug(`🗑️ [RULE-7-FIX] Removed temp connection ${toolCallNodeId} → ${toolResponseNodeId}`);

            // 새로운 agent_response → tool_response 연결 생성
            const agentResponseNode = this.nodeMap.get(agentResponseNodeId);
            const toolResponseNode = this.nodeMap.get(toolResponseNodeId);
            if (agentResponseNode && toolResponseNode) {
                this.connectNodes(agentResponseNode, toolResponseNode, 'result', 'produces tool result');
                this.workflowLogger.debug(`🔗 [RULE-7-FIX] Connected agent response ${agentResponseNodeId} → tool_response ${toolResponseNodeId} (replaced temp connection)`);
            }
        } else {
            this.workflowLogger.debug(`⚠️ [RULE-7-FIX] No response found for agent: ${agentNodeId}`);
        }
    }

    /**
     * [수정] Tool Call Complete 이벤트 처리 → task.aggregation_start 이벤트 발생
     */
    private handleToolCallComplete(data: ServiceEventData): void {
        const responseNode = this.createToolCallResponseNode(data);
        this.emitNodeUpdate('create', responseNode);

        // 🎯 [RULE-7-COMPLIANCE] tool_call → tool_response 연결 일시적으로 생성
        // 나중에 agent response → tool_response 연결이 생성되면 제거됨
        const finalExecutionId = data.executionId || data.metadata?.executionId || `generated_${Date.now()}`;
        const toolCallNodeId = `tool_call_${finalExecutionId}`;
        const toolCallNode = this.nodeMap.get(toolCallNodeId);
        if (toolCallNode) {
            this.connectNodes(toolCallNode, responseNode, 'result', 'produces result');
            this.workflowLogger.debug(`🔗 [TEMP-CONNECTION] Connected ${toolCallNodeId} → ${responseNode.id} (temporary)`);

            // 🎯 [RULE-7-FIX] 이 tool_call에 해당하는 agent response 찾아서 연결 교체
            this.replaceToolCallResponseConnection(toolCallNodeId, responseNode.id);
        }

        const executionId = String(data.executionId || data.metadata?.executionId);

        // 🎯 핵심 개선: tool_call이 완료되면, task.aggregation_start 이벤트를 발생시켜 결과를 중앙에서 처리
        this.emit('task.aggregation_start', {
            sourceType: 'tool',
            sourceId: responseNode.id, // response 노드를 소스로 지정
            parentExecutionId: executionId, // [오류 수정] tool_call_ 접두사 제거
            rootExecutionId: data.rootExecutionId,
            executionLevel: data.executionLevel,
            timestamp: new Date(),
        });

        // 기존 Tool Call 노드 상태도 업데이트
        const nodeId = String(data.executionId || data.sourceId || 'unknown');
        this.updateNodeStatus(nodeId, 'completed');
    }

    /**
     * [신규 핵심 로직] Tool Call의 결과를 집계하는 Join Point를 생성/관리합니다.
     */
    private async handleToolResultAggregationStart(data: ServiceEventData): Promise<void> {
        this.workflowLogger.debug(`[FORK-JOIN] handleToolResultAggregationStart called for source: ${data.sourceId}`);

        const parentThinkingNodeId = this.findParentThinkingNodeForToolCall(String(data.parentExecutionId));
        if (!parentThinkingNodeId) {
            this.workflowLogger.warn(`[FORK-JOIN] Could not find parent thinking for tool call ${String(data.parentExecutionId)}.`);
            return;
        }

        let toolResultNode = this.nodeMap.get(this.thinkingToToolResultMap.get(parentThinkingNodeId) || '');
        if (!toolResultNode) {
            this.workflowLogger.debug(`[FORK-JOIN] Creating new Join Point for Fork Point: ${parentThinkingNodeId}.`);
            toolResultNode = await this.createToolResultNode({
                sourceId: parentThinkingNodeId,
                sourceType: 'agent'
            }, parentThinkingNodeId);
            this.emitNodeUpdate('create', toolResultNode);
            this.thinkingToToolResultMap.set(parentThinkingNodeId, toolResultNode.id);
        } else {
            this.workflowLogger.debug(`[FORK-JOIN] Found existing Join Point: ${toolResultNode.id}`);
        }

        const toolResponseNodeId = String(data.sourceId);
        if (toolResultNode && toolResponseNodeId) {
            // 🎯 [ALL-CONNECTIONS] 모든 tool_response가 tool_result에 연결 (Rule 6 준수)
            // 이미 연결되어 있는지 확인하여 중복 방지
            const existingConnection = this.edges.find(edge =>
                edge.source === toolResponseNodeId &&
                edge.target === toolResultNode.id &&
                edge.type === 'result'
            );

            if (!existingConnection) {
                // tool_response → tool_result 연결 생성
                this.connectNodesById(toolResponseNodeId, toolResultNode.id, 'result');
                this.workflowLogger.debug(`🔗 [ALL-CONNECTIONS] Connected tool_response ${toolResponseNodeId} → tool_result ${toolResultNode.id}`);
            } else {
                this.workflowLogger.debug(`🔗 [ALL-CONNECTIONS] Connection already exists: ${toolResponseNodeId} → ${toolResultNode.id}`);
            }
        }
    }

    /**
     * [RACE-CONDITION-FIX] 모든 Tool Call이 완료되면 대기중인 다음 Thinking 노드를 생성
     */
    private async handleToolResultAggregationComplete(data: ServiceEventData): Promise<void> {
        const parentThinkingNodeId = this.agentToThinkingMap.get(String(data.sourceId));
        if (!parentThinkingNodeId) {
            this.workflowLogger.warn(`[AGGREGATION-COMPLETE] Could not find parent thinking node for sourceId: ${data.sourceId}`);
            return;
        }

        const toolResultNodeId = this.thinkingToToolResultMap.get(parentThinkingNodeId);
        const toolResultNode = toolResultNodeId ? this.nodeMap.get(toolResultNodeId) : undefined;

        if (toolResultNode) {
            toolResultNode.status = 'completed';
            this.emitNodeUpdate('update', toolResultNode);
            this.workflowLogger.debug(`[FORK-JOIN] Aggregation completed for Join Point: ${toolResultNode.id}`);

            // 대기 중이던 다음 thinking 이벤트 처리
            const pendingEvent = this.pendingThinkingEvents.get(parentThinkingNodeId);
            if (pendingEvent) {
                this.workflowLogger.debug(`[RACE-CONDITION-FIX] Processing pending thinking event for ${parentThinkingNodeId}`);
                this.pendingThinkingEvents.delete(parentThinkingNodeId);
                const nextThinkingNode = this.createAgentThinkingNode(pendingEvent);
                if (nextThinkingNode) {
                    this.emitNodeUpdate('create', nextThinkingNode);
                }
            }
        }
    }


    /**
     * [신규] Tool Call ID를 통해 부모 Thinking Node를 찾는 보조 함수
     */
    private findParentThinkingNodeForToolCall(toolCallNodeId: string): string | undefined {
        const thinkingNodeId = this.toolCallToThinkingMap.get(toolCallNodeId);

        if (thinkingNodeId) {
            this.workflowLogger.debug(`[FORK-JOIN] Found parent thinking node ${thinkingNodeId} for tool call ${toolCallNodeId} via direct map.`);
        } else {
            this.workflowLogger.warn(`[FORK-JOIN] Could not find parent thinking node for tool call ${toolCallNodeId} in the map.`);
        }

        return thinkingNodeId;
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
    private createUserMessageNode(data: ServiceEventData): WorkflowNode {
        // 🔒 NodeEdgeManager를 통한 정석 user_message node 생성
        const nodeWithoutTimestamp: Omit<WorkflowNode, 'timestamp'> = {
            id: `user_message_${data.sourceId}`,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            data: {
                eventType: 'user.message',
                sourceId: data.sourceId,
                parameters: data.parameters,
                label: 'User Message'
            },
            connections: []
        };

        // 🎯 user_message는 agent 노드에 연결되어야 함 (agent → user_message 순서)
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        if (!agentNodeId) {
            throw new Error(`❌ [AGENT-MISSING] No agent node found for sourceId: ${data.sourceId}. Agent must be created before user_message.`);
        }

        try {
            // 🎯 Agent 노드에 연결하여 user_message 노드 생성
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                agentNodeId,
                'receives',
                'receives input'
            );

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🔒 [NODE-MANAGER] User message created with proper order: ${agentNodeId} → ${finalNode.id}`);

            return finalNode;

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create user_message node with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }
    }

    private createAgentNode(data: ServiceEventData): WorkflowNode {
        const agentNumber = this.assignAgentNumber(String(data.sourceId || 'unknown'));
        const agentStructure = this.agentCopyManager.createAgentCopy(agentNumber, String(data.sourceId));

        // 🔒 NodeEdgeManager를 통한 정석 Agent node 생성
        const nodeWithoutTimestamp: Omit<WorkflowNode, 'timestamp'> = {
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
                reservedThinkingId: agentStructure.thinkingId
            },
            connections: [],
            metadata: {
                agentNumber: agentNumber,
                copyNumber: agentStructure.copyNumber,
                standardStructure: {
                    agentId: agentStructure.agentId,
                    thinkingId: agentStructure.thinkingId
                }
            }
        };

        try {
            // 🎯 Agent node는 parentNodeId가 있을 경우에만 연결
            const parentNodeId = data.parentNodeId ? String(data.parentNodeId) : undefined;
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                parentNodeId,
                parentNodeId ? 'creates' : undefined,
                parentNodeId ? 'creates agent' : undefined
            );

            // 🎯 [AGENT-ID-MAPPING] Mapping 저장
            this.agentNodeIdMap.set(String(data.sourceId), agentStructure.agentId);

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🎯 [AGENT-COPY] Created Agent ${agentNumber} Copy ${agentStructure.copyNumber} for sourceId: ${data.sourceId}`);
            this.workflowLogger.debug(`🔧 [AGENT-ID-MAPPING] Stored mapping: ${data.sourceId} → ${agentStructure.agentId}`);
            this.workflowLogger.debug(`🔒 [NODE-MANAGER] Agent node created with enforced order: ${finalNode.id}`);

            return finalNode;

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create agent node with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }
    }

    /**
     * 🎯 Agent 번호 할당 시스템
     */
    private assignAgentNumber(sourceId: string): number {
        if (this.agentNumberMap.has(sourceId)) {
            return this.agentNumberMap.get(sourceId)!;
        }
        const agentNumber = this.agentCounter;
        this.agentNumberMap.set(sourceId, agentNumber);
        this.agentCounter++;
        this.workflowLogger.info(`🎯 [AGENT-NUMBERING] Assigned Agent ${agentNumber} to sourceId: ${sourceId}`);
        return agentNumber;
    }

    private createAgentThinkingNode(data: ServiceEventData): WorkflowNode | null {
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;

        if (!agentNodeId) {
            this.workflowLogger.error(`❌ [STANDARD-STRUCTURE] No agent node found for sourceId: ${data.sourceId}`);
            return null;
        }

        const agentNode = this.nodeMap.get(agentNodeId);
        const baseThinkingId = agentNode?.data?.reservedThinkingId as string;

        if (!baseThinkingId) {
            this.workflowLogger.error(`❌ [STANDARD-STRUCTURE] No reserved thinking ID found for agent: ${agentNodeId}`);
            return null;
        }

        const round = (data.parameters as any)?.round || 1;
        const conversationId = String(data.sourceId).replace('conv_', '').substring(0, 16);
        const sequentialThinkingId = `${baseThinkingId}_${conversationId}_round${round}`;

        this.workflowLogger.debug(`🎯 [SEQUENTIAL-THINKING] Agent ${data.sourceId} Round ${round} → Thinking ${sequentialThinkingId}`);
        this.workflowLogger.debug(`🔧 [AGENT-COPY] Using Agent Copy ID: ${agentNodeId}`);

        // 🔒 NodeEdgeManager를 통한 정석 thinking node 생성
        const nodeWithoutTimestamp: Omit<WorkflowNode, 'timestamp'> = {
            id: sequentialThinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            parentId: agentNodeId,
            level: agentNumber === 0 ? 2 : 5,
            status: 'running',
            data: {
                eventType: 'assistant.message_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                agentNumber: agentNumber,
                round: round,
                label: `Agent ${agentNumber} Thinking Round ${round}`
            },
            connections: []
        };

        try {
            // 🎯 NodeEdgeManager를 통한 thinking node 생성 (agent → thinking 연결)
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                agentNodeId, // agent node를 parent로 연결
                'processes',
                `Agent ${agentNumber} processes`
            );

            // 🎯 [CONNECTION-FIX] agentToThinkingMap 설정
            this.agentToThinkingMap.set(String(data.sourceId), sequentialThinkingId);

            // 🎯 [ROUND1-TRACKING] Round 1 thinking node는 별도로 추적
            if (round === 1) {
                this.agentRound1ThinkingMap.set(String(data.sourceId), sequentialThinkingId);
                this.workflowLogger.debug(`🔧 [ROUND1-TRACKING] Stored Round 1 thinking: ${data.sourceId} → ${sequentialThinkingId}`);
            }

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🔒 [NODE-MANAGER] Thinking node created with enforced order: ${agentNodeId} → ${finalNode.id}`);

            // 🎯 [MAIN-AGENT-FIX] Round 2 thinking의 경우 수동으로 assistant.message_complete 이벤트 생성
            if (round === 2 && !String(data.sourceId).includes('copy')) {
                this.workflowLogger.debug(`🔧 [MAIN-AGENT-FIX] Detected Round 2 thinking for main agent: ${data.sourceId}`);
                // ExecutionService가 정상 종료되지 않는 경우를 대비해 수동으로 이벤트 발생
                setTimeout(() => {
                    this.workflowLogger.debug(`🔧 [MAIN-AGENT-FIX] Manually triggering assistant.message_complete for: ${data.sourceId}`);
                    this.handleAssistantMessageComplete({
                        sourceType: 'agent',
                        sourceId: data.sourceId,
                        timestamp: new Date(),
                        result: {
                            success: true,
                            data: 'Final response for Round 2'
                        },
                        metadata: {
                            round: 2,
                            manually_triggered: true
                        }
                    });
                }, 500);
            }

            return finalNode;

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create thinking node with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }
    }

    private createUniversalToolCallNode(data: ServiceEventData): WorkflowNode {
        const directParentId = data.metadata?.directParentId as string;
        if (!directParentId) {
            throw new Error(`❌ [DIRECT-MAPPING] No directParentId provided in tool_call_start event`);
        }

        const toolCallId = data.metadata?.toolCallId as string;
        const finalToolCallId = data.executionId || toolCallId || `generated_${Date.now()}`;
        this.workflowLogger.debug(`🎯 [TOOL-CALL] Creating tool call ${finalToolCallId} with parent ${directParentId}`);

        return {
            id: `tool_call_${finalToolCallId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            parentId: directParentId,
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'tool_call_start',
                toolName: String(data.toolName || 'unknown_tool'),
                executionId: String(data.executionId || 'unknown'),
                parameters: data.parameters
            },
            timestamp: Date.now(),
            connections: []
        };
    }

    /**
     * 🔒 NodeEdgeManager용 timestamp 없는 노드 생성
     */
    private createToolCallNodeWithoutTimestamp(data: ServiceEventData): Omit<WorkflowNode, 'timestamp'> {
        const directParentId = data.metadata?.directParentId as string;
        if (!directParentId) {
            throw new Error(`❌ [DIRECT-MAPPING] No directParentId provided in tool_call_start event`);
        }

        const toolCallId = data.metadata?.toolCallId as string;
        const finalToolCallId = data.executionId || toolCallId || `generated_${Date.now()}`;
        this.workflowLogger.debug(`🎯 [TOOL-CALL] Creating tool call ${finalToolCallId} with parent ${directParentId}`);

        return {
            id: `tool_call_${finalToolCallId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            parentId: directParentId,
            level: data.executionLevel || 2,
            status: 'running',
            data: {
                eventType: 'tool_call_start',
                toolName: String(data.toolName || 'unknown_tool'),
                executionId: String(data.executionId || 'unknown'),
                parameters: data.parameters
            },
            connections: []
        };
    }

    /**
     * 🔒 기존 시스템과 호환성을 위한 동기화
     */
    private syncWithLegacySystems(node: WorkflowNode): void {
        // 기존 nodeMap과 동기화 (호환성)
        this.nodeMap.set(node.id, node);

        // 기존 edges와 동기화 (호환성)
        const managerEdges = this.nodeEdgeManager.getAllEdges();
        this.edges = [...managerEdges];

        // workflow update callback 호출 (호환성)
        this.emitNodeUpdate('create', node);

        this.workflowLogger.debug(`🔄 [LEGACY-SYNC] Synced node ${node.id} with legacy systems`);
    }

    private createAgentResponseNode(data: ServiceEventData): WorkflowNode {
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        if (!agentNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No agent copy found for sourceId: ${data.sourceId}`);
        }
        const thinkingNodeId = this.agentToThinkingMap.get(String(data.sourceId));
        if (!thinkingNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No thinking node found for Agent ${data.sourceId}`);
        }

        // 🔒 NodeEdgeManager를 통한 정석 response node 생성
        const responseNodeId = `response_${String(data.sourceId)}_${new Date().getTime()}`;
        const nodeWithoutTimestamp: Omit<WorkflowNode, 'timestamp'> = {
            id: responseNodeId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            parentId: agentNodeId,
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: 'assistant.message_complete',
                sourceId: data.sourceId,
                sourceType: 'agent',
                result: data.result,
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Response`
            },
            connections: []
        };

        try {
            // 🎯 thinking 노드에 연결하여 response 노드 생성
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                thinkingNodeId,
                'return',
                `Agent ${agentNumber} result`
            );

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🔒 [NODE-MANAGER] Response created with proper order: ${thinkingNodeId} → ${finalNode.id}`);

            return finalNode;

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create response node with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }
    }

    private async createToolResultNode(data: ServiceEventData, parentThinkingNodeId: string): Promise<WorkflowNode> {
        const nodeId = `tool_result_for_${parentThinkingNodeId}`;
        const node: WorkflowNode = {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
            parentId: parentThinkingNodeId,
            level: data.executionLevel || 3,
            status: 'running',
            data: {
                eventType: 'task.aggregation_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                label: `Tool Results for Agent 0`,
                description: `Aggregating results for thinking node ${parentThinkingNodeId}`
            },
            timestamp: Date.now(),
            connections: []
        };
        return node;
    }

    private nodeExists(nodeId: string): boolean {
        return this.agentNodeIdMap.has(nodeId) ||
            nodeId.startsWith('agent_') ||
            nodeId.startsWith('tool_response_');
    }

    private createToolCallResponseNode(data: ServiceEventData): WorkflowNode {
        const finalExecutionId = data.executionId || data.metadata?.executionId || `generated_${Date.now()}`;
        const toolCallNodeId = `tool_call_${finalExecutionId}`;

        // 🔒 NodeEdgeManager를 통한 정석 tool_call_response node 생성
        const nodeWithoutTimestamp: Omit<WorkflowNode, 'timestamp'> = {
            id: `tool_response_${finalExecutionId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE,
            parentId: toolCallNodeId,
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: 'tool_call_complete',
                sourceId: data.sourceId,
                executionId: String(finalExecutionId),
                result: data.result,
                toolName: String(data.toolName || 'unknown_tool')
            },
            connections: []
        };

        try {
            // 🎯 tool_call 노드에 연결하여 tool_response 노드 생성
            const finalNode = this.nodeEdgeManager.addNode(
                nodeWithoutTimestamp,
                toolCallNodeId,
                'result',
                'tool result'
            );

            // 기존 시스템과 호환성을 위한 동기화
            this.syncWithLegacySystems(finalNode);

            this.workflowLogger.debug(`🔒 [NODE-MANAGER] Tool response created with proper order: ${toolCallNodeId} → ${finalNode.id}`);

            return finalNode;

        } catch (error) {
            this.workflowLogger.error(`🚨 [ORDER-VIOLATION] Failed to create tool_response node with proper order:`, error);
            throw error; // 순서 위반 시 즉시 실패
        }
    }

    private connectToolCallToAgent(data: ServiceEventData): void {
        const toolCallNodeId = `tool_call_${data.parentExecutionId}`;
        const agentNodeId = `agent_${data.sourceId}`;
        const toolCallNode = this.nodeMap.get(toolCallNodeId);
        if (toolCallNode) {
            this.connectNodes(toolCallNode, { id: agentNodeId } as WorkflowNode, 'creates', 'creates agent');
        }
    }

    private updateNodeStatus(nodeId: string, status: WorkflowNodeStatus): void {
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

    private emitNodeUpdate(action: 'create' | 'update' | 'complete' | 'error', node: WorkflowNode): void {
        this.nodeMap.set(node.id, node);
        const update: WorkflowNodeUpdate = {
            action,
            node
        };
        this.nodeUpdateCallbacks.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.workflowLogger.error('Error in workflow node update callback:', error);
            }
        });
        this.workflowLogger.debug(`WorkflowNode ${action}: ${node.type} (${node.id})`);
    }

    getAllNodes(): WorkflowNode[] {
        return Array.from(this.nodeMap.values());
    }

    getNode(nodeId: string): WorkflowNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    getConnections(): WorkflowConnection[] {
        const connections: WorkflowConnection[] = [];
        this.nodeMap.forEach(node => {
            connections.push(...node.connections);
        });
        return connections;
    }

    private handleTaskAssigned(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing task.assigned event`);
        const node = this.createUniversalToolCallNode(data);
        this.emitNodeUpdate('create', node);
    }

    private handleTeamAnalysisStart(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing team.analysis_start event`);

        // 🎯 [FIX] execution.start에서 이미 agent를 생성했으므로 여기서는 생성하지 않음
        // 에이전트 노드가 이미 생성되었는지 확인만 함
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNode = agentNodeId ? this.nodeMap.get(agentNodeId) : null;

        if (!agentNode) {
            this.workflowLogger.warn(`⚠️ [TEAM-AGENT] Agent node for ${data.sourceId} not found. Should have been created by execution.start event.`);
            // Agent 생성은 handleExecutionStart에서 담당하므로 여기서는 생성하지 않음
            return;
        } else {
            this.workflowLogger.debug(`✅ [TEAM-AGENT] Agent node for ${data.sourceId} already exists: ${agentNode.id}`);
        }

        // thinking node는 계속 생성 (이건 필요함)
        const thinkingNode = this.createAgentThinkingNode(data);
        if (thinkingNode) {
            this.emitNodeUpdate('create', thinkingNode);
        }
    }

    // ===== 🎯 Agent Integration Instance System (Playground-level connection quality) =====

    private handleAgentIntegrationStart(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing agent.integration_start event`);
        const node = this.createAgentIntegrationInstance(data);
        this.emitNodeUpdate('create', node);
    }

    private handleAgentIntegrationComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing agent.integration_complete event`);
        const node = this.createFinalIntegrationThinking(data);
        this.emitNodeUpdate('create', node);

        // 🎯 [DIRECT-EDGES] Integration Instance → Final Thinking 연결
        const rootId = data.rootExecutionId || data.sourceId;
        const integrationInstanceId = this.integrationInstanceMap.get(rootId);
        if (integrationInstanceId) {
            const integrationInstance = this.nodeMap.get(integrationInstanceId);
            if (integrationInstance) {
                this.connectNodes(integrationInstance, node, 'consolidates', 'Final integration processing');
            }
        }
    }

    private handleResponseIntegration(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [INTEGRATION] Processing response.integration event`);
        this.connectResponseToIntegrationInstance(data);
    }

    private createAgentIntegrationInstance(data: ServiceEventData): WorkflowNode {
        const integrationInstanceId = `agent_integration_${data.integrationId || Date.now()}`;
        const rootId = data.rootExecutionId || data.sourceId;
        this.integrationInstanceMap.set(rootId, integrationInstanceId);
        this.workflowLogger.debug(`🎯 [INTEGRATION] Created Agent Integration Instance: ${integrationInstanceId}`);
        return {
            id: integrationInstanceId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            parentId: undefined,
            level: 3,
            status: 'running',
            data: {
                eventType: 'agent.integration_start',
                sourceId: data.sourceId,
                sourceType: 'agent',
                integrationId: data.integrationId,
                label: 'Agent Integration Instance',
                description: 'Dedicated instance for response integration and final processing'
            },
            timestamp: Date.now(),
            connections: []
        };
    }

    private createFinalIntegrationThinking(data: ServiceEventData): WorkflowNode {
        const rootId = data.rootExecutionId || data.sourceId;
        const integrationInstanceId = this.integrationInstanceMap.get(rootId);
        const finalThinkingId = `thinking_integration_final_${Date.now()}`;
        const connections: WorkflowConnection[] = [];

        // 🎯 [DIRECT-EDGES] 연결은 노드 생성 후에 별도로 처리
        this.workflowLogger.debug(`🎯 [INTEGRATION] Created Final Integration Thinking: ${finalThinkingId}`);
        return {
            id: finalThinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            parentId: integrationInstanceId,
            level: 4,
            status: 'running',
            data: {
                eventType: 'agent.integration_complete',
                sourceId: data.sourceId,
                sourceType: 'agent',
                integrationId: data.integrationId,
                label: 'Final Integration Thinking',
                description: 'Final processing and result consolidation'
            },
            timestamp: Date.now(),
            connections: connections
        };
    }

    private connectResponseToIntegrationInstance(data: ServiceEventData): void {
        const rootId = data.rootExecutionId || data.sourceId;
        const integrationInstanceId = this.integrationInstanceMap.get(rootId);
        if (!integrationInstanceId) {
            this.workflowLogger.warn(`🚨 [INTEGRATION] No integration instance found for root: ${rootId}`);
            return;
        }
        const responseIds = data.sourceResponseIds || [data.sourceId];
        responseIds.forEach(responseId => {
            const responseNode = this.nodeMap.get(responseId);
            if (responseNode) {
                this.connectNodes(responseNode, { id: integrationInstanceId } as WorkflowNode, 'integrates', 'Integration into final processing');
            }
        });
    }

    private handleTeamAnalysisComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing team.analysis_complete event`);
        const node = this.createAgentResponseNode(data);
        this.emitNodeUpdate('create', node);
    }

    private connectNodes(fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string): void {
        // 중복 연결 방지 체크
        const existingEdge = this.edges.find(edge =>
            edge.source === fromNode.id &&
            edge.target === toNode.id &&
            edge.type === type
        );

        if (!existingEdge) {
            // 🎯 직접 edges 배열에 추가
            const newEdge: UniversalWorkflowEdge = {
                id: `edge_${fromNode.id}_to_${toNode.id}_${this.edges.length}`,
                source: fromNode.id,
                target: toNode.id,
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
                            originalConnection: { fromId: fromNode.id, toId: toNode.id, type, label }
                        }
                    }
                },
                createdAt: new Date(),
                updatedAt: new Date(),
                timestamp: Date.now() // Creation timestamp for sequential order validation
            };

            this.edges.push(newEdge);

            // 기존 node.connections도 호환성을 위해 유지
            if (!fromNode.connections.some(c => c.toId === toNode.id)) {
                fromNode.connections.push({ fromId: fromNode.id, toId: toNode.id, type, label });
                this.emitNodeUpdate('update', fromNode);
            }

            this.workflowLogger.debug(`🔗 [DIRECT-EDGE] Created edge ${fromNode.id} -> ${toNode.id} (${type})`);
        }
    }

    private connectNodesById(fromId: string, toId: string, type: WorkflowConnectionType, label?: string): void {
        const fromNode = this.nodeMap.get(fromId);
        const toNode = this.nodeMap.get(toId);
        if (fromNode && toNode) {
            this.connectNodes(fromNode, toNode, type, label);
        }
    }

    /**
     * 직접 생성된 edges 배열 반환
     */
    public getEdges(): UniversalWorkflowEdge[] {
        return this.edges;
    }

    /**
     * nodes와 edges를 포함한 완전한 워크플로우 데이터 반환
     */
    public getWorkflowData(): { nodes: WorkflowNode[], edges: UniversalWorkflowEdge[] } {
        return {
            nodes: Array.from(this.nodeMap.values()),
            edges: this.edges
        };
    }

    /**
     * 디버깅을 위한 연결 상태 요약 반환
     */
    public getConnectionSummary(): { totalNodes: number, totalEdges: number, edgesByType: Record<string, number> } {
        const edgesByType: Record<string, number> = {};
        this.edges.forEach(edge => {
            edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
        });

        return {
            totalNodes: this.nodeMap.size,
            totalEdges: this.edges.length,
            edgesByType
        };
    }

    /**
     * Fork 패턴에서 엣지를 큐에 추가하고 완료 타이머 설정 (Rule 11 Sequential Order 준수)
     * + 실시간 플레이그라운드 업데이트
     */
    private addToForkEdgeQueue(thinkingNodeId: string, fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string): void {
        // 🎯 1️⃣ 즉시 실시간 업데이트 (플레이그라운드용)
        this.emitRealTimeEdgeUpdate(fromNode, toNode, type, label);

        // 🎯 2️⃣ 큐에 추가 (Rule 11 준수용)
        if (!this.pendingForkEdges.has(thinkingNodeId)) {
            this.pendingForkEdges.set(thinkingNodeId, []);
        }
        this.pendingForkEdges.get(thinkingNodeId)!.push({ fromNode, toNode, type, label });

        this.workflowLogger.debug(`🎯 [FORK-HYBRID] Added edge to queue + real-time update: ${fromNode.id} → ${toNode.id} (thinking: ${thinkingNodeId})`);

        // 🎯 3️⃣ 기존 타이머 취소하고 새 타이머 설정 (debounce)
        if (this.forkCompletionTimers.has(thinkingNodeId)) {
            clearTimeout(this.forkCompletionTimers.get(thinkingNodeId)!);
        }

        // 50ms 대기 후 최종 정리 (timestamp 순서 보장)
        this.forkCompletionTimers.set(thinkingNodeId, setTimeout(() => {
            this.processForkEdges(thinkingNodeId);
        }, 50));
    }

    /**
     * Fork 완료 감지 시 대기 중인 엣지 큐 정리 (중복 생성 방지)
     * 실제 엣지는 이미 emitRealTimeEdgeUpdate에서 생성되었으므로 정리만 수행
     */
    private processForkEdges(thinkingNodeId: string): void {
        const pendingEdges = this.pendingForkEdges.get(thinkingNodeId);
        if (pendingEdges && pendingEdges.length > 0) {
            this.workflowLogger.debug(`🎯 [FORK-CLEANUP] Cleaning up ${pendingEdges.length} processed edges for thinking: ${thinkingNodeId}`);
            // ❌ 중복 생성 방지: connectNodes 호출하지 않음
            // ✅ 엣지는 이미 emitRealTimeEdgeUpdate에서 올바른 timestamp로 생성됨
            this.workflowLogger.debug(`✅ [FORK-COMPLETE] Fork pattern completed for thinking: ${thinkingNodeId} (no duplicate creation)`);
        }

        // 정리
        this.pendingForkEdges.delete(thinkingNodeId);
        this.forkCompletionTimers.delete(thinkingNodeId);
    }

    /**
     * 실시간 엣지 생성 (플레이그라운드 즉시 표시 + 영구 엣지 생성)
     * timestamp 무결성을 유지하면서 즉시 시각화
     */
    private emitRealTimeEdgeUpdate(fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string): void {
        // 중복 연결 방지 체크
        const existingEdge = this.edges.find(edge =>
            edge.source === fromNode.id &&
            edge.target === toNode.id &&
            edge.type === type
        );

        if (!existingEdge) {
            // 🎯 영구 엣지 즉시 생성 (timestamp 무결성 보장)
            const newEdge: UniversalWorkflowEdge = {
                id: `edge_${fromNode.id}_to_${toNode.id}_${this.edges.length}`,
                source: fromNode.id,
                target: toNode.id,
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
                            originalConnection: { fromId: fromNode.id, toId: toNode.id, type, label }
                        }
                    }
                },
                createdAt: new Date(),
                updatedAt: new Date(),
                timestamp: Date.now() // 🔒 절대 수정되지 않는 무결성 timestamp
            };

            this.edges.push(newEdge);

            // 기존 node.connections도 호환성을 위해 유지
            if (!fromNode.connections.some(c => c.toId === toNode.id)) {
                fromNode.connections.push({ fromId: fromNode.id, toId: toNode.id, type, label });
                this.emitNodeUpdate('update', fromNode); // 즉시 플레이그라운드 업데이트
            }

            this.workflowLogger.debug(`⚡ [REAL-TIME-PERMANENT] Created permanent edge: ${fromNode.id} → ${toNode.id} (${type})`);
        }
    }
}
