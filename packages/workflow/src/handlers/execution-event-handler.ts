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
import { HandlerPriority } from '../interfaces/event-handler.js';
import type { IWorkflowStateAccess } from '../interfaces/workflow-state-access.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { extractPathInfo } from './path-info.js';
import { ExecutionNodeBuilder } from './builders/execution-node-builder.js';
import { AgentNodeBuilder } from './builders/agent-node-builder.js';

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
    private stateAccess: IWorkflowStateAccess;
    private executionNodeBuilder: ExecutionNodeBuilder;
    private agentNodeBuilder: AgentNodeBuilder;

    constructor(
        logger: ILogger = SilentLogger,
        stateAccess: IWorkflowStateAccess,
        executionNodeBuilder: ExecutionNodeBuilder,
        agentNodeBuilder: AgentNodeBuilder
    ) {
        this.logger = logger;
        this.stateAccess = stateAccess;
        this.executionNodeBuilder = executionNodeBuilder;
        this.agentNodeBuilder = agentNodeBuilder;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        try {
            this.logger.debug(`🔧 [EXECUTION-HANDLER] Processing ${eventType}`);
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
        const thinkingScopeKey = ownerPath.map(s => String(s.id)).join('\u0000');

        const nodesAccessor = this.stateAccess.getAllNodes();
        const toolResponses = nodesAccessor.filter((n) => {
            if (n?.type !== WORKFLOW_NODE_TYPES.TOOL_RESPONSE) return false;
            const op = n?.data?.extensions?.robota?.originalEvent?.context?.ownerPath;
            if (!Array.isArray(op) || op.length === 0) return false;
            const key = op.map(s => String(s?.id ?? '')).slice(0, -1).join('\u0000');
            return key === thinkingScopeKey;
        });
        if (toolResponses.length === 0) {
            return { success: true, updates: [] };
        }
        const toolResultNode = this.executionNodeBuilder.createToolResultNode(thinkingId, eventData);
        updates.push({ action: 'create', node: toolResultNode });
        for (const tr of toolResponses) {
            const edge: IWorkflowEdge = {
                id: EdgeUtils.generateId(tr.id, toolResultNode.id, 'result'),
                source: tr.id,
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

        const allNodes = this.stateAccess.getAllNodes();
        const agentNodeForExec = allNodes.find(n => n.type === WORKFLOW_NODE_TYPES.AGENT && String(n.data?.sourceId ?? '') === localAgentId)?.id;
        if (!agentNodeForExec) {
            return {
                success: false,
                updates: [],
                errors: [
                    `[PATH-ONLY] Missing source node for ${EXECUTION_EVENT_NAMES.USER_MESSAGE}. ` +
                    `Expected an agent node for agentId="${localAgentId}".`
                ]
            };
        }

        const edge: IWorkflowEdge = {
            id: EdgeUtils.generateId(agentNodeForExec, userMessageNode.id, 'receives'),
            source: agentNodeForExec,
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

        const nodesAccessor = this.stateAccess.getAllNodes();
        const thinkingExists = nodesAccessor.some(n => n?.id === thinkingId);
        if (!thinkingExists) {
            return {
                success: false,
                updates: [],
                errors: [`[PATH-ONLY] thinking node '${thinkingId}' not found. Must be created by ${EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START} first. No fallback creation allowed.`]
            };
        }

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

class ExecutionStartHandler implements IEventHandler {
    readonly name = 'ExecutionStartHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.START];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.START;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.START, eventData);
    }
}

class ExecutionCompleteHandler implements IEventHandler {
    readonly name = 'ExecutionCompleteHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.COMPLETE];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.COMPLETE;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.COMPLETE, eventData);
    }
}

class ExecutionErrorHandler implements IEventHandler {
    readonly name = 'ExecutionErrorHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.ERROR];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.ERROR;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.ERROR, eventData);
    }
}

class ExecutionAssistantMessageStartHandler implements IEventHandler {
    readonly name = 'ExecutionAssistantMessageStartHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_START, eventData);
    }
}

class ExecutionAssistantMessageCompleteHandler implements IEventHandler {
    readonly name = 'ExecutionAssistantMessageCompleteHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.ASSISTANT_MESSAGE_COMPLETE, eventData);
    }
}

class ExecutionToolResultsToLlmHandler implements IEventHandler {
    readonly name = 'ExecutionToolResultsToLlmHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.TOOL_RESULTS_TO_LLM, eventData);
    }
}

class ExecutionToolResultsReadyHandler implements IEventHandler {
    readonly name = 'ExecutionToolResultsReadyHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.TOOL_RESULTS_READY, eventData);
    }
}

class ExecutionUserMessageHandler implements IEventHandler {
    readonly name = 'ExecutionUserMessageHandler';
    readonly priority = HandlerPriority.HIGHEST;
    readonly patterns = [EXECUTION_EVENT_NAMES.USER_MESSAGE];
    constructor(private readonly logic: ExecutionEventLogic) {}
    canHandle(eventType: string): boolean {
        return eventType === EXECUTION_EVENT_NAMES.USER_MESSAGE;
    }
    handle(_eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        return this.logic.handle(EXECUTION_EVENT_NAMES.USER_MESSAGE, eventData);
    }
}

export function createExecutionEventHandlers(
    logger: ILogger = SilentLogger,
    stateAccess: IWorkflowStateAccess,
    executionNodeBuilder: ExecutionNodeBuilder,
    agentNodeBuilder: AgentNodeBuilder
): IEventHandler[] {
    const logic = new ExecutionEventLogic(logger, stateAccess, executionNodeBuilder, agentNodeBuilder);
    return [
        new ExecutionStartHandler(logic),
        new ExecutionCompleteHandler(logic),
        new ExecutionErrorHandler(logic),
        new ExecutionAssistantMessageStartHandler(logic),
        new ExecutionAssistantMessageCompleteHandler(logic),
        new ExecutionToolResultsToLlmHandler(logic),
        new ExecutionToolResultsReadyHandler(logic),
        new ExecutionUserMessageHandler(logic),
    ];
}
