// Agent Event Handler - Agent domain events processing
// Migrated from workflow-event-subscriber.ts

import { SimpleLogger, SilentLogger, AGENT_EVENTS, EXECUTION_EVENTS } from '@robota-sdk/agents';
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
    // Path-only: do not keep auxiliary mappings for relationship derivation.
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
                    const pathInfo = this.extractPathInfo(data, AGENT_EVENTS.CREATED);
                    const existing = this.agentNodeIdMap.get(String(data.sourceId));
                    if (existing) {
                        break; // Already created for this sourceId
                    }
                    const agentNode = this.createAgentNode({ ...data }, pathInfo);
                    const rootId = pathInfo.rootId || String(data.sourceId || '');

                    updates.push({ action: 'create', node: agentNode });
                    // Root agent creation can legitimately have no parent segment.
                    // In that case, the agent becomes the start node and later events will connect the flow.
                    if (!pathInfo.parentId) {
                        this.agentNodeIdMap.set(String(data.sourceId), agentNode.id);
                        {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const subscriber = (this as any).subscriber as { registerNode?: (k: string, id: string) => void } | undefined;
                            subscriber?.registerNode?.(`agentFor:${String(data.sourceId)}`, agentNode.id);
                        }
                        break;
                    }

                    const edge: WorkflowEdge = {
                        id: EdgeUtils.generateId(pathInfo.parentId, agentNode.id, 'creates' as any),
                        source: pathInfo.parentId,
                        target: agentNode.id,
                        type: 'creates' as any,
                        timestamp: Date.now()
                    } as any;
                    updates.push({ action: 'create', edge } as any);

                    this.agentNodeIdMap.set(String(data.sourceId), agentNode.id);
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
                    void this.agentNodeIdMap;
                    // If no existing agent, do nothing (strict: agent.created must precede)
                    break;
                }

                case AGENT_EVENTS.EXECUTION_START: {
                    const sourceId = typeof data?.sourceId !== 'undefined' ? String(data.sourceId) : '';
                    if (!sourceId) {
                        this.logger.warn('⚠️ [AGENT-HANDLER] execution_start received without sourceId. Skipping state update.');
                        break;
                    }

                    const pathInfo = this.extractPathInfo(data, AGENT_EVENTS.EXECUTION_START);
                    const existingAgentNodeId = this.findAgentNodeIdForExecutionStart(data, pathInfo);
                    if (existingAgentNodeId) {
                        const updatedNode = this.buildAgentExecutionStateUpdate(existingAgentNodeId, data);
                        if (updatedNode) {
                            updates.push({ action: 'update', node: updatedNode } as WorkflowUpdate);
                        }

                        this.agentNodeIdMap.set(sourceId, existingAgentNodeId);
                        break;
                    }

                    return {
                        success: false,
                        updates: [],
                        errors: [
                            `[PATH-ONLY] Missing agent node for ${AGENT_EVENTS.EXECUTION_START} path=${pathInfo.segments.join(' -> ')}`
                        ]
                    };
                }

                case AGENT_EVENTS.EXECUTION_COMPLETE: {
                    // No node creation; could update status if needed via separate update path
                    break;
                }

                case AGENT_EVENTS.EXECUTION_ERROR: {
                    // No node creation; error state handled elsewhere
                    break;
                }

                case AGENT_EVENTS.CONFIG_UPDATED: {
                    // Update-only: reflect tools/version on the existing agent node
                    let existingId = this.agentNodeIdMap.get(String(data.sourceId));
                    if (!existingId) {
                        // Path-Only allowed scan: find agent node with matching sourceId in explicit fields
                        try {
                            const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                            const found = nodesAccessor.find(n => n?.type === WORKFLOW_NODE_TYPES.AGENT && String(n?.data?.sourceId) === String(data.sourceId));
                            if (found?.id) existingId = String(found.id);
                        } catch { /* ignore */ }
                        if (!existingId) {
                            break;
                        }
                    }
                    // Merge with existing node to avoid dropping fields
                    try {
                        const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                        const existingNode = nodesAccessor.find(n => String(n?.id) === String(existingId));
                        if (existingNode) {
                            // Preserve existing originalEvent data and merge with new data
                            const existingOriginalEvent = existingNode.data?.extensions?.robota?.originalEvent || {};
                            const mergedOriginalEvent = {
                                ...existingOriginalEvent,
                                ...data,
                                parameters: {
                                    ...(existingOriginalEvent.parameters || {}),
                                    ...(data.parameters || {})
                                }
                            };

                            const merged: WorkflowNode = {
                                ...existingNode,
                                timestamp: Date.now(),
                                data: {
                                    ...(existingNode.data || {}),
                                    extensions: {
                                        robota: {
                                            originalEvent: mergedOriginalEvent
                                        }
                                    },
                                    tools: Array.isArray(data.parameters?.tools) ? data.parameters.tools : (existingNode.data?.tools),
                                    configVersion: typeof data.version === 'number' ? data.version : (existingNode.data as any)?.configVersion
                                }
                            } as any;
                            updates.push({ action: 'update', node: merged } as any);
                        }
                    } catch { /* ignore */ }
                    break;
                }

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_START: {
                    // Determine scope-local aggregation (Path-Only) BEFORE creating the thinking node, to set a strictly increasing timestamp
                    const pathInfo = this.extractPathInfo(data, EXECUTION_EVENTS.ASSISTANT_MESSAGE_START);
                    const pathThinkingId = pathInfo.nodeId;

                    let sourceForThinking: string | undefined;
                    let typeForThinking: any = 'processes';
                    // Ensure the thinking node timestamp is strictly greater than "now" to avoid
                    // same-millisecond collisions with immediately preceding nodes (e.g., tool_result).
                    let baseTimestamp = Date.now() + 1;

                    try {
                        const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                        // Ensure strictly increasing timestamp across relevant scope
                        let maxObservedTs = 0;
                        for (const n of nodesAccessor) {
                            const ts = Number(n?.timestamp || 0);
                            if (ts > maxObservedTs) maxObservedTs = ts;
                        }
                        const parentExecId = pathInfo.parentId;
                        let latestAgg: { id: string; ts: number } | undefined;
                        if (parentExecId) {
                            for (const n of nodesAccessor) {
                                if (n?.type === WORKFLOW_NODE_TYPES.TOOL_RESULT) {
                                    const orig = n?.data?.extensions?.robota?.originalEvent;
                                    const sameScope = (() => {
                                        const op = orig?.context?.ownerPath;
                                        if (!Array.isArray(op) || op.length === 0) return false;
                                        for (let i = op.length - 1; i >= 0; i--) {
                                            const seg = op[i];
                                            if (seg?.type === 'execution') {
                                                return String(seg.id ?? '') === parentExecId;
                                            }
                                        }
                                        return false;
                                    })();
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
                        // Guard against equal-timestamp collisions even if aggregation not detected
                        baseTimestamp = Math.max(baseTimestamp, maxObservedTs + 1);
                    } catch { /* read-only scan; ignore errors */ }

                    // Create thinking node with monotonic timestamp (no external waits; purely internal ordering)
                    const thinkingNode = this.createAgentThinkingNode(data, pathThinkingId, baseTimestamp);
                    updates.push({ action: 'create', node: thinkingNode });

                    if (!sourceForThinking) {
                        const ownerPath = (data as any)?.context?.ownerPath as Array<{ type: string; id: string }> | undefined;
                        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
                            throw new Error(`[PATH-ONLY] Missing context.ownerPath for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_START}`);
                        }
                        const agentId = (() => {
                            for (let i = ownerPath.length - 1; i >= 0; i--) {
                                const seg = ownerPath[i];
                                if (seg?.type === 'agent' && typeof seg.id === 'string' && seg.id.length > 0) return seg.id;
                            }
                            return undefined;
                        })();
                        const executionId = (() => {
                            for (let i = ownerPath.length - 1; i >= 0; i--) {
                                const seg = ownerPath[i];
                                if (seg?.type === 'execution' && typeof seg.id === 'string' && seg.id.length > 0) return seg.id;
                            }
                            return undefined;
                        })();
                        if (!agentId || !executionId) {
                            throw new Error(`[PATH-ONLY] Missing agent/execution segments in context.ownerPath for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_START}`);
                        }

                        // Path-only, no-fallback: find the most recent user_message node within the same execution scope.
                        // Do not rely on WorkflowState or any auxiliary memory.
                        const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
                        let latestUserMessage: { id: string; ts: number } | undefined;
                        for (const n of nodesAccessor) {
                            if (n?.type !== WORKFLOW_NODE_TYPES.USER_MESSAGE) continue;
                            const op = n?.data?.extensions?.robota?.originalEvent?.context?.ownerPath;
                            if (!Array.isArray(op) || op.length === 0) continue;
                            const sameExec = (() => {
                                for (let i = op.length - 1; i >= 0; i--) {
                                    const seg = op[i];
                                    if (seg?.type === 'execution') {
                                        return String(seg.id ?? '') === executionId;
                                    }
                                }
                                return false;
                            })();
                            if (!sameExec) continue;
                            const ts = Number(n?.timestamp || 0);
                            if (!latestUserMessage || ts > latestUserMessage.ts) {
                                latestUserMessage = { id: String(n.id), ts };
                            }
                        }

                        if (!latestUserMessage) {
                            return {
                                success: false,
                                updates: [],
                                errors: [
                                    `[PATH-ONLY] Missing user_message node for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_START}. ` +
                                    `No prior user_message found in execution="${executionId}".`
                                ]
                            };
                        }
                        sourceForThinking = latestUserMessage.id;
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
                    break;
                }

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE: {
                    // Path-only response creation: path = [root, thinkingId, responseExecId]
                    const pathInfo = this.extractPathInfo(data, EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE);
                    if (!pathInfo.parentId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Invalid path (missing parent) for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE}: ${pathInfo.segments.join(' -> ')}`]
                        };
                    }
                    const thinkingId = pathInfo.parentId;
                    if (!pathInfo.nodeId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Invalid ownerPath (missing tail id) for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE}`]
                        };
                    }
                    const responseId = pathInfo.nodeId;

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

                    const responseNode = this.createAgentResponseNode(data, pathInfo);

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

    // =================================================================
    // Node Creation Helper Methods
    // =================================================================

    private createAgentNode(data: any, pathInfo: PathInfo): WorkflowNode {
        const agentNumber = this.assignAgentNumber(String(data.sourceId));
        const copyNumber = this.getNextCopyNumber(agentNumber);
        const agentId = `agent_${agentNumber}_copy_${copyNumber}`;

        return {
            id: agentId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: pathInfo.segments.length,
            status: 'running',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                // Agent nodes are created only by agent.created (no creation on execution.start).
                eventType: AGENT_EVENTS.CREATED,
                sourceId: data.sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                copyNumber: copyNumber,
                label: `Agent ${agentNumber}`,
                description: 'AI Agent instance',
                // Optional tools list propagated from agent.created event (if provided)
                ...(Array.isArray(data?.parameters?.tools) && data.parameters.tools.length > 0
                    ? { tools: [...data.parameters.tools] as string[] }
                    : {}),
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                reservedThinkingId: `thinking_${agentId}`,
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    private findAgentNodeIdForExecutionStart(eventData: EventData, pathInfo: PathInfo): string | undefined {
        const sourceId = typeof eventData?.sourceId !== 'undefined' ? String(eventData.sourceId) : undefined;
        if (sourceId) {
            const fromMap = this.agentNodeIdMap.get(sourceId);
            if (fromMap) {
                return fromMap;
            }
        }

        if (sourceId) {
            try {
                const nodesAccessor: WorkflowNode[] = (this as any).subscriber?.getAllNodes?.() || [];
                const found = nodesAccessor.find(node =>
                    node?.type === WORKFLOW_NODE_TYPES.AGENT &&
                    String(node?.data?.sourceId) === sourceId
                );
                if (found?.id) {
                    return String(found.id);
                }
            } catch {
                // Ignore read errors; caller will fail-fast if required.
            }
        }

        return undefined;
    }

    private buildAgentExecutionStateUpdate(agentNodeId: string, eventData: EventData): WorkflowNode | undefined {
        const snapshot = this.getNodeSnapshot(agentNodeId);
        if (!snapshot) {
            this.logger.warn(`⚠️ [AGENT-HANDLER] Unable to find agent node '${agentNodeId}' for execution_start update.`);
            return undefined;
        }

        const timestamp = Date.now();
        const existingExtensions = this.getExtensionsRecord(snapshot);
        const existingRobotaExtension = this.getRobotaExtension(existingExtensions);
        const existingOriginalEvent = this.getOriginalEvent(existingRobotaExtension);
        const mergedOriginalEvent = this.mergeOriginalEvent(existingOriginalEvent, eventData);
        const statusHistory = this.appendStatusHistory(
            snapshot.data?.statusHistory,
            {
                status: 'running',
                eventType: `agent.${AGENT_EVENTS.EXECUTION_START}`,
                timestamp
            }
        );

        return {
            ...snapshot,
            status: 'running',
            timestamp,
            data: {
                ...(snapshot.data || {}),
                status: 'running',
                ...(statusHistory ? { statusHistory } : {}),
                extensions: this.buildUpdatedExtensions(existingExtensions, mergedOriginalEvent, existingRobotaExtension)
            }
        } as WorkflowNode;
    }

    private getNodeSnapshot(nodeId: string): WorkflowNode | undefined {
        try {
            const nodesAccessor: WorkflowNode[] = (this as any).subscriber?.getAllNodes?.() || [];
            return nodesAccessor.find(node => String(node?.id) === String(nodeId));
        } catch {
            return undefined;
        }
    }

    private mergeOriginalEvent(existingEvent: unknown, nextEvent: EventData): Record<string, unknown> {
        const existing = typeof existingEvent === 'object' && existingEvent !== null
            ? existingEvent as Record<string, unknown>
            : {};
        const incoming = nextEvent as Record<string, unknown>;

        const existingParameters = typeof (existing as any)?.parameters === 'object' && (existing as any)?.parameters !== null
            ? (existing as any).parameters
            : {};
        const incomingParameters = typeof (incoming as any)?.parameters === 'object' && (incoming as any)?.parameters !== null
            ? (incoming as any).parameters
            : {};

        const mergedParameters = {
            ...existingParameters,
            ...incomingParameters
        };

        const mergedEvent = {
            ...existing,
            ...incoming
        } as Record<string, unknown>;

        if (Object.keys(mergedParameters).length > 0) {
            (mergedEvent as Record<string, unknown>).parameters = mergedParameters;
        }

        return mergedEvent;
    }

    private getExtensionsRecord(node?: WorkflowNode): Record<string, unknown> | undefined {
        if (!node?.data?.extensions) {
            return undefined;
        }
        const extensions = node.data.extensions as Record<string, unknown>;
        return extensions;
    }

    private getRobotaExtension(extensions?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!extensions) return undefined;
        const robota = extensions['robota'];
        if (robota && typeof robota === 'object') {
            return robota as Record<string, unknown>;
        }
        return undefined;
    }

    private getOriginalEvent(robotaExtension?: Record<string, unknown>): unknown {
        if (!robotaExtension) return undefined;
        return robotaExtension['originalEvent'];
    }

    private buildUpdatedExtensions(
        existingExtensions: Record<string, unknown> | undefined,
        mergedOriginalEvent: Record<string, unknown>,
        existingRobotaExtension?: Record<string, unknown>
    ): Record<string, unknown> {
        const nextExtensions: Record<string, unknown> = {
            ...(existingExtensions || {})
        };

        nextExtensions['robota'] = {
            ...(existingRobotaExtension || {}),
            originalEvent: mergedOriginalEvent
        };

        return nextExtensions;
    }

    private appendStatusHistory(
        existingHistory: unknown,
        entry: { status: string; eventType: string; timestamp: number }
    ): { status: string; eventType: string; timestamp: number }[] | undefined {
        if (Array.isArray(existingHistory)) {
            return [...existingHistory, entry];
        }
        return undefined;
    }

    private createAgentThinkingNode(data: any, overrideId?: string, forcedTimestamp?: number): WorkflowNode {
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        const pathInfo = this.extractPathInfo(data, EXECUTION_EVENTS.ASSISTANT_MESSAGE_START);
        const thinkingId = overrideId || pathInfo.nodeId;
        if (!thinkingId) {
            throw new Error(`[PATH-ONLY] Missing thinking node id for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_START}`);
        }

        return {
            id: thinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            level: pathInfo.segments.length,
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
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    private createAgentResponseNode(data: any, pathInfo: PathInfo): WorkflowNode {
        const agentNumber = this.agentNumberMap.get(String(data.sourceId)) || 0;
        const responseId = pathInfo.nodeId;
        if (!responseId) {
            throw new Error(`[PATH-ONLY] Missing response node id for ${EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE}`);
        }

        return {
            id: responseId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            level: pathInfo.segments.length,
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
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    // =================================================================
    // Helper Methods
    // =================================================================

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

    // Path-only: thinking nodes are addressed by explicit context.ownerPath, not auxiliary indices.

    getAllAgentMappings(): {
        agentNodes: Map<string, string>;
        agentNumbers: Map<string, number>;
    } {
        return {
            agentNodes: new Map(this.agentNodeIdMap),
            agentNumbers: new Map(this.agentNumberMap)
        };
    }

    private extractPathInfo(eventData: EventData, contextLabel: string): PathInfo {
        // Canonical: EventService.emit(..., context) provides context.ownerPath (OwnerPathSegment[])
        const ownerPath = (eventData as any)?.context?.ownerPath as unknown;
        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for ${contextLabel}`);
        }
        const segments: string[] = [];
        for (const seg of ownerPath as Array<{ id?: unknown }>) {
            const id = seg?.id;
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error(`[PATH-ONLY] Invalid context.ownerPath (missing segment id) for ${contextLabel}`);
            }
            segments.push(id);
        }
        const nodeId = segments[segments.length - 1];
        const parentId = segments.length > 1 ? segments[segments.length - 2] : undefined;
        const rootId = segments[0];
        return { segments, nodeId, parentId, rootId };
    }

    clear(): void {
        this.agentNodeIdMap.clear();
        this.agentNumberMap.clear();
        this.conversationIdToAgentIdMap.clear();
        this.logger.debug('🧹 [AGENT-HANDLER] All mappings cleared');
    }
}

interface PathInfo {
    segments: string[];
    nodeId?: string;
    parentId?: string;
    rootId?: string;
}
