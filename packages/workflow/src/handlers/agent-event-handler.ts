// Agent Event Handler - Agent domain events processing
// Migrated from workflow-event-subscriber.ts

import { SimpleLogger, SilentLogger, AGENT_EVENTS } from '@robota-sdk/agents';
import type {
    EventHandler,
    EventData,
    EventProcessingResult
} from '../interfaces/event-handler.js';
import { HandlerPriority } from '../interfaces/event-handler.js';
import type { WorkflowNode } from '../interfaces/workflow-node.js';
import type { WorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { WorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { WorkflowState } from '../services/workflow-state.js';

// 🎯 [EVENT-CONSTANTS] Import execution events from ExecutionService
const EXECUTION_EVENTS = {
    START: 'execution.start',
    ASSISTANT_MESSAGE_START: 'execution.assistant_message_start',
    ASSISTANT_MESSAGE_COMPLETE: 'execution.assistant_message_complete'
} as const;

/**
 * Agent Event Handler
 * Handles all agent-related events: creation, execution, thinking, responses
 */
export class AgentEventHandler implements EventHandler {
    readonly name = 'AgentEventHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = ['agent.*', EXECUTION_EVENTS.START, EXECUTION_EVENTS.ASSISTANT_MESSAGE_START, EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE];

    private logger: SimpleLogger;
    private agentNodeIdMap = new Map<string, string>(); // sourceId → agentNodeId
    private agentNumberMap = new Map<string, number>(); // sourceId → agentNumber
    private agentToThinkingMap = new Map<string, string>(); // "sourceId:executionId:timestamp" → thinkingNodeId
    private agentCopyCounters = new Map<number, number>(); // agentNumber → copy counter
    private conversationIdToAgentIdMap = new Map<string, string>(); // conversationId → sourceId

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    canHandle(eventType: string): boolean {
        return eventType.startsWith('agent.') ||
            eventType === EXECUTION_EVENTS.START ||
            eventType === EXECUTION_EVENTS.ASSISTANT_MESSAGE_START ||
            eventType === EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE;
    }



    async handle(
        eventType: string,
        eventData: EventData
    ): Promise<EventProcessingResult> {
        try {
            const data = eventData as any; // Type assertion for flexibility

            this.logger.debug(`🔔 [AGENT-HANDLER] Processing ${eventType}`, {
                sourceId: data.sourceId,
                executionId: data.executionId
            });

            const updates: WorkflowUpdate[] = [];
            let success = true;

            switch (eventType) {
                case AGENT_EVENTS.CREATED: {
                    // Create Agent node on creation event and connect via path-only rules
                    const existing = this.agentNodeIdMap.get(String(data.sourceId));
                    if (existing) {
                        break; // Already created for this sourceId
                    }
                    const agentNode = this.createAgentNode({ ...data, executionLevel: data.executionLevel || 1 });
                    // Parent/edge derivation (mirrors prior execution.start behavior)
                    const rootId = String((data as any).rootExecutionId || data.sourceId || '');
                    let edgeSource: string | undefined;
                    let edgeType: any = 'receives';
                    if (data.parentExecutionId) {
                        edgeSource = String(data.parentExecutionId);
                        edgeType = 'creates';
                    } else {
                        const lastUser = WorkflowState.getLastUserMessage(rootId) || WorkflowState.getLastUserMessage(String(data.executionId || ''));
                        if (lastUser) edgeSource = lastUser;
                    }

                    updates.push({ action: 'create', node: agentNode });
                    if (edgeSource) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(edgeSource, agentNode.id, edgeType),
                            source: edgeSource,
                            target: agentNode.id,
                            type: edgeType,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }

                    this.agentNodeIdMap.set(String(data.sourceId), agentNode.id);
                    if (data.executionId) {
                        WorkflowState.setAgentForExecution(String(data.executionId), agentNode.id);
                    }
                    if (rootId) {
                        WorkflowState.setAgentForRoot(rootId, agentNode.id);
                    }
                    // Register for cross-handler reference
                    {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const subscriber = (this as any).subscriber as { registerNode?: (k: string, id: string) => void } | undefined;
                        subscriber?.registerNode?.(`agentFor:${String(data.sourceId)}`, agentNode.id);
                    }
                    break;
                }

                case EXECUTION_EVENTS.START: {
                    // Execution start must NOT create new agent nodes. Only map execution → existing agent.
                    const existing = this.agentNodeIdMap.get(String(data.sourceId));
                    if (existing && data.executionId) {
                        WorkflowState.setAgentForExecution(String(data.executionId), existing);
                    }
                    // If no existing agent, do nothing (strict: agent.created must precede)
                    break;
                }

                case AGENT_EVENTS.EXECUTION_START: {
                    // Status transition only; no node creation
                    const existing = this.agentNodeIdMap.get(String(data.sourceId));
                    if (existing && data.executionId) {
                        WorkflowState.setAgentForExecution(String(data.executionId), existing);
                    }
                    break;
                }

                case AGENT_EVENTS.EXECUTION_COMPLETE: {
                    // No node creation; could update status if needed via separate update path
                    break;
                }

                case AGENT_EVENTS.EXECUTION_ERROR: {
                    // No node creation; error state handled elsewhere
                    break;
                }

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_START: {
                    // Determine scope-local aggregation (Path-Only) BEFORE creating the thinking node, to set a strictly increasing timestamp
                    const pathArr = (data as any)?.path as string[] | undefined;
                    const pathThinkingId = Array.isArray(pathArr) && pathArr.length >= 2
                        ? String(pathArr[1])
                        : undefined;

                    let sourceForThinking: string | undefined;
                    let typeForThinking: any = 'processes';
                    let baseTimestamp = Date.now();

                    try {
                        const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                        const parentExecId = String((data as any)?.parentExecutionId || (data as any)?.executionId || '');
                        let latestAgg: { id: string; ts: number } | undefined;
                        if (parentExecId) {
                            for (const n of nodesAccessor) {
                                if (n?.type === WORKFLOW_NODE_TYPES.TOOL_RESULT) {
                                    const orig = n?.data?.extensions?.robota?.originalEvent;
                                    const sameScope = String(orig?.parentExecutionId || '') === parentExecId;
                                    if (sameScope) {
                                        const ts = Number(n?.timestamp || 0);
                                        if (!latestAgg || ts > latestAgg.ts) {
                                            latestAgg = { id: String(n.id), ts };
                                        }
                                    }
                                }
                            }
                        }
                        if (latestAgg) {
                            sourceForThinking = latestAgg.id;
                            typeForThinking = 'analyze';
                            // Ensure thinking timestamp is strictly after aggregation
                            baseTimestamp = Math.max(baseTimestamp, latestAgg.ts + 1);
                        }
                    } catch { /* read-only scan; ignore errors */ }

                    // Create thinking node with monotonic timestamp (no external waits; purely internal ordering)
                    const thinkingNode = this.createAgentThinkingNode(data, pathThinkingId, baseTimestamp);
                    updates.push({ action: 'create', node: thinkingNode });

                    if (!sourceForThinking) {
                        const rootId = String((data as any).rootExecutionId || data.sourceId || '');
                        sourceForThinking = WorkflowState.getLastUserMessage(rootId)
                            || WorkflowState.getLastUserMessage(String((data as any).executionId || ''));
                    }
                    if (sourceForThinking) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(sourceForThinking, thinkingNode.id, typeForThinking),
                            source: sourceForThinking,
                            target: thinkingNode.id,
                            type: typeForThinking,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }
                    try {
                        const roundKey = this.createThinkingRoundKey(data, (thinkingNode as any)?.timestamp ?? Date.now());
                        this.agentToThinkingMap.set(roundKey, thinkingNode.id);
                    } catch { }
                    break;
                }

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE: {
                    // Path-only response creation: path = [root, thinkingId, responseExecId]
                    const pathArr = (data as any)?.path as string[] | undefined;
                    if (!Array.isArray(pathArr) || pathArr.length < 2) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Invalid path for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE}: ${JSON.stringify(pathArr)}`]
                        };
                    }
                    const thinkingId = String(pathArr[pathArr.length - 2]);
                    const responseId = String(pathArr[pathArr.length - 1] || data.executionId || data.sourceId);

                    // Strict path-only: thinking node MUST exist (no fallback creation)
                    const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                    const thinkingExists = nodesAccessor.some(n => n?.id === thinkingId);
                    if (!thinkingExists) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] thinking node '${thinkingId}' not found. Must be created by ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_START} first. No fallback creation allowed.`]
                        };
                    }

                    const responseNode: WorkflowNode = {
                        id: responseId,
                        type: WORKFLOW_NODE_TYPES.RESPONSE,
                        level: (data.executionLevel || 1) + 2,
                        status: 'completed',
                        timestamp: Date.now(),
                        data: {
                            eventType: EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
                            sourceId: String(data.sourceId),
                            sourceType: 'agent',
                            agentNumber: this.agentNumberMap.get(String(data.sourceId)) || 0,
                            label: `Agent Response`,
                            description: 'Agent response and output',
                            extensions: { robota: { originalEvent: data } }
                        },
                        connections: []
                    } as any;

                    updates.push({ action: 'create', node: responseNode });

                    if (thinkingId) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(thinkingId, responseId, 'return' as any),
                            source: thinkingId,
                            target: responseId,
                            type: 'return' as any,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }

                    // Path-only: no WorkflowState mappings needed

                    break;
                }

                // execution.* events are handled by ExecutionEventHandler

                default:
                    this.logger.warn(`⚠️ [AGENT-HANDLER] Unhandled event type: ${eventType}`);
                    success = false;
            }

            return {
                success,
                updates,
                metadata: {
                    handlerType: 'agent',
                    eventType,
                    processed: true
                }
            };

        } catch (error) {
            this.logger.error(`❌ [AGENT-HANDLER] Error handling ${eventType}:`, error);
            return {
                success: false,
                updates: [],
                errors: [`Error handling ${eventType}: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerType: 'agent',
                    eventType,
                    error: true
                }
            };
        }
    }

    // =================================================================
    // Agent Event Handling Methods
    // =================================================================

    private createExecutionStartNode(data: any): WorkflowNode {
        this.logger.debug('🚀 [EXECUTION-START]', {
            sourceId: data.sourceId,
            executionLevel: data.executionLevel
        });

        // For execution start events, create agent node
        return this.createAgentNode(data);
    }

    // =================================================================
    // Node Creation Helper Methods
    // =================================================================

    private createAgentNode(data: any): WorkflowNode {
        const agentNumber = this.assignAgentNumber(String(data.sourceId));
        const copyNumber = this.getNextCopyNumber(agentNumber);
        const agentId = `agent_${agentNumber}_copy_${copyNumber}`;

        return {
            id: agentId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: data.executionLevel || 1,
            status: 'running',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                eventType: EXECUTION_EVENTS.START,
                sourceId: data.sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                copyNumber: copyNumber,
                label: `Agent ${agentNumber}`,
                description: 'AI Agent instance',
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                reservedThinkingId: `thinking_${agentId}`,
                extensions: {
                    robota: {
                        originalEvent: data,
                        agentNumber: agentNumber
                    }
                }
            },
            connections: []
        };
    }

    private createAgentThinkingNode(data: any, overrideId?: string, forcedTimestamp?: number): WorkflowNode {
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        const providedThinkingId = data?.metadata?.thinkingNodeId as string | undefined;
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const fallbackThinkingId = agentNodeId ? `thinking_${agentNodeId}` : `thinking_agent_${agentNumber}`;
        const thinkingId = overrideId || providedThinkingId || fallbackThinkingId;

        return {
            id: thinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            level: (data.executionLevel || 1) + 1,
            status: 'running',
            timestamp: typeof forcedTimestamp === 'number' ? forcedTimestamp : Date.now(),
            data: {
                eventType: EXECUTION_EVENTS.ASSISTANT_MESSAGE_START,
                sourceId: data.sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Thinking`,
                description: 'Agent processing and reasoning',
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                extensions: {
                    robota: {
                        originalEvent: data,
                        agentNumber: agentNumber
                    }
                }
            },
            connections: []
        };
    }

    private createAgentResponseNode(data: any): WorkflowNode {
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        // Path-Only: response id = path tail (required)
        const tail = Array.isArray(data.path) && data.path.length > 0 ? String(data.path[data.path.length - 1]) : String(data.executionId || '');
        const responseId = tail;

        return {
            id: responseId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            level: (data.executionLevel || 1) + 2,
            status: 'completed',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                eventType: EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
                sourceId: data.sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Response`,
                description: 'Agent response and output',
                response: data.content || data.message || '',
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                extensions: {
                    robota: {
                        originalEvent: data,
                        agentNumber: agentNumber
                    }
                }
            },
            connections: []
        };
    }

    // =================================================================
    // Helper Methods
    // =================================================================

    /**
     * Create round-safe key for thinking node mapping
     * Format: "sourceId:executionId:timestamp"
     */
    private createThinkingRoundKey(data: any, timestamp: number): string {
        const sourceId = String(data.sourceId);
        const executionId = String(data.executionId || data.messageId || timestamp);
        return `${sourceId}:${executionId}:${timestamp}`;
    }

    /**
     * Find matching thinking round key for response
     * Searches for most recent thinking node for the same sourceId
     */
    private findMatchingThinkingRoundKey(data: any): string | undefined {
        const sourceId = String(data.sourceId);
        const targetExecutionId = String(data.executionId || data.messageId || '');

        let bestMatch: { key: string; timestamp: number } | undefined;

        // Find the most recent thinking node for this sourceId
        for (const [key, nodeId] of this.agentToThinkingMap.entries()) {
            const [keySourceId, keyExecutionId, keyTimestamp] = key.split(':');

            if (keySourceId === sourceId) {
                const timestamp = parseInt(keyTimestamp, 10);

                // Prefer exact executionId match, otherwise use most recent
                if (keyExecutionId === targetExecutionId) {
                    return key; // Exact match found
                }

                if (!bestMatch || timestamp > bestMatch.timestamp) {
                    bestMatch = { key, timestamp };
                }
            }
        }

        this.logger.debug(`🔍 [THINKING-ROUND-SEARCH] For sourceId: ${sourceId}, executionId: ${targetExecutionId}, found: ${bestMatch?.key || 'none'}`);
        return bestMatch?.key;
    }

    private assignAgentNumber(sourceId: string): number {
        // Check if already assigned
        const existing = this.agentNumberMap.get(sourceId);
        if (existing !== undefined) {
            return existing;
        }

        // Find next available agent number
        const usedNumbers = new Set(this.agentNumberMap.values());
        let agentNumber = 0;
        while (usedNumbers.has(agentNumber)) {
            agentNumber++;
        }

        this.agentNumberMap.set(sourceId, agentNumber);
        this.logger.debug(`🔢 [AGENT-NUMBER] Assigned agent number ${agentNumber} to ${sourceId}`);

        return agentNumber;
    }

    private getNextCopyNumber(agentNumber: number): number {
        const current = this.agentCopyCounters.get(agentNumber) ?? 0;
        const next = current + 1;
        this.agentCopyCounters.set(agentNumber, next);
        return next;
    }

    // =================================================================
    // Public Query Methods
    // =================================================================

    getAgentNodeId(sourceId: string): string | undefined {
        return this.agentNodeIdMap.get(sourceId);
    }

    getAgentNumber(sourceId: string): number | undefined {
        return this.agentNumberMap.get(sourceId);
    }

    getThinkingNodeId(sourceId: string): string | undefined {
        // Find most recent thinking node for this sourceId
        let latestThinking: { nodeId: string; timestamp: number } | undefined;

        for (const [key, nodeId] of this.agentToThinkingMap.entries()) {
            const [keySourceId, , keyTimestamp] = key.split(':');

            if (keySourceId === sourceId) {
                const timestamp = parseInt(keyTimestamp, 10);
                if (!latestThinking || timestamp > latestThinking.timestamp) {
                    latestThinking = { nodeId, timestamp };
                }
            }
        }

        return latestThinking?.nodeId;
    }

    getAllAgentMappings(): {
        agentNodes: Map<string, string>;
        agentNumbers: Map<string, number>;
        thinkingNodes: Map<string, string>;
    } {
        return {
            agentNodes: new Map(this.agentNodeIdMap),
            agentNumbers: new Map(this.agentNumberMap),
            thinkingNodes: new Map(this.agentToThinkingMap)
        };
    }

    clear(): void {
        this.agentNodeIdMap.clear();
        this.agentNumberMap.clear();
        this.agentToThinkingMap.clear();
        this.conversationIdToAgentIdMap.clear();
        this.logger.debug('🧹 [AGENT-HANDLER] All mappings cleared');
    }
}
