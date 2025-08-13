// Agent Event Handler - Agent domain events processing
// Migrated from workflow-event-subscriber.ts

import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
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

/**
 * Agent Event Handler
 * Handles all agent-related events: creation, execution, thinking, responses
 */
export class AgentEventHandler implements EventHandler {
    readonly name = 'AgentEventHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = ['agent.*', 'execution.start', 'execution.assistant_message_start', 'execution.assistant_message_complete'];

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
            eventType === 'execution.start' ||
            eventType === 'execution.assistant_message_start' ||
            eventType === 'execution.assistant_message_complete';
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
                case 'agent.created':
                    // Do not create standalone agent nodes (domain-neutral minimal graph)
                    // Keep internal mapping only if needed later
                    break;

                case 'execution.start': {
                    // Create agent node for this execution only if not already created by team flow
                    const existing = this.agentNodeIdMap.get(String(data.sourceId));
                    if (existing) {
                        if (data.executionId) {
                            WorkflowState.setAgentForExecution(String(data.executionId), existing);
                        }
                        break;
                    }
                    const agentNode = this.createAgentNode(data);
                    if (data.parentExecutionId) {
                        (agentNode as any).parentId = String(data.parentExecutionId);
                    }
                    updates.push({ action: 'create', node: agentNode });
                    // Explicit edge creation (no prevId)
                    const rootId = String((data as any).rootExecutionId || data.sourceId || '');
                    let edgeSource: string | undefined;
                    let edgeType: any = 'receives';
                    if (data.parentExecutionId) {
                        edgeSource = String(data.parentExecutionId);
                        edgeType = 'creates';
                    } else {
                        const rootUser = WorkflowState.getRootUserMessage(rootId);
                        if (rootUser) edgeSource = rootUser;
                        if (!edgeSource) {
                            const lastUser = WorkflowState.getLastUserMessage(rootId) || WorkflowState.getLastUserMessage(String(data.executionId || ''));
                            if (lastUser) edgeSource = lastUser;
                        }
                    }
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
                    // Link delegated agent execution to its creating tool_call for precise response→tool_response mapping
                    if (data.executionId && data.parentExecutionId) {
                        WorkflowState.setToolCallForAgentExecution(String(data.executionId), String(data.parentExecutionId));
                    }
                    if (data.rootExecutionId || data.sourceId) {
                        WorkflowState.setAgentForRoot(String(data.rootExecutionId || data.sourceId), agentNode.id);
                    }
                    // Register for cross-handler reference
                    {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const subscriber = (this as any).subscriber as { registerNode?: (k: string, id: string) => void } | undefined;
                        subscriber?.registerNode?.(`agentFor:${String(data.sourceId)}`, agentNode.id);
                    }
                    break;
                }

                case 'execution.assistant_message_start': {
                    // Create thinking node and record it to WorkflowState for tool.prev resolution
                    const thinkingNode = this.createAgentThinkingNode(data);
                    updates.push({ action: 'create', node: thinkingNode });
                    // Explicit edge: from last aggregation → thinking (analyze) OR user_message → thinking (processes)
                    const fallbackPrev = WorkflowState.getLastAggregation(data.parentExecutionId || data.executionId);
                    let sourceForThinking: string | undefined = fallbackPrev;
                    let typeForThinking: any = fallbackPrev ? 'analyze' : 'processes';
                    if (!sourceForThinking) {
                        const rootId = String((data as any).rootExecutionId || data.sourceId || '');
                        sourceForThinking = WorkflowState.getRootUserMessage(rootId)
                            || WorkflowState.getLastUserMessage(rootId)
                            || WorkflowState.getLastUserMessage(String(data.executionId || ''));
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
                    // Save for subsequent tool calls
                    WorkflowState.setLastAssistantStart(String(data.parentExecutionId || data.executionId), thinkingNode.id);
                    // Also expose thinking → last response mapping anchor reset
                    WorkflowState.setLastResponseForThinking(thinkingNode.id, '');
                    // Record latest thinking for this source to allow response to link back even if start event wasn't captured by WorkflowState
                    try {
                        const roundKey = this.createThinkingRoundKey(data, (thinkingNode as any)?.timestamp ?? Date.now());
                        this.agentToThinkingMap.set(roundKey, thinkingNode.id);
                    } catch { }
                    break;
                }

                case 'execution.assistant_message_complete': {
                    const responseNode = this.createAgentResponseNode(data);
                    updates.push({ action: 'create', node: responseNode });
                    // Explicit edge: thinking → response ('return')
                    const thinkingForResponse =
                        WorkflowState.getLastAssistantStart(data.executionId) ||
                        WorkflowState.getLastAssistantStart(data.parentExecutionId || undefined);
                    if (thinkingForResponse) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(thinkingForResponse, responseNode.id, 'return' as any),
                            source: thinkingForResponse,
                            target: responseNode.id,
                            type: 'return' as any,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }
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

        // For execution.start events, create agent node
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
                eventType: 'execution.start',
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

    private createAgentThinkingNode(data: any): WorkflowNode {
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        const providedThinkingId = data?.metadata?.thinkingNodeId as string | undefined;
        const agentNodeId = this.agentNodeIdMap.get(String(data.sourceId));
        const fallbackThinkingId = agentNodeId ? `thinking_${agentNodeId}` : `thinking_agent_${agentNumber}`;
        const thinkingId = providedThinkingId || fallbackThinkingId;

        return {
            id: thinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            level: (data.executionLevel || 1) + 1,
            status: 'running',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                eventType: 'execution.assistant_message_start',
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
        // Path-Only: standardize response id to be deterministic by executionId
        const responseId = `response_${data.executionId || Date.now()}`;

        return {
            id: responseId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            level: (data.executionLevel || 1) + 2,
            status: 'completed',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                eventType: 'execution.assistant_message_complete',
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
