/**
 * Execution event processing logic
 *
 * Handles execution.* events and creates appropriate workflow nodes.
 */

import type { IOwnerPathSegment, ILogger } from '@robota-sdk/agents';
import {
    SilentLogger,
    EXECUTION_EVENTS,
    EXECUTION_EVENT_PREFIX,
    composeEventName
} from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import type { IWorkflowNode } from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { extractPathInfo, findOwnerIdByType } from './path-info.js';
import { ExecutionNodeBuilder } from './builders/execution-node-builder.js';
import { AgentNodeBuilder } from './builders/agent-node-builder.js';
import { type TWorkflowInstanceType, WorkflowInstanceRegistry } from '../services/instance-registry.js';

const EXECUTION_EVENT_NAMES = {
    START: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.START),
    COMPLETE: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.COMPLETE),
    ERROR: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.ERROR),
    ASSISTANT_MESSAGE_START: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.ASSISTANT_MESSAGE_START),
    ASSISTANT_MESSAGE_COMPLETE: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE),
    USER_MESSAGE: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.USER_MESSAGE),
    TOOL_RESULTS_TO_LLM: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM),
    TOOL_RESULTS_READY: composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.TOOL_RESULTS_READY),
};

class ExecutionEventLogic {
    private logger: ILogger;
    private executionNodeBuilder: ExecutionNodeBuilder;
    private agentNodeBuilder: AgentNodeBuilder;
    private instanceRegistry: WorkflowInstanceRegistry;

    constructor(
        logger: ILogger = SilentLogger,
        executionNodeBuilder: ExecutionNodeBuilder,
        agentNodeBuilder: AgentNodeBuilder,
        instanceRegistry: WorkflowInstanceRegistry
    ) {
        this.logger = logger;
        this.executionNodeBuilder = executionNodeBuilder;
        this.agentNodeBuilder = agentNodeBuilder;
        this.instanceRegistry = instanceRegistry;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        try {
            this.logger.debug(`🔧 [EXECUTION-HANDLER] Processing ${eventType}`);
            this.recordInstance(eventType, eventData);
            const handler = this.getHandler(eventType);
            if (!handler) {
                this.logger.warn(`⚠️ [EXECUTION-HANDLER] Unknown event type: ${eventType}`);
                return {
                    success: false,
                    updates: [],
                    metadata: {
                        handlerType: 'execution',
                        eventType,
                        processed: false
                    }
                };
            }

            const result = await handler(eventData);
            return {
                ...result,
                metadata: {
                    handlerType: 'execution',
                    eventType,
                    processed: true
                }
            };
        } catch (error) {
            this.logger.error(
                `❌ [EXECUTION-HANDLER] Error processing ${eventType}:`,
                error instanceof Error ? error : new Error(String(error))
            );
            return {
                success: false,
                updates: [],
                errors: [`ExecutionEventHandler failed: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerType: 'execution',
                    eventType,
                    error: true
                }
            };
        }
    }

    private getHandler(eventType: string): ((data: TEventData) => Promise<IEventProcessingResult>) | undefined {
        const handlers: Record<string, (data: TEventData) => Promise<IEventProcessingResult>> = {
            [EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY]: (data) => this.handleToolResultsReady(data),
            [EXECUTION_EVENT_NAMES.START]: () => this.handleExecutionStart(),
            [EXECUTION_EVENT_NAMES.COMPLETE]: () => this.handleExecutionComplete(),
            [EXECUTION_EVENT_NAMES.ERROR]: (data) => this.handleExecutionError(data),
            [EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START]: (data) => this.handleAssistantMessageStart(data),
            [EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE]: (data) => this.handleAssistantMessageComplete(data),
            [EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM]: () => this.handleToolResultsToLlm(),
            [EXECUTION_EVENT_NAMES.USER_MESSAGE]: (data) => this.handleUserMessage(data),
        };
        return handlers[eventType];
    }

    private recordInstance(eventType: string, eventData: TEventData): void {
        const ownerPath = eventData.context.ownerPath;
        if (eventType === EXECUTION_EVENT_NAMES.START) {
            const executionId = findOwnerIdByType(ownerPath, 'execution', eventType);
            this.instanceRegistry.register('execution', executionId, eventData);
            return;
        }
        if (eventType === EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START) {
            const thinkingId = findOwnerIdByType(ownerPath, 'thinking', eventType);
            this.instanceRegistry.register('thinking', thinkingId, eventData);
            return;
        }
        if (eventType === EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE) {
            const responseId = findOwnerIdByType(ownerPath, 'response', eventType);
            this.instanceRegistry.register('response', responseId, eventData);
            return;
        }
        if (eventType === EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY || eventType === EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM) {
            const thinkingId = findOwnerIdByType(ownerPath, 'thinking', eventType);
            this.instanceRegistry.update('thinking', thinkingId, eventData);
            return;
        }
        if (
            eventType === EXECUTION_EVENT_NAMES.COMPLETE ||
            eventType === EXECUTION_EVENT_NAMES.ERROR ||
            eventType === EXECUTION_EVENT_NAMES.USER_MESSAGE
        ) {
            const executionId = findOwnerIdByType(ownerPath, 'execution', eventType);
            this.instanceRegistry.update('execution', executionId, eventData);
        }
    }

    private async handleExecutionStart(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleExecutionComplete(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleToolResultsToLlm(): Promise<IEventProcessingResult> {
        return { success: true, updates: [] };
    }

    private async handleToolResultsReady(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const ownerPath: IOwnerPathSegment[] = eventData.context.ownerPath;
        const thinkingId = ownerPath.length > 0 ? String(ownerPath[ownerPath.length - 1].id) : '';
        if (!thinkingId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Invalid context.ownerPath (missing tail id) for ${EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY}`]
            };
        }
        const toolCallIds = (() => {
            const raw = eventData.parameters?.toolCallIds;
            if (!Array.isArray(raw)) return undefined;
            const ids: string[] = [];
            for (const item of raw) {
                if (typeof item !== 'string' || item.length === 0) {
                    return undefined;
                }
                ids.push(item);
            }
            return ids;
        })();
        if (!toolCallIds || toolCallIds.length === 0) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Missing toolCallIds for ${EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY}`]
            };
        }
        const toolResultNode = this.executionNodeBuilder.createToolResultNode(thinkingId, eventData);
        updates.push({ action: 'create', node: toolResultNode });
        for (const toolCallId of toolCallIds) {
            const toolResponseId = `tool_response_call_${toolCallId}`;
            const edge: IWorkflowEdge = {
                id: EdgeUtils.generateId(toolResponseId, toolResultNode.id, 'result'),
                source: toolResponseId,
                target: toolResultNode.id,
                type: 'result',
                timestamp: Date.now()
            };
            updates.push({ action: 'create', edge });
        }

        return { success: true, updates };
    }

    private async handleExecutionError(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const executionErrorNode = this.executionNodeBuilder.createExecutionErrorNode(eventData);
        updates.push({ action: 'create', node: executionErrorNode });
        return { success: true, updates };
    }

    private async handleUserMessage(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const ctxOwnerPath: IOwnerPathSegment[] = eventData.context.ownerPath;
        const localAgentId = (() => {
            for (let i = ctxOwnerPath.length - 1; i >= 0; i--) {
                const seg = ctxOwnerPath[i];
                if (seg?.type === 'agent' && typeof seg.id === 'string' && seg.id.length > 0) {
                    return seg.id;
                }
            }
            return undefined;
        })();
        const localExecutionId = (() => {
            for (let i = ctxOwnerPath.length - 1; i >= 0; i--) {
                const seg = ctxOwnerPath[i];
                if (seg?.type === 'execution' && typeof seg.id === 'string' && seg.id.length > 0) {
                    return seg.id;
                }
            }
            return undefined;
        })();
        if (!localAgentId || !localExecutionId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Missing agent/execution segments in context.ownerPath for ${EXECUTION_EVENT_NAMES.USER_MESSAGE}`]
            };
        }
        const userMessageNode = this.executionNodeBuilder.createUserMessageNode(eventData);
        updates.push({ action: 'create', node: userMessageNode });

        const edge: IWorkflowEdge = {
            id: EdgeUtils.generateId(localAgentId, userMessageNode.id, 'receives'),
            source: localAgentId,
            target: userMessageNode.id,
            type: 'receives',
            timestamp: Date.now()
        };
        updates.push({ action: 'create', edge });

        return { success: true, updates };
    }

    private async handleAssistantMessageStart(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START);
        const pathThinkingId = pathInfo.nodeId;

        if (!pathInfo.parentId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Missing parent segment for ${EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START}. Path=${pathInfo.segments.join(' -> ')}`]
            };
        }
        const sourceForThinking = pathInfo.parentId;
        const typeForThinking: 'processes' = 'processes';
        const baseTimestamp = Date.now();

        const thinkingNode = this.agentNodeBuilder.createThinkingNode(eventData, pathInfo, baseTimestamp);
        updates.push({ action: 'create', node: thinkingNode });

        const edge: IWorkflowEdge = {
            id: EdgeUtils.generateId(sourceForThinking, thinkingNode.id, typeForThinking),
            source: sourceForThinking,
            target: thinkingNode.id,
            type: typeForThinking,
            timestamp: Date.now()
        };
        updates.push({ action: 'create', edge });

        return { success: true, updates };
    }

    private async handleAssistantMessageComplete(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE);
        if (!pathInfo.parentId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Invalid path (missing parent) for ${EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE}: ${pathInfo.segments.join(' -> ')}`]
            };
        }
        const thinkingId = pathInfo.parentId;
        if (!pathInfo.nodeId) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] Invalid ownerPath (missing tail id) for ${EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE}`]
            };
        }
        const responseId = pathInfo.nodeId;

        const responseNode = this.agentNodeBuilder.createResponseNode(eventData, pathInfo);
        updates.push({ action: 'create', node: responseNode });

        const edge: IWorkflowEdge = {
            id: EdgeUtils.generateId(thinkingId, responseId, 'return'),
            source: thinkingId,
            target: responseId,
            type: 'return',
            timestamp: Date.now()
        };
        updates.push({ action: 'create', edge });

        return { success: true, updates };
    }
}

export function registerExecutionEventHandlers(
    registerHandler: (handler: IEventHandler) => void,
    logger: ILogger = SilentLogger,
    executionNodeBuilder: ExecutionNodeBuilder,
    agentNodeBuilder: AgentNodeBuilder,
    instanceRegistry: WorkflowInstanceRegistry
): void {
    const logic = new ExecutionEventLogic(logger, executionNodeBuilder, agentNodeBuilder, instanceRegistry);
    const handlers: IEventHandler[] = [
        {
            name: 'ExecutionStartHandler',
            eventName: EXECUTION_EVENT_NAMES.START,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.START, eventData)
        },
        {
            name: 'ExecutionCompleteHandler',
            eventName: EXECUTION_EVENT_NAMES.COMPLETE,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.COMPLETE, eventData)
        },
        {
            name: 'ExecutionErrorHandler',
            eventName: EXECUTION_EVENT_NAMES.ERROR,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.ERROR, eventData)
        },
        {
            name: 'ExecutionAssistantMessageStartHandler',
            eventName: EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START, eventData)
        },
        {
            name: 'ExecutionAssistantMessageCompleteHandler',
            eventName: EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE, eventData)
        },
        {
            name: 'ExecutionToolResultsToLlmHandler',
            eventName: EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM, eventData)
        },
        {
            name: 'ExecutionToolResultsReadyHandler',
            eventName: EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY, eventData)
        },
        {
            name: 'ExecutionUserMessageHandler',
            eventName: EXECUTION_EVENT_NAMES.USER_MESSAGE,
            handle: (eventData) => logic.handle(EXECUTION_EVENT_NAMES.USER_MESSAGE, eventData)
        }
    ];
    handlers.forEach(registerHandler);
}
