/**
 * WorkflowEventSubscriber - Real-time event subscriber
 *
 * Architectural Rules (MUST FOLLOW):
 * 1) No pre-creation: Never create a node that cannot be connected immediately.
 *    - Each handler must only create nodes when all required partner nodes exist for its edges.
 *    - If partners are missing, DO NOT create; surface the design issue (no queues, no deferrals).
 * 2) Single source of connections:
 *    - agent_response → tool_response is handled ONLY at tool.call_response_ready.
 *    - aggregation_start never re-links agent_response; it only handles tool_result join edges.
 * 3) Single snapshot per event:
 *    - Add edges silently via NodeEdgeManager.addEdge (no intermediate UI updates).
 *    - Emit exactly one UI update per event handler (emitNodeUpdate('create'|'update', node)).
 *    - Do not use mid-event update emissions; do not rely on real-time edge update side effects.
 * 4) No retries / no queues:
 *    - NodeEdgeManager performs immediate, synchronous creation; missing partners throw immediately.
 *    - Event order must be correct at the source; subscriber does not repair ordering.
 * 5) Event ownership & prefixes must be respected; event names via constants only.
 */

import { EventService, ServiceEventType, ServiceEventData, ActionTrackingEventService } from './event-service';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';
import type { WorkflowData } from '../interfaces/workflow-converter';
import { WORKFLOW_NODE_TYPES, WorkflowNodeType, isValidWorkflowNodeType } from '../constants/workflow-node-types';
import type { UniversalWorkflowEdge } from './workflow-converter/universal-types';
import { NodeEdgeManager } from './node-edge-manager.js';
import { EXECUTION_EVENTS, TOOL_EVENTS } from './execution-service.js'; // 🎯 [EVENT-CONSTANTS] Import ExecutionService and Tool events

// 🎯 [EVENT-CONSTANTS] Import Agent events from team package
const AGENT_EVENTS = {
    CREATION_START: 'agent.creation_start',
    CREATION_COMPLETE: 'agent.creation_complete',
    EXECUTION_START: 'agent.execution_start',
    EXECUTION_COMPLETE: 'agent.execution_complete'
} as const;

// 🎯 [EVENT-CONSTANTS] Task events
const TASK_EVENTS = {
    ASSIGNED: 'task.assigned',
    COMPLETED: 'task.completed',
    AGGREGATION_START: 'task.aggregation_start',
    AGGREGATION_COMPLETE: 'task.aggregation_complete'
} as const;

// 🎯 [EVENT-CONSTANTS] Team events
const TEAM_EVENTS = {
    ANALYSIS_START: 'team.analysis_start',
    ANALYSIS_COMPLETE: 'team.analysis_complete'
} as const;

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

    // 🚀 Phase 1: NodeEdgeManager 통합
    private nodeEdgeManager: NodeEdgeManager;

    // 📦 레거시 호환성 (임시)
    private nodeMap = new Map<string, WorkflowNode>(); // Node 캐시
    private edges: UniversalWorkflowEdge[] = []; // 🎯 직접 edges 배열 관리
    private agentRound1ThinkingMap = new Map<string, string>(); // sourceId -> round1ThinkingId
    private agentCounter = 0; // Agent 번호 시스템: Agent 0, Agent 1, Agent 2...
    private agentNumberMap = new Map<string, number>(); // sourceId → Agent 번호 매핑
    private agentNodeIdMap = new Map<string, string>(); // 🔧 sourceId → 실제 생성된 Agent Node ID 매핑
    private agentToThinkingMap = new Map<string, string>(); // 🎯 Agent ID → 가장 최근 Thinking Node ID 매핑
    private agentToToolResultNodeMap = new Map<string, string>(); // 🎯 Agent ID → 해당 Agent가 시작한 Tool Result Node ID 매핑
    private thinkingToToolResultMap = new Map<string, string>(); // 🎯 Thinking Node ID(Fork) → Tool Result Node ID(Join) 매핑
    private toolCallToThinkingMap = new Map<string, string>(); // 🎯 Tool Call ID -> Thinking Node ID 매핑
    // 🎯 [LEGACY-REMOVAL] agentResponseHistory 제거 - 중복 방지 안티패턴 제거

    // 🎯 Pending connection queues to resolve ordering without races
    // Removed response→result deferral to enforce immediate, event-ordered connections
    private pendingAnalyzeForThinking = new Map<string, string[]>(); // round1_thinking_id → pending round>=2 thinking ids
    // removed: pendingAgentResponseToToolResponse (agent_response ↔ tool_response 연결은 aggregation_start에서 일괄 처리)

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

        // 🚀 Phase 1: NodeEdgeManager 초기화
        this.nodeEdgeManager = new NodeEdgeManager(this.workflowLogger);

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
            case EXECUTION_EVENTS.USER_MESSAGE:
                this.handleUserMessage(data);
                break;
            case EXECUTION_EVENTS.START:
                this.handleExecutionStart(data);
                break;
            case EXECUTION_EVENTS.COMPLETE:
                this.handleExecutionComplete(data);
                break;
            case EXECUTION_EVENTS.ASSISTANT_MESSAGE_START:
                this.handleAssistantMessageStart(data);
                break;
            case EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE:
                this.handleAssistantMessageComplete(data);
                break;
            case TOOL_EVENTS.CALL_START:
                this.handleToolCallStart(data);
                break;
            case TOOL_EVENTS.CALL_COMPLETE:
                this.handleToolCallComplete(data);
                break;
            case 'tool.call_response_ready':
                this.handleToolCallResponseReady(data);
                break;
            case AGENT_EVENTS.CREATION_START:
                this.handleAgentCreationStart(data);
                break;
            case AGENT_EVENTS.CREATION_COMPLETE:
                this.handleAgentCreationComplete(data);
                break;
            case AGENT_EVENTS.EXECUTION_START:
                this.handleAgentExecutionStart(data);
                break;
            case AGENT_EVENTS.EXECUTION_COMPLETE:
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

            case TASK_EVENTS.ASSIGNED:
                this.handleTaskAssigned(data);
                break;
            case TEAM_EVENTS.ANALYSIS_START:
                this.handleTeamAnalysisStart(data);
                break;
            case TEAM_EVENTS.ANALYSIS_COMPLETE:
                this.handleTeamAnalysisComplete(data);
                break;
            case TASK_EVENTS.AGGREGATION_START:
                this.handleToolResultAggregationStart(data);
                break;
            case TASK_EVENTS.AGGREGATION_COMPLETE:
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
                // 🚀 Phase 4: Direct NodeEdgeManager usage
                this.nodeEdgeManager.addEdge(agentNode.id, userMessageNode.id, 'receives' as WorkflowConnectionType, 'receives input');
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

        // 🎯 [CONNECTION-FIX] parentNodeId 또는 parentExecutionId가 있으면 부모 tool_call 노드와 연결
        let parentNodeId = data.parentNodeId;

        // parentNodeId가 없지만 parentExecutionId가 있는 경우 (Sub-agent 시나리오)
        if (!parentNodeId && data.parentExecutionId) {
            // parentExecutionId는 일반적으로 tool_call ID이므로 해당 tool_call 노드를 찾음
            const toolCallNodeId = `tool_call_${data.parentExecutionId}`;
            const toolCallNode = this.nodeMap.get(toolCallNodeId);
            if (toolCallNode) {
                parentNodeId = toolCallNodeId;
                this.workflowLogger.info(`🔍 [SUB-AGENT-PARENT] Found parent tool_call node: ${toolCallNodeId} for sub-agent ${node.id}`);
            } else {
                this.workflowLogger.warn(`⚠️ [SUB-AGENT-PARENT] Tool call node ${toolCallNodeId} not found for parentExecutionId: ${data.parentExecutionId}`);
            }
        }

        if (parentNodeId) {
            const parentNode = this.nodeMap.get(String(parentNodeId));
            if (parentNode) {
                // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
                try {
                    const edge = this.nodeEdgeManager.addEdge(parentNode.id, node.id, 'creates', 'creates agent');
                    // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨
                    this.workflowLogger.info(`🔗 [AGENT-CREATION] Connected ${parentNode.id} → ${node.id} via NodeEdgeManager`);
                } catch (error) {
                    this.workflowLogger.warn(`⚠️ [AGENT-CREATION-FAIL] Failed to connect ${parentNode.id} → ${node.id}: ${error}`);
                }
            } else {
                this.workflowLogger.error(`❌ [MISSING-PARENT] Parent node ${parentNodeId} not found for agent ${node.id}`);
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
                            // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
                            try {
                                const edge = this.nodeEdgeManager.addEdge(toolResultNode.id, node.id, 'analyze', 'analyzes results');
                                // 📦 레거시 호환성: 기존 edges 배열과 동기화 (임시)
                                if (!this.edges.find(e => e.id === edge.id)) {
                                    this.edges.push(edge);
                                }
                                this.workflowLogger.debug(`✅ [FORK-JOIN] Round ${round} thinking connected to Join Point ${toolResultNodeId} via NodeEdgeManager (status: ${toolResultNode.status})`);

                                // ❌ Removed non-deterministic forced response creation for Round >= 2 (No Fallback Policy)
                            } catch (error) {
                                this.workflowLogger.warn(`⚠️ [FORK-JOIN-FAIL] Failed to connect ${toolResultNodeId} → ${node.id}: ${error}`);
                            }

                            // Round 1 thinking의 매핑은 유지 (다른 round에서 사용할 수 있음)
                            this.workflowLogger.debug(`🔧 [FORK-JOIN] Keeping map entry for Round 1 thinking: ${round1ThinkingNodeId}`);
                        } else {
                            this.workflowLogger.warn(`⚠️ [ROUND2-FIX] Tool result node not found in nodeMap: ${toolResultNodeId}`);
                        }
                    } else {
                        // 🔖 Defer analyze connection until tool_result is created for the Round 1 thinking
                        const pending = this.pendingAnalyzeForThinking.get(round1ThinkingNodeId) || [];
                        pending.push(node.id);
                        this.pendingAnalyzeForThinking.set(round1ThinkingNodeId, pending);
                        this.workflowLogger.debug(`🕓 [ROUND2-PENDING] Deferred analyze: ${round1ThinkingNodeId} → ${node.id} (waiting for tool_result)`);
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
                    // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
                    try {
                        const edge = this.nodeEdgeManager.addEdge(userMessageNode.id, node.id, 'processes', 'triggers thinking');
                        // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨
                        this.workflowLogger.debug(`🔗 [USER-THINKING] Connected ${userMessageNode.id} → ${node.id} via NodeEdgeManager`);
                    } catch (error) {
                        this.workflowLogger.warn(`⚠️ [USER-THINKING-FAIL] Failed to connect ${userMessageNodeId} → ${node.id}: ${error}`);
                    }
                }
            }
        }
    }


    /**
     * Tool Call Start 이벤트 처리 → tool_call Node 생성 및 thinking 연결
     */
    private handleToolCallStart(data: ServiceEventData): void {
        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성
        const directParentId = data.metadata?.directParentId as string;
        if (!directParentId) {
            throw new Error(`❌ [DIRECT-MAPPING] No directParentId provided in tool_call_start event`);
        }

        const finalExecutionId = data.executionId || data.metadata?.executionId || `generated_${Date.now()}`;
        const sourceAgent = String(data.sourceId || 'unknown');
        const thinkingNodeId = this.agentToThinkingMap.get(sourceAgent);
        const expectedCount = Number((data.metadata as any)?.expectedCount ?? 0);
        const batchId = String(((data.metadata as any)?.batchId ?? thinkingNodeId) || 'unknown_batch');

        const node = this.nodeEdgeManager.addNode({
            id: `tool_call_${finalExecutionId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            level: 2,
            status: 'running',
            data: {
                toolName: String((data as any).toolName || 'unknown_tool'),
                executionId: finalExecutionId,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                batch: { batchId, expectedCount },
                extensions: {
                    robota: {
                        originalEvent: data,
                        sourceId: data.sourceId,
                        sourceType: data.sourceType
                    }
                }
            },
            connections: []
        }, directParentId, 'executes' as WorkflowConnectionType, 'tool_call');

        this.emitNodeUpdate('create', node as any);

        // thinkingNodeId already computed above

        if (thinkingNodeId) {
            // 🎯 [Fork/Join] Tool Call ID와 Thinking Node ID 매핑 저장
            const finalToolCallId = String(data.executionId || data.metadata?.toolCallId as string || `generated_${Date.now()}`);
            if (finalToolCallId) {
                this.toolCallToThinkingMap.set(finalToolCallId, thinkingNodeId);
                this.workflowLogger.debug(`[FORK-JOIN-MAPPING] Mapped tool call ${finalToolCallId} to thinking node ${thinkingNodeId}`);
            }

            const thinkingNode = this.nodeMap.get(thinkingNodeId);
            if (thinkingNode) {
                // 🎯 [FORK-PATTERN] Fork 패턴 감지 시 큐를 사용한 지연 처리 (Rule 11 Sequential Order 준수)
                this.addToForkEdgeQueue(thinkingNodeId, thinkingNode, node, 'executes', `executes ${data.toolName || 'tool'}`);
            }
        } else {
            this.workflowLogger.debug(`⚠️ [THINKING-TOOL-CONNECTION] No thinking node found for agent ${sourceAgent}`);
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
        this.workflowLogger.debug(`🔔 [AGENT-CREATION-COMPLETE] Processing with parentExecutionId: ${data.parentExecutionId}, sourceId: ${data.sourceId}`);

        // 🔧 [PARENT-ID-FIX] ActionTrackingEventService가 parentExecutionId를 유실시키는 경우 복구
        let effectiveParentExecutionId = data.parentExecutionId;

        if (!effectiveParentExecutionId && data.sourceId) {
            // team이 생성한 agent의 sourceId는 "agent-timestamp-hash" 형태
            // 해당 agent를 생성한 tool_call을 역추적
            for (const [toolCallId, agentSourceId] of this.toolCallToAgentMap.entries()) {
                if (agentSourceId === String(data.sourceId)) {
                    effectiveParentExecutionId = toolCallId;
                    this.workflowLogger.debug(`🔧 [PARENT-ID-FIX] Recovered parentExecutionId: ${effectiveParentExecutionId} for agent: ${data.sourceId}`);
                    break;
                }
            }

            // 만약 여전히 찾지 못했다면, 현재 활성화된 tool_call들 중에서 찾기
            if (!effectiveParentExecutionId) {
                const possibleToolCalls = Array.from(this.nodeMap.keys()).filter(id => id.startsWith('tool_call_call_'));
                if (possibleToolCalls.length > 0) {
                    // 가장 최근의 tool_call을 사용 (임시 방편)
                    effectiveParentExecutionId = possibleToolCalls[possibleToolCalls.length - 1].replace('tool_call_', '');
                    this.workflowLogger.debug(`🔧 [PARENT-ID-FIX] Using latest tool_call as parent: ${effectiveParentExecutionId} for agent: ${data.sourceId}`);
                }
            }
        }

        if (effectiveParentExecutionId && data.sourceId) {
            this.toolCallToAgentMap.set(effectiveParentExecutionId, String(data.sourceId));
            this.workflowLogger.debug(`[ID-UNIFICATION] Tool call ${effectiveParentExecutionId} → Agent ${data.sourceId}`);

            // 🔗 [TOOL-AGENT-CONNECTION] tool_call → agent 연결 생성
            const enrichedData = { ...data, parentExecutionId: effectiveParentExecutionId };
            this.connectToolCallToAgent(enrichedData);
        } else {
            this.workflowLogger.debug(`⚠️ [AGENT-CREATION-COMPLETE] Still missing parentExecutionId or sourceId: parentExecutionId=${effectiveParentExecutionId}, sourceId=${data.sourceId}`);
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
        this.workflowLogger.debug(`🔔 [ASSISTANT-COMPLETE] Processing execution.assistant_message_complete for: ${data.sourceId}`);
        this.workflowLogger.debug(`🔍 [RULE-9-DEBUG] Event data: sourceType=${data.sourceType}, sourceId=${data.sourceId}, executionId=${data.executionId}`);

        // 🎯 [LEGACY-REMOVAL] 중복 방지 로직 제거 - user 요청에 따라 중복이 발생하면 결과에 나타나도록 함
        // 중복 방지는 안티패턴이며, 디버깅을 어렵게 만들므로 제거

        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        if (!agentNodeId) {
            throw new Error(`❌ [STANDARD-STRUCTURE] No agent copy found for sourceId: ${data.sourceId}`);
        }

        const responseNodeId = `agent_response_${agentNodeId}_${Date.now()}`;
        const node = this.nodeEdgeManager.addNode({
            id: responseNodeId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            level: 1,
            status: 'completed',
            data: {
                sourceId: data.sourceId,
                executionId: data.executionId,
                agentNumber: agentNumber,
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        agentNodeId: agentNodeId,
                        sourceType: data.sourceType
                    }
                }
            },
            connections: []
        });

        this.emitNodeUpdate('create', node as any);

        // 🎯 [DIRECT-EDGES] Agent와 Thinking에서 Response로의 연결 생성 (엣지는 무음 추가, 마지막에 단일 create emit)
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
                    try {
                        this.nodeEdgeManager.addEdge(thinkingNode.id, node.id, 'return', 'generates response');
                        this.workflowLogger.debug(`🔗 [RULE-9-FIX] Connected thinking ${thinkingNodeId} → response ${node.id}`);
                    } catch (error) {
                        this.workflowLogger.warn(`⚠️ [RULE-9-FIX-FAIL] Failed to connect ${thinkingNodeId} → ${node.id}: ${error}`);
                    }

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

            // 🔧 연결 소스 단일화: agent_response ↔ tool_response 연결은 tool.call_response_ready에서만 처리
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

            // 🔗 [RULE-7-COMPLETION] agent_response → tool_response 연결 생성
            // tool_call → tool_response 직접 연결을 제거했으므로
            // 이제 agent_response → tool_response 연결이 필요함
            const edge = this.nodeEdgeManager.addEdge(agentResponseNodeId, toolResponseNodeId, 'result', 'produces tool result');
            this.workflowLogger.debug(`🔗 [RULE-7-COMPLETION] Connected agent_response ${agentResponseNodeId} → tool_response ${toolResponseNodeId}`);
        } else {
            this.workflowLogger.debug(`⚠️ [RULE-7-FIX] No response found for agent: ${agentNodeId}`);
        }
    }

    /**
 * 🎯 [EVENT-ORDER-FIX] Tool Call Complete: 도구 호출만 완료된 상태 처리
 * tool_call_response 노드는 실제 도구 결과가 준비된 시점에서 별도로 생성
     */
    private handleToolCallComplete(data: ServiceEventData): void {
        // 🎯 [PHASE-1] 도구 호출만 완료된 상태 - tool_call_response 노드는 아직 생성하지 않음
        this.workflowLogger.debug(`🔧 [TOOL-CALL-ONLY] Tool call completed (호출만 완료): ${data.metadata?.executionId}, phase: ${data.metadata?.phase}`);

        // 기존 Tool Call 노드 상태만 업데이트
        const nodeId = String(data.executionId || data.sourceId || 'unknown');
        this.updateNodeStatus(nodeId, 'completed');

        // 🎯 [EVENT-ORDER-FIX] tool_call_response 노드 생성은 실제 결과가 준비된 시점으로 이동
        // assignTask의 경우: agent response 완료 후
        // 일반 tool의 경우: 즉시 결과 준비됨
    }

    /**
     * 🎯 [EVENT-ORDER-FIX] Tool Call Response Ready: 실제 도구 결과가 준비된 시점 처리
     * 올바른 순서: tool_call → (agent → thinking → response) → tool_call_response
     */
    private handleToolCallResponseReady(data: ServiceEventData): void {
        this.workflowLogger.debug(`🎯 [TOOL-RESPONSE-READY] Tool result actually ready: ${data.sourceId}, phase: ${data.metadata?.phase}`);

        // 🎯 Direct node creation without defensive validation
        // Trust that the event order is correct by design
        const parentToolCallId = String(data.metadata?.executionId || data.executionId || '').trim();
        const toolCallNodeId = parentToolCallId ? `tool_call_${parentToolCallId}` : '';

        // Find the agent created by this tool_call
        const edgesNow = this.nodeEdgeManager.getAllEdges();
        const createdEdge = edgesNow.find(e => e.source === toolCallNodeId && e.type === 'creates');
        const agentNodeId = createdEdge?.target || '';
        const agentResponseId = this.findLatestResponseByAgent(agentNodeId);

        // Create tool_response node
        const responseNode = this.createToolCallResponseNode(data);

        // Connect agent_response → tool_response
        // If connection fails, let NodeEdgeManager throw - this is a design error
        this.nodeEdgeManager.addEdge(agentResponseId || '', responseNode.id, 'result', 'produces tool result');

        this.workflowLogger.debug(`✅ [TOOL-RESPONSE-CREATED] Tool response node created and linked: ${responseNode.id}`);

        // Single snapshot emit after edges
        this.emitNodeUpdate('create', responseNode);

        // Batch aggregation bookkeeping
        const thinkingNodeId = this.findParentThinkingNodeForToolCall(parentToolCallId);
        if (thinkingNodeId) {
            const batchKey = thinkingNodeId;
            if (!(this as any)._batchExpected) (this as any)._batchExpected = new Map<string, number>();
            if (!(this as any)._batchCompleted) (this as any)._batchCompleted = new Map<string, number>();

            const expectedExisting = (this as any)._batchExpected.get(batchKey);
            if (expectedExisting === undefined) {
                const allEdges = this.nodeEdgeManager.getAllEdges();
                const expected = allEdges.filter(e => e.source === batchKey && e.type === 'executes' && e.target.startsWith('tool_call_')).length;
                if (expected > 0) (this as any)._batchExpected.set(batchKey, expected);
            }

            const completed = ((this as any)._batchCompleted.get(batchKey) || 0) + 1;
            (this as any)._batchCompleted.set(batchKey, completed);

            const expected = (this as any)._batchExpected.get(batchKey);
            if (expected && completed === expected) {
                this.workflowLogger.debug(`[BATCH-AGGREGATION] All tool responses ready for ${batchKey} (${completed}/${expected}). Emitting task.aggregation_start once.`);
                this.emit(TASK_EVENTS.AGGREGATION_START, {
                    sourceType: 'tool',
                    sourceId: responseNode.id,
                    parentExecutionId: parentToolCallId,
                    rootExecutionId: data.rootExecutionId,
                    executionLevel: data.executionLevel,
                    timestamp: new Date(),
                });
            }
        }
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

        // 🎯 [AGG-RESP-LINK] Connect each sub-agent's latest agent_response → its tool_response for this thinking
        const edges = this.nodeEdgeManager.getAllEdges();
        const toolCallNodeIds = edges
            .filter(e => e.source === parentThinkingNodeId && e.type === 'executes' && e.target.startsWith('tool_call_'))
            .map(e => e.target);

        for (const toolCallNodeId of toolCallNodeIds) {
            const createdEdge = edges.find(e => e.source === toolCallNodeId && e.type === 'creates');
            if (!createdEdge) {
                this.workflowLogger.warn(`[AGG-RESP-LINK] No agent created by ${toolCallNodeId}`);
                continue;
            }
            const agentNodeId = createdEdge.target;
            const agentResponseId = this.findLatestResponseByAgent(agentNodeId);
            if (!agentResponseId) {
                this.workflowLogger.warn(`[AGG-RESP-LINK] No agent_response for agent ${agentNodeId} (tool_call: ${toolCallNodeId})`);
                continue;
            }
            const toolResponseNodeId = toolCallNodeId.replace('tool_call_', 'tool_response_');
            if (!this.nodeEdgeManager.hasNode(toolResponseNodeId)) {
                this.workflowLogger.warn(`[AGG-RESP-LINK] Missing tool_response node ${toolResponseNodeId} at aggregation time`);
                continue;
            }
            const already = this.nodeEdgeManager.getAllEdges().some(e => e.source === agentResponseId && e.target === toolResponseNodeId && e.type === 'result');
            if (!already) {
                try {
                    const fromNode = this.nodeEdgeManager.getNode(agentResponseId) || this.nodeMap.get(agentResponseId);
                    const toNode = this.nodeEdgeManager.getNode(toolResponseNodeId) || this.nodeMap.get(toolResponseNodeId);
                    if (fromNode && toNode) {
                        this.emitRealTimeEdgeUpdate(fromNode as any, toNode as any, 'result', 'produces tool result');
                        this.workflowLogger.debug(`[AGG-RESP-LINK] Connected ${agentResponseId} → ${toolResponseNodeId} via RealTime update`);
                    }
                } catch (error) {
                    this.workflowLogger.warn(`[AGG-RESP-LINK] Failed to connect ${agentResponseId} → ${toolResponseNodeId}: ${error}`);
                }
            }
        }

        // 🎯 [BATCH-CONNECT] Connect all tool_responses for this thinking to the tool_result
        const allToolCallIds: string[] = [];
        for (const [toolCallId, thinkingId] of this.toolCallToThinkingMap.entries()) {
            if (thinkingId === parentThinkingNodeId) allToolCallIds.push(toolCallId);
        }

        for (const toolCallId of allToolCallIds) {
            const responseId = `tool_response_${toolCallId}`;
            if (this.nodeEdgeManager.hasNode(responseId)) {
                const already = this.nodeEdgeManager.getAllEdges().some(e => e.source === responseId && e.target === toolResultNode!.id && e.type === 'result');
                if (!already) {
                    const fromNode = this.nodeEdgeManager.getNode(responseId) || this.nodeMap.get(responseId);
                    if (fromNode) {
                        this.emitRealTimeEdgeUpdate(fromNode as any, toolResultNode as any, 'result', 'tool result');
                        this.workflowLogger.debug(`🔗 [BATCH-CONNECT] Connected ${responseId} → ${toolResultNode!.id} via RealTime update`);
                    }
                }
            } else {
                // Do not defer; follow single-path event ordering policy. Missing tool_response means it wasn't created yet.
                this.workflowLogger.warn(`⚠️ [MISSING-TOOL-RESPONSE] ${responseId} not found at aggregation time; skipping deferred connection`);
            }
        }

        // 🎯 [ANALYZE-PENDING] Attach deferred round≥2 thinking nodes
        const pendingAnalyzeList = this.pendingAnalyzeForThinking.get(parentThinkingNodeId) || [];
        if (pendingAnalyzeList.length > 0) {
            pendingAnalyzeList.forEach(thinkingId => {
                try {
                    const toNode = this.nodeEdgeManager.getNode(thinkingId) || this.nodeMap.get(thinkingId);
                    if (toNode) {
                        this.emitRealTimeEdgeUpdate(toolResultNode as any, toNode as any, 'analyze', 'analyzes results');
                        this.workflowLogger.debug(`🔗 [ANALYZE-CONNECT] Connected ${toolResultNode!.id} → ${thinkingId} via RealTime update`);
                    }
                } catch (error) {
                    this.workflowLogger.warn(`⚠️ [ANALYZE-CONNECT-FAIL] Failed to connect ${toolResultNode!.id} → ${thinkingId}: ${error}`);
                }
            });
            this.pendingAnalyzeForThinking.delete(parentThinkingNodeId);
        }
    }

    /**
     * [RULE-7-HELPER] tool_response 노드에 해당하는 tool_call 노드 찾기
     */
    private findToolCallForResponse(toolResponseNodeId: string): string | null {
        // tool_response_call_XXX → tool_call_call_XXX 패턴 매칭
        if (toolResponseNodeId.startsWith('tool_response_call_')) {
            const executionId = toolResponseNodeId.replace('tool_response_call_', '');
            const toolCallNodeId = `tool_call_call_${executionId}`;

            // NodeEdgeManager에서 해당 tool_call 노드가 존재하는지 확인
            if (this.nodeMap.has(toolCallNodeId)) {
                return toolCallNodeId;
            }
        }

        this.workflowLogger.warn(`[RULE-7-HELPER] Could not find matching tool_call for tool_response: ${toolResponseNodeId}`);
        return null;
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

            // 🎯 [MAIN-AGENT-ROUND2-TRIGGER] Tool aggregation completed - Main Agent의 ExecutionService는 이미 while loop에서 자동으로 Round 2 진행
            this.workflowLogger.info(`🔄 [MAIN-AGENT-ROUND2-TRIGGER] Tool aggregation completed for sourceId: ${data.sourceId} - ExecutionService should continue to Round 2 automatically`);

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


    // ❌ Removed forced response creation method to comply with single, verifiable event path

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
        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성 (user_message는 일반적으로 root node이므로 parent 없음)
        const node = this.nodeEdgeManager.addNode({
            id: `user_message_${data.sourceId}`,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            data: {
                eventType: 'execution.user_message',
                sourceId: data.sourceId,
                parameters: data.parameters,
                label: 'User Message'
            },
            connections: []
        });

        return node as WorkflowNode;
    }

    private createAgentNode(data: ServiceEventData): WorkflowNode {
        const agentNumber = this.assignAgentNumber(String(data.sourceId || 'unknown'));
        const agentStructure = this.agentCopyManager.createAgentCopy(agentNumber, String(data.sourceId));

        this.agentNodeIdMap.set(String(data.sourceId), agentStructure.agentId);

        this.workflowLogger.debug(`🎯 [AGENT-COPY] Created Agent ${agentNumber} Copy ${agentStructure.copyNumber} for sourceId: ${data.sourceId}`);
        this.workflowLogger.debug(`🔧 [AGENT-ID-MAPPING] Stored mapping: ${data.sourceId} → ${agentStructure.agentId}`);

        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성 (parentNodeId는 필요한 경우에만)
        const parentNodeId = data.parentNodeId ? String(data.parentNodeId) : undefined;
        const node = this.nodeEdgeManager.addNode({
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
        }, parentNodeId, parentNodeId ? 'creates' as WorkflowConnectionType : undefined, parentNodeId ? 'creates agent' : undefined);

        return node as WorkflowNode;
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

        const connections: WorkflowConnection[] = [];

        // 🎯 [CONNECTION-FIX] 연결 로직을 직접 edges 시스템으로 통일
        // 노드를 먼저 생성한 후 연결을 설정해야 하므로, 노드 생성 후에 연결 생성

        this.agentToThinkingMap.set(String(data.sourceId), sequentialThinkingId);
        this.workflowLogger.debug(`🔧 [THINKING-MAP-UPDATE] Updated agentToThinkingMap: ${data.sourceId} → ${sequentialThinkingId} (Round ${round})`);

        // 🎯 [ROUND1-TRACKING] Round 1 thinking node는 별도로 추적
        if (round === 1) {
            this.agentRound1ThinkingMap.set(String(data.sourceId), sequentialThinkingId);
            this.workflowLogger.debug(`🔧 [ROUND1-TRACKING] Stored Round 1 thinking: ${data.sourceId} → ${sequentialThinkingId}`);
        }

        // 🎯 [EVENT-OWNERSHIP] execution.assistant_message_complete는 ExecutionService 소유
        // WorkflowEventSubscriber는 이벤트를 수신만 하고 발생시키지 않음
        this.workflowLogger.debug(`🔍 [EVENT-OWNERSHIP] Thinking node created for ${data.sourceId}, round ${round}. execution.assistant_message_complete will be emitted by ExecutionService when appropriate.`);

        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성
        const node = this.nodeEdgeManager.addNode({
            id: sequentialThinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            parentId: agentNodeId,
            level: agentNumber === 0 ? 2 : 5,
            status: 'running',
            data: {
                eventType: 'execution.assistant_message_start',
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                agentNumber: agentNumber,
                round: round,
                label: `Agent ${agentNumber} Thinking Round ${round}`
            },
            connections: connections
        } as any);

        return node as WorkflowNode;
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
                eventType: TOOL_EVENTS.CALL_START,
                toolName: String(data.toolName || 'unknown_tool'),
                executionId: String(data.executionId || 'unknown'),
                parameters: data.parameters
            },
            timestamp: Date.now(),
            connections: []
        };
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
        const responseNodeId = `response_${String(data.sourceId)}_${new Date().getTime()}`;
        this.workflowLogger.debug(`🎯 [DYNAMIC-RESPONSE] Creating dynamic response node ${responseNodeId} for agent ${data.sourceId}`);
        const connections: WorkflowConnection[] = [{
            fromId: thinkingNodeId,
            toId: responseNodeId,
            type: 'return' as const,
            label: `Agent ${agentNumber} result`
        }];
        this.workflowLogger.debug(`✅ [DYNAMIC-RESPONSE] Connection created: ${thinkingNodeId} → ${responseNodeId}`);

        return {
            id: responseNodeId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            parentId: agentNodeId,
            level: data.executionLevel || 3,
            status: 'completed',
            data: {
                eventType: EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
                sourceId: data.sourceId,
                sourceType: 'agent',
                result: data.result,
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Response`
            },
            timestamp: Date.now(),
            connections: connections
        };
    }

    private async createToolResultNode(data: ServiceEventData, parentThinkingNodeId: string): Promise<WorkflowNode> {
        const nodeId = `tool_result_for_${parentThinkingNodeId}`;

        // 🚀 NEW: NodeEdgeManager를 통한 노드 생성
        const node = this.nodeEdgeManager.addNode({
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
            connections: []
        } as any);

        return node as WorkflowNode;
    }

    private nodeExists(nodeId: string): boolean {
        return this.agentNodeIdMap.has(nodeId) ||
            nodeId.startsWith('agent_') ||
            nodeId.startsWith('tool_response_');
    }

    private createToolCallResponseNode(data: ServiceEventData): WorkflowNode {
        const finalExecutionId = data.executionId || data.metadata?.executionId || `generated_${Date.now()}`;

        // 🎯 [NODE-CREATION-FIX] NodeEdgeManager를 통한 노드 생성으로 nodeMap 등록 보장
        const node = this.nodeEdgeManager.addNode({
            id: `tool_response_${finalExecutionId}`,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE,
            // 🎯 [RULE-7-SINGLE-PATH] parentId 제거 - tool_call과 자동 연결 방지
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
        }); // 🎯 [RULE-7-FIX] parentNodeId 제거 - tool_call과 자동 연결 방지

        return node as WorkflowNode;
    }

    private connectToolCallToAgent(data: ServiceEventData): void {
        // parentExecutionId는 실제로 tool call ID (예: call_O1co8MrKSUBCaSIrh1Oh3eAK)
        const toolCallNodeId = `tool_call_${data.parentExecutionId}`;

        // sourceId를 이용해 agent node ID 찾기
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));

        if (!agentNodeId) {
            this.workflowLogger.warn(`⚠️ [TOOL-AGENT-FAIL] No agent node found for sourceId: ${data.sourceId}`);
            return;
        }

        const toolCallNode = this.nodeMap.get(toolCallNodeId);
        const agentNode = this.nodeMap.get(agentNodeId);

        if (toolCallNode && agentNode) {
            // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
            try {
                const edge = this.nodeEdgeManager.addEdge(toolCallNodeId, agentNodeId, 'creates', 'creates agent');
                this.workflowLogger.debug(`🔗 [TOOL-AGENT] Connected ${toolCallNodeId} → ${agentNodeId} via NodeEdgeManager`);
            } catch (error) {
                this.workflowLogger.warn(`⚠️ [TOOL-AGENT-FAIL] Failed to connect ${toolCallNodeId} → ${agentNodeId}: ${error}`);
            }
        } else {
            this.workflowLogger.warn(`⚠️ [TOOL-AGENT-FAIL] Nodes not found - toolCall: ${!!toolCallNode}, agent: ${!!agentNode}`);
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

        // 🎯 [CRITICAL-FIX] NodeEdgeManager에도 등록 (create 액션만)
        if (action === 'create') {
            // 🎯 [DUPLICATE-FIX] NodeEdgeManager 등록은 직접 호출에서만 수행
            // emitNodeUpdate는 workflow builder로의 이벤트 전달만 담당
            // NodeEdgeManager.addNode가 이미 호출된 경우 중복 등록 방지
            if (!this.nodeEdgeManager.hasNode(node.id)) {
                this.workflowLogger.debug(`⚠️ [NODE-SYNC-SKIP] Node ${node.id} not in NodeEdgeManager - likely legacy creation path`);
            } else {
                this.workflowLogger.debug(`✅ [NODE-SYNC] Node ${node.id} already in NodeEdgeManager - skipping duplicate registration`);
            }
        }

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

    // 📦 Phase 1: 레거시 호환성을 위한 동기화
    getAllNodes(): WorkflowNode[] {
        // 🚀 NodeEdgeManager에서 노드 가져오기 (새로운 소스)
        const nodeManagerNodes = this.nodeEdgeManager.getAllNodes();

        // 📦 레거시 nodeMap과 동기화 (임시)
        nodeManagerNodes.forEach((node: any) => {
            if (!this.nodeMap.has(node.id)) {
                this.nodeMap.set(node.id, node as WorkflowNode);
            }
        });

        return nodeManagerNodes as WorkflowNode[];
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

    /**
     * 🚀 NodeEdgeManager에서 생성된 실제 edges 반환 (컨버터 우회)
     * 실시간 데이터 생성 목표에 맞춰 컨버터 의존성 제거
     */
    getNodeEdgeManagerEdges(): UniversalWorkflowEdge[] {
        return this.nodeEdgeManager.getAllEdges();
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
                // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
                try {
                    const edge = this.nodeEdgeManager.addEdge(integrationInstanceId, node.id, 'analyze', 'Final integration processing');
                    // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨
                    this.workflowLogger.debug(`🔗 [INTEGRATION] Connected ${integrationInstanceId} → ${node.id} via NodeEdgeManager`);
                } catch (error) {
                    this.workflowLogger.warn(`⚠️ [INTEGRATION-FAIL] Failed to connect ${integrationInstanceId} → ${node.id}: ${error}`);
                }
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
                // 🚀 Rule 11 Sequential Order: Direct NodeEdgeManager usage
                try {
                    const edge = this.nodeEdgeManager.addEdge(responseId, integrationInstanceId, 'integrates', 'Integration into final processing');
                    // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨
                    this.workflowLogger.debug(`🔗 [RESPONSE-INTEGRATION] Connected ${responseId} → ${integrationInstanceId} via NodeEdgeManager`);
                } catch (error) {
                    this.workflowLogger.warn(`⚠️ [RESPONSE-INTEGRATION-FAIL] Failed to connect ${responseId} → ${integrationInstanceId}: ${error}`);
                }
            }
        });
    }

    private handleTeamAnalysisComplete(data: ServiceEventData): void {
        this.workflowLogger.debug(`🔔 [WorkflowEventSubscriber] Processing team.analysis_complete event`);
        // 🎯 [LEGACY-REMOVAL] Response node는 execution.assistant_message_complete에서만 생성
        // team.analysis_complete는 agent 완료 로깅만 수행
        this.workflowLogger.info(`✅ [TEAM-ANALYSIS-COMPLETE] Agent ${data.sourceId} completed team analysis`);
    }

    // 📦 Phase 1: 레거시 호환성 래퍼 (임시)
    private connectNodes(fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string): void {
        // 🚀 NodeEdgeManager로 위임
        const edge = this.nodeEdgeManager.connectNodes(fromNode, toNode, type, label);

        // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨

        this.workflowLogger.debug(`🔗 [LEGACY-WRAPPER] Connected ${fromNode.id} -> ${toNode.id} (${type}) via NodeEdgeManager`);
    }

    // 📦 Phase 1: 레거시 호환성 래퍼 (임시)
    private connectNodesById(fromId: string, toId: string, type: WorkflowConnectionType, label?: string): void {
        // 🚀 NodeEdgeManager로 직접 위임
        try {
            const edge = this.nodeEdgeManager.addEdge(fromId, toId, type, label);

            // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨

            this.workflowLogger.debug(`🔗 [LEGACY-WRAPPER-ID] Connected ${fromId} -> ${toId} (${type}) via NodeEdgeManager`);
        } catch (error) {
            this.workflowLogger.error(`❌ [LEGACY-WRAPPER-ID] Failed to connect ${fromId} -> ${toId}: ${error}`);
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
     * 🎯 [LEGACY-REMOVAL] NodeEdgeManager에서 모든 데이터 가져오기 (레거시 nodeMap 제거)
     */
    public getWorkflowData(): { nodes: WorkflowNode[], edges: UniversalWorkflowEdge[] } {
        return {
            nodes: this.nodeEdgeManager.getAllNodes(), // 🚀 새 아키텍처: NodeEdgeManager에서 nodes 가져오기
            edges: this.nodeEdgeManager.getAllEdges() // ✅ 새 아키텍처: NodeEdgeManager에서 edges 가져오기
        };
    }

    /**
     * 디버깅을 위한 연결 상태 요약 반환
     */
    public getConnectionSummary(): { totalNodes: number, totalEdges: number, edgesByType: Record<string, number> } {
        const edges = this.nodeEdgeManager.getAllEdges(); // ✅ NodeEdgeManager 완전 통합
        const edgesByType: Record<string, number> = {};
        edges.forEach(edge => {
            edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
        });

        return {
            totalNodes: this.nodeMap.size,
            totalEdges: edges.length,
            edgesByType
        };
    }

    /**
     * Fork 패턴에서 엣지를 큐에 추가하고 완료 타이머 설정 (Rule 11 Sequential Order 준수)
     * + 실시간 플레이그라운드 업데이트
     */
    private addToForkEdgeQueue(thinkingNodeId: string, fromNode: WorkflowNode, toNode: WorkflowNode, type: WorkflowConnectionType, label?: string): void {
        // 🎯 NodeEdgeManager 순차 큐에 의존: Edge 생성 지연하지 않고 바로 큐에 위임
        // Target node가 아직 생성 중이라면 NodeEdgeManager 큐에서 순서 보장
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
        // 🚀 Rule 11 Sequential Order: Use NodeEdgeManager with internal queue for proper order
        try {
            // 🎯 NodeEdgeManager 순차 큐가 모든 순서를 보장하므로 즉시 호출
            const edge = this.nodeEdgeManager.addEdge(fromNode.id, toNode.id, type, label);

            // ✅ NodeEdgeManager 완전 통합: legacy 동기화 제거됨
            this.workflowLogger.debug(`🔗 [REAL-TIME-NODEMANAGER] Added edge via NodeEdgeManager: ${fromNode.id} → ${toNode.id} (${type})`);

            // 기존 node.connections도 호환성을 위해 유지
            if (!fromNode.connections.some(c => c.toId === toNode.id)) {
                fromNode.connections.push({ fromId: fromNode.id, toId: toNode.id, type, label });
                this.emitNodeUpdate('update', fromNode); // 즉시 플레이그라운드 업데이트
            }

            this.workflowLogger.debug(`⚡ [REAL-TIME-PERMANENT] Created permanent edge via NodeEdgeManager: ${fromNode.id} → ${toNode.id} (${type})`);
        } catch (error) {
            // 🚨 Edge order violation이나 기타 오류 처리
            this.workflowLogger.warn(`⚠️ [REAL-TIME-EDGE-FAIL] Failed to create edge via NodeEdgeManager: ${fromNode.id} → ${toNode.id} (${type}): ${error}`);
        }
    }

    /**
     * 🎯 [HELPER] tool_call ID로 연결된 agent 노드 찾기
     */
    private findAgentByToolCall(toolCallId: string): string | undefined {
        // tool_call_call_XXX → agent_X_copy_Y 연결 찾기
        const toolCallNodeId = `tool_call_${toolCallId}`;
        const edges = this.nodeEdgeManager.getAllEdges();

        for (const edge of edges) {
            if (edge.source === toolCallNodeId && edge.type === 'creates') {
                this.workflowLogger.debug(`🔍 [HELPER] Found agent ${edge.target} for tool_call ${toolCallNodeId}`);
                return edge.target; // agent_2_copy_1
            }
        }

        this.workflowLogger.debug(`⚠️ [HELPER] No agent found for tool_call ${toolCallNodeId}`);
        return undefined;
    }

    /**
     * 🎯 [HELPER] agent 노드의 최신 response 찾기
     */
    private findLatestResponseByAgent(agentNodeId: string): string | undefined {
        // agent_response_agent_2_copy_1_* 패턴으로 최신 response 찾기
        const responsePattern = `agent_response_${agentNodeId}_`;
        let latestResponse: string | undefined;
        let latestTimestamp = 0;

        const nodes = this.nodeEdgeManager.getAllNodes();
        for (const node of nodes) {
            if (node.id.startsWith(responsePattern) && node.type === 'response') {
                const timestamp = node.timestamp || 0;
                if (timestamp > latestTimestamp) {
                    latestTimestamp = timestamp;
                    latestResponse = node.id;
                }
            }
        }

        if (latestResponse) {
            this.workflowLogger.debug(`🔍 [HELPER] Found latest response ${latestResponse} for agent ${agentNodeId} (timestamp: ${latestTimestamp})`);
        } else {
            this.workflowLogger.debug(`⚠️ [HELPER] No response found for agent ${agentNodeId} with pattern ${responsePattern}`);
        }

        return latestResponse;
    }
}
