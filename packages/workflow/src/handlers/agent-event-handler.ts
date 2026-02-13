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
} from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import type {
    IWorkflowNode,
    IWorkflowNodeData,
    IWorkflowOriginalEvent,
    TWorkflowConnectionKind,
} from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { extractPathInfo, findOwnerIdByType } from './path-info.js';
import { AgentNodeBuilder } from './builders/agent-node-builder.js';
import { type TWorkflowInstanceType, WorkflowInstanceRegistry } from '../services/instance-registry.js';

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
    private nodeBuilder: AgentNodeBuilder;
    private instanceRegistry: WorkflowInstanceRegistry;

    constructor(
        logger: ILogger = SilentLogger,
        nodeBuilder: AgentNodeBuilder,
        instanceRegistry: WorkflowInstanceRegistry
    ) {
        this.logger = logger;
        this.nodeBuilder = nodeBuilder;
        this.instanceRegistry = instanceRegistry;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        const agentId = findOwnerIdByType(eventData.context.ownerPath, 'agent', eventType);
        const executionId = typeof eventData.executionId === 'string' ? eventData.executionId : undefined;
        this.logger.debug(`🔔 [AGENT-HANDLER] Processing ${eventType}`, {
            agentId,
            executionId
        });

        this.recordAgentInstance(eventType, agentId, eventData);

        const handler = this.getHandler(eventType);
        if (!handler) {
            throw new Error(`[AGENT-HANDLER] Unhandled event type: ${eventType}`);
        }

        return handler(eventData, agentId);
    }

    private getHandler(
        eventType: string
    ): ((data: TEventData, agentId: string) => Promise<IEventProcessingResult>) | undefined {
        const handlers: Record<string, (data: TEventData, agentId: string) => Promise<IEventProcessingResult>> = {
            [AGENT_EVENT_NAMES.CREATED]: (data, id) => this.handleAgentCreated(data, id),
            [AGENT_EVENT_NAMES.EXECUTION_START]: (data, id) => this.handleAgentExecutionStart(data, id),
            [AGENT_EVENT_NAMES.EXECUTION_COMPLETE]: () => this.handleAgentExecutionComplete(),
            [AGENT_EVENT_NAMES.EXECUTION_ERROR]: () => this.handleAgentExecutionError(),
            [AGENT_EVENT_NAMES.AGGREGATION_COMPLETE]: () => this.handleAgentAggregationComplete(),
            [AGENT_EVENT_NAMES.CONFIG_UPDATED]: (data, id) => this.handleAgentConfigUpdated(data, id),
        };
        return handlers[eventType];
    }

    private recordAgentInstance(eventType: string, agentId: string, eventData: TEventData): void {
        const instanceType: TWorkflowInstanceType = 'agent';
        if (eventType === AGENT_EVENT_NAMES.CREATED) {
            this.instanceRegistry.register(instanceType, agentId, eventData);
            return;
        }
        this.instanceRegistry.update(instanceType, agentId, eventData);
    }

    private async handleAgentCreated(eventData: TEventData, agentId: string): Promise<IEventProcessingResult> {
        const pathInfo = extractPathInfo(eventData.context.ownerPath, AGENT_EVENT_NAMES.CREATED);
        const agentNode = this.nodeBuilder.createAgentNode(eventData, agentId, pathInfo);
        const updates: TWorkflowUpdate[] = [];
        updates.push({ action: 'create', node: agentNode });
        if (!pathInfo.parentId) {
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

        return { success: true, updates };
    }

    private async handleAgentExecutionStart(eventData: TEventData, agentId: string): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, AGENT_EVENT_NAMES.EXECUTION_START);
        const existingAgentNodeId = this.findAgentNodeIdForExecutionStart(agentId);
        if (existingAgentNodeId) {
            const patch = this.buildAgentExecutionStatePatch(eventData);
            updates.push({ action: 'patch', nodeId: existingAgentNodeId, updates: patch });
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

    private async handleAgentConfigUpdated(eventData: TEventData, agentId: string): Promise<IEventProcessingResult> {
        const existingId = agentId;
        const originalEvent = this.toOriginalEvent(eventData);
        const toolsFromEvent = eventData.parameters?.tools;
        const normalizedTools = this.toStringArrayValue(toolsFromEvent);
        const dataUpdates: IWorkflowNodeData = {
            extensions: {
                robota: {
                    handlerType: 'agent',
                    originalEvent
                }
            }
        };
        if (normalizedTools) {
            dataUpdates.tools = normalizedTools;
        }
        const patch: Partial<IWorkflowNode> = {
            timestamp: Date.now(),
            data: dataUpdates
        };
        return { success: true, updates: [{ action: 'patch', nodeId: existingId, updates: patch }] };
    }

    private findAgentNodeIdForExecutionStart(agentId: string): string | undefined {
        return agentId;
    }

    private buildAgentExecutionStatePatch(eventData: TEventData): Partial<IWorkflowNode> {
        const timestamp = Date.now();
        const originalEvent = this.toOriginalEvent(eventData);
        return {
            status: 'running',
            timestamp,
            data: {
                status: 'running',
                extensions: {
                    robota: {
                        handlerType: 'agent',
                        originalEvent
                    }
                }
            }
        };
    }

    private toOriginalEvent(nextEvent: TEventData): IWorkflowOriginalEvent {
        const sourceType = typeof nextEvent.sourceType === 'string' ? nextEvent.sourceType : undefined;
        const sourceId = typeof nextEvent.sourceId === 'string' ? nextEvent.sourceId : undefined;
        const path = this.toStringArrayValue(nextEvent.path);
        return {
            eventType: nextEvent.eventType,
            timestamp: nextEvent.timestamp,
            sourceType,
            sourceId,
            path,
            parameters: nextEvent.parameters,
            result: nextEvent.result,
            metadata: nextEvent.metadata,
            error: nextEvent.error,
            context: nextEvent.context
        };
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


    clear(): void {
        // No internal mutable dedup state.
    }
}

export function registerAgentEventHandlers(
    registerHandler: (handler: IEventHandler) => void,
    logger: ILogger = SilentLogger,
    nodeBuilder: AgentNodeBuilder,
    instanceRegistry: WorkflowInstanceRegistry
): void {
    const logic = new AgentEventLogic(logger, nodeBuilder, instanceRegistry);
    const handlers: IEventHandler[] = [
        {
            name: 'AgentCreatedHandler',
            eventName: AGENT_EVENT_NAMES.CREATED,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.CREATED, eventData)
        },
        {
            name: 'AgentExecutionStartHandler',
            eventName: AGENT_EVENT_NAMES.EXECUTION_START,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.EXECUTION_START, eventData)
        },
        {
            name: 'AgentExecutionCompleteHandler',
            eventName: AGENT_EVENT_NAMES.EXECUTION_COMPLETE,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.EXECUTION_COMPLETE, eventData)
        },
        {
            name: 'AgentExecutionErrorHandler',
            eventName: AGENT_EVENT_NAMES.EXECUTION_ERROR,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.EXECUTION_ERROR, eventData)
        },
        {
            name: 'AgentAggregationCompleteHandler',
            eventName: AGENT_EVENT_NAMES.AGGREGATION_COMPLETE,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.AGGREGATION_COMPLETE, eventData)
        },
        {
            name: 'AgentConfigUpdatedHandler',
            eventName: AGENT_EVENT_NAMES.CONFIG_UPDATED,
            handle: (eventData) => logic.handle(AGENT_EVENT_NAMES.CONFIG_UPDATED, eventData)
        }
    ];
    handlers.forEach(registerHandler);
}
