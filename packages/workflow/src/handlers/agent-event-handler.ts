/**
 * Agent event processing logic
 *
 * Handles agent.* events and creates appropriate workflow nodes.
 */

import {
    SilentLogger,
    AGENT_EVENTS,
    AGENT_EVENT_PREFIX,
    composeEventName,
    type ILogger,
    type IOwnerPathSegment,
    type TContextData
} from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import { HandlerPriority } from '../interfaces/event-handler.js';
import type {
    IWorkflowNode,
    IWorkflowNodeData,
    IWorkflowNodeExtensions,
    IWorkflowOriginalEvent,
    TWorkflowConnectionKind,
    TWorkflowNodeStatus
} from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import type { IWorkflowStateAccess } from '../interfaces/workflow-state-access.js';
import { extractPathInfo } from './path-info.js';
import { AgentNodeBuilder } from './builders/agent-node-builder.js';

const AGENT_EVENT_NAMES = {
    CREATED: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.CREATED),
    EXECUTION_START: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_START),
    EXECUTION_COMPLETE: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_COMPLETE),
    EXECUTION_ERROR: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_ERROR),
    AGGREGATION_COMPLETE: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.AGGREGATION_COMPLETE),
    CONFIG_UPDATED: composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.CONFIG_UPDATED),
};

class AgentEventLogic {
    private logger: ILogger;
    private stateAccess: IWorkflowStateAccess;
    private nodeBuilder: AgentNodeBuilder;
    private agentNodeIdMap = new Map<string, string>();

    constructor(
        logger: ILogger = SilentLogger,
        stateAccess: IWorkflowStateAccess,
        nodeBuilder: AgentNodeBuilder
    ) {
        this.logger = logger;
        this.stateAccess = stateAccess;
        this.nodeBuilder = nodeBuilder;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        try {
            const agentId = this.findNearestOwnerId(eventData.context.ownerPath, 'agent');
            const executionId = typeof eventData.executionId === 'string' ? eventData.executionId : undefined;
            this.logger.debug(`🔔 [AGENT-HANDLER] Processing ${eventType}`, {
                agentId,
                executionId
            });

            const handler = this.getHandler(eventType);
            if (!handler) {
                this.logger.warn(`⚠️ [AGENT-HANDLER] Unhandled event type: ${eventType}`);
                return {
                    success: false,
                    updates: [],
                    metadata: {
                        handlerType: 'agent',
                        eventType,
                        processed: false
                    }
                };
            }

            const result = await handler(eventData, agentId);
            return {
                ...result,
                metadata: {
                    handlerType: 'agent',
                    eventType,
                    processed: true
                }
            };
        } catch (error) {
            this.logger.error(
                `❌ [AGENT-HANDLER] Error handling ${eventType}:`,
                error instanceof Error ? error : new Error(String(error))
            );
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

    private getHandler(
        eventType: string
    ): ((data: TEventData, agentId: string | undefined) => Promise<IEventProcessingResult>) | undefined {
        const handlers: Record<string, (data: TEventData, agentId: string | undefined) => Promise<IEventProcessingResult>> = {
            [AGENT_EVENT_NAMES.CREATED]: (data, id) => this.handleAgentCreated(data, id),
            [AGENT_EVENT_NAMES.EXECUTION_START]: (data, id) => this.handleAgentExecutionStart(data, id),
            [AGENT_EVENT_NAMES.EXECUTION_COMPLETE]: () => this.handleAgentExecutionComplete(),
            [AGENT_EVENT_NAMES.EXECUTION_ERROR]: () => this.handleAgentExecutionError(),
            [AGENT_EVENT_NAMES.AGGREGATION_COMPLETE]: () => this.handleAgentAggregationComplete(),
            [AGENT_EVENT_NAMES.CONFIG_UPDATED]: (data, id) => this.handleAgentConfigUpdated(data, id),
        };
        return handlers[eventType];
    }

    private findNearestOwnerId(ownerPath: IOwnerPathSegment[] | undefined, ownerType: string): string | undefined {
        if (!ownerPath || ownerPath.length === 0) {
            return undefined;
        }
        for (let i = ownerPath.length - 1; i >= 0; i--) {
            const seg = ownerPath[i];
            if (seg?.type === ownerType && seg.id.length > 0) {
                return seg.id;
            }
        }
        return undefined;
    }

    private async handleAgentCreated(eventData: TEventData, agentId: string | undefined): Promise<IEventProcessingResult> {
        const pathInfo = extractPathInfo(eventData.context.ownerPath, AGENT_EVENT_NAMES.CREATED);
        if (!agentId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Missing agent segment in context.ownerPath for ${AGENT_EVENT_NAMES.CREATED}`]
            };
        }
        const existing = this.agentNodeIdMap.get(agentId);
        if (existing) {
            return { success: true, updates: [] };
        }
        const agentNode = this.nodeBuilder.createAgentNode(eventData, agentId, pathInfo);
        const updates: TWorkflowUpdate[] = [];
        updates.push({ action: 'create', node: agentNode });
        if (!pathInfo.parentId) {
            this.agentNodeIdMap.set(agentId, agentNode.id);
            return { success: true, updates };
        }

        const edge: IWorkflowEdge = {
            id: EdgeUtils.generateId(pathInfo.parentId, agentNode.id, 'creates' as TWorkflowConnectionKind),
            source: pathInfo.parentId,
            target: agentNode.id,
            type: 'creates' as TWorkflowConnectionKind,
            timestamp: Date.now()
        };
        updates.push({ action: 'create', edge });

        this.agentNodeIdMap.set(agentId, agentNode.id);
        return { success: true, updates };
    }

    private async handleAgentExecutionStart(eventData: TEventData, agentId: string | undefined): Promise<IEventProcessingResult> {
        if (!agentId) {
            this.logger.warn('⚠️ [AGENT-HANDLER] execution_start received without agent segment. Skipping state update.');
            return { success: true, updates: [] };
        }

        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, AGENT_EVENT_NAMES.EXECUTION_START);
        const existingAgentNodeId = this.findAgentNodeIdForExecutionStart(eventData, pathInfo);
        if (existingAgentNodeId) {
            const updatedNode = this.buildAgentExecutionStateUpdate(existingAgentNodeId, eventData);
            if (updatedNode) {
                updates.push({ action: 'update', node: updatedNode });
            }

            this.agentNodeIdMap.set(agentId, existingAgentNodeId);
            return { success: true, updates };
        }

        return {
            success: false,
            updates: [],
            errors: [
                `[PATH-ONLY] Missing agent node for ${AGENT_EVENT_NAMES.EXECUTION_START} path=${pathInfo.segments.join(' -> ')}`
            ]
        };
    }

    private async handleAgentExecutionComplete(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleAgentExecutionError(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleAgentAggregationComplete(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleAgentConfigUpdated(eventData: TEventData, agentId: string | undefined): Promise<IEventProcessingResult> {
        if (!agentId) {
            return { success: true, updates: [] };
        }
        let existingId = this.agentNodeIdMap.get(agentId);
        if (!existingId) {
            try {
                const nodesAccessor = this.stateAccess.getAllNodes();
                const found = nodesAccessor.find(n => n?.type === WORKFLOW_NODE_TYPES.AGENT && String(n?.data?.sourceId) === agentId);
                if (found?.id) existingId = String(found.id);
            } catch {
                // Ignore read errors.
            }
            if (!existingId) {
                return { success: true, updates: [] };
            }
        }
        try {
            const nodesAccessor = this.stateAccess.getAllNodes();
            const existingNode = nodesAccessor.find(n => String(n?.id) === String(existingId));
            if (existingNode) {
                const existingRobota = existingNode.data?.extensions?.robota;
                const mergedOriginalEvent = this.mergeOriginalEvent(existingRobota?.originalEvent, eventData);
                const handlerType = existingRobota?.handlerType ?? 'agent';

                const toolsFromEvent = eventData.parameters?.tools;
                const normalizedTools = this.toStringArrayValue(toolsFromEvent);

                const merged: IWorkflowNode = {
                    ...existingNode,
                    timestamp: Date.now(),
                    data: {
                        ...(existingNode.data || {}),
                        extensions: {
                            robota: {
                                ...(existingRobota || {}),
                                handlerType,
                                originalEvent: mergedOriginalEvent
                            }
                        },
                        tools: normalizedTools ?? existingNode.data?.tools
                    }
                };
                return { success: true, updates: [{ action: 'update', node: merged }] };
            }
        } catch {
            // Ignore read errors.
        }

        return { success: true, updates: [] };
    }

    private findAgentNodeIdForExecutionStart(eventData: TEventData, _pathInfo: { segments: string[] }): string | undefined {
        const sourceId = this.findNearestOwnerId(eventData.context.ownerPath, 'agent');
        if (sourceId) {
            const fromMap = this.agentNodeIdMap.get(sourceId);
            if (fromMap) {
                return fromMap;
            }
        }

        if (sourceId) {
            try {
                const nodesAccessor = this.stateAccess.getAllNodes();
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

    private buildAgentExecutionStateUpdate(agentNodeId: string, eventData: TEventData): IWorkflowNode | undefined {
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
                eventType: AGENT_EVENT_NAMES.EXECUTION_START,
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
        };
    }

    private getNodeSnapshot(nodeId: string): IWorkflowNode | undefined {
        try {
            const nodesAccessor = this.stateAccess.getAllNodes();
            return nodesAccessor.find(node => String(node?.id) === String(nodeId));
        } catch {
            return undefined;
        }
    }

    private mergeOriginalEvent(
        existingEvent: IWorkflowOriginalEvent | undefined,
        nextEvent: TEventData
    ): IWorkflowOriginalEvent {
        const mergedParameters = this.mergeContextData(existingEvent?.parameters, nextEvent.parameters);
        const sourceType = typeof nextEvent.sourceType === 'string' ? nextEvent.sourceType : existingEvent?.sourceType;
        const sourceId = typeof nextEvent.sourceId === 'string' ? nextEvent.sourceId : existingEvent?.sourceId;
        const path = this.toStringArrayValue(nextEvent.path) ?? existingEvent?.path;

        return {
            eventType: nextEvent.eventType,
            timestamp: nextEvent.timestamp,
            sourceType,
            sourceId,
            path,
            parameters: mergedParameters,
            result: nextEvent.result ?? existingEvent?.result,
            metadata: nextEvent.metadata ?? existingEvent?.metadata,
            error: nextEvent.error ?? existingEvent?.error,
            context: nextEvent.context ?? existingEvent?.context
        };
    }

    private mergeContextData(existing: TContextData | undefined, incoming: TContextData | undefined): TContextData | undefined {
        if (!existing) return incoming;
        if (!incoming) return existing;
        return { ...existing, ...incoming };
    }

    private toStringArrayValue(value: TEventData[keyof TEventData] | string[] | undefined): string[] | undefined {
        if (!Array.isArray(value)) {
            return undefined;
        }
        const result: string[] = [];
        for (const item of value) {
            if (typeof item !== 'string') {
                return undefined;
            }
            result.push(item);
        }
        return result;
    }

    private getExtensionsRecord(node?: IWorkflowNode): IWorkflowNodeExtensions | undefined {
        return node?.data?.extensions;
    }

    private getRobotaExtension(
        extensions?: IWorkflowNodeExtensions
    ): IWorkflowNodeExtensions['robota'] | undefined {
        return extensions?.robota;
    }

    private getOriginalEvent(robotaExtension?: IWorkflowNodeExtensions['robota']): IWorkflowOriginalEvent | undefined {
        return robotaExtension?.originalEvent;
    }

    private buildUpdatedExtensions(
        existingExtensions: IWorkflowNodeExtensions | undefined,
        mergedOriginalEvent: IWorkflowOriginalEvent,
        existingRobotaExtension?: IWorkflowNodeExtensions['robota']
    ): IWorkflowNodeExtensions {
        return {
            ...(existingExtensions || {}),
            robota: {
                ...(existingRobotaExtension || {}),
                handlerType: existingRobotaExtension?.handlerType ?? 'agent',
                originalEvent: mergedOriginalEvent
            }
        };
    }

    private appendStatusHistory(
        existingHistory: IWorkflowNodeData['statusHistory'] | undefined,
        entry: { status: TWorkflowNodeStatus; eventType: string; timestamp: number }
    ): IWorkflowNodeData['statusHistory'] | undefined {
        if (Array.isArray(existingHistory)) {
            return [...existingHistory, entry];
        }
        return undefined;
    }

    clear(): void {
        this.agentNodeIdMap.clear();
    }
}

class AgentCreatedHandler implements IEventHandler {
    readonly name = 'AgentCreatedHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.CREATED];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.CREATED;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.CREATED, eventData);
    }
}

class AgentExecutionStartHandler implements IEventHandler {
    readonly name = 'AgentExecutionStartHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.EXECUTION_START];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.EXECUTION_START;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.EXECUTION_START, eventData);
    }
}

class AgentExecutionCompleteHandler implements IEventHandler {
    readonly name = 'AgentExecutionCompleteHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.EXECUTION_COMPLETE];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.EXECUTION_COMPLETE;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.EXECUTION_COMPLETE, eventData);
    }
}

class AgentExecutionErrorHandler implements IEventHandler {
    readonly name = 'AgentExecutionErrorHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.EXECUTION_ERROR];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.EXECUTION_ERROR;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.EXECUTION_ERROR, eventData);
    }
}

class AgentAggregationCompleteHandler implements IEventHandler {
    readonly name = 'AgentAggregationCompleteHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.AGGREGATION_COMPLETE];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.AGGREGATION_COMPLETE;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.AGGREGATION_COMPLETE, eventData);
    }
}

class AgentConfigUpdatedHandler implements IEventHandler {
    readonly name = 'AgentConfigUpdatedHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [AGENT_EVENT_NAMES.CONFIG_UPDATED];
    constructor(private readonly logic: AgentEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === AGENT_EVENT_NAMES.CONFIG_UPDATED;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(AGENT_EVENT_NAMES.CONFIG_UPDATED, eventData);
    }
}

export function createAgentEventHandlers(
    logger: ILogger = SilentLogger,
    stateAccess: IWorkflowStateAccess,
    nodeBuilder: AgentNodeBuilder
): IEventHandler[] {
    const logic = new AgentEventLogic(logger, stateAccess, nodeBuilder);
    return [
        new AgentCreatedHandler(logic),
        new AgentExecutionStartHandler(logic),
        new AgentExecutionCompleteHandler(logic),
        new AgentExecutionErrorHandler(logic),
        new AgentAggregationCompleteHandler(logic),
        new AgentConfigUpdatedHandler(logic),
    ];
}
