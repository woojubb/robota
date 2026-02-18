/**
 * Tool event processing logic
 * 
 * Processes tool events and creates appropriate workflow nodes.
 */

import type { ILogger } from '@robota-sdk/agents';
import { SilentLogger, TOOL_EVENTS, TOOL_EVENT_PREFIX, composeEventName } from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { extractPathInfo, findOwnerIdByType } from './path-info.js';
import { ToolNodeBuilder } from './builders/tool-node-builder.js';
import { WorkflowInstanceRegistry } from '../services/instance-registry.js';

const TOOL_EVENT_NAMES = {
    CALL_START: composeEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_START),
    CALL_COMPLETE: composeEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_COMPLETE),
    CALL_ERROR: composeEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_ERROR),
    CALL_RESPONSE_READY: composeEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_RESPONSE_READY),
};

class ToolEventLogic {
    private logger: ILogger;
    private nodeBuilder: ToolNodeBuilder;
    private instanceRegistry: WorkflowInstanceRegistry;

    constructor(
        logger: ILogger = SilentLogger,
        nodeBuilder: ToolNodeBuilder,
        instanceRegistry: WorkflowInstanceRegistry
    ) {
        this.logger = logger;
        this.nodeBuilder = nodeBuilder;
        this.instanceRegistry = instanceRegistry;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
            this.logger.debug(`🔧 [TOOL-HANDLER] Processing ${eventType}`);
        this.recordToolInstance(eventType, eventData);
        const handler = this.getHandler(eventType);
        if (!handler) {
            throw new Error(`[TOOL-HANDLER] Unknown event type: ${eventType}`);
        }
        return handler(eventData);
    }

    private getHandler(eventType: string): ((data: TEventData) => Promise<IEventProcessingResult>) | undefined {
        const handlers: Record<string, (data: TEventData) => Promise<IEventProcessingResult>> = {
            [TOOL_EVENT_NAMES.CALL_START]: (data) => this.handleCallStart(data),
            [TOOL_EVENT_NAMES.CALL_COMPLETE]: () => this.handleCallComplete(),
            [TOOL_EVENT_NAMES.CALL_ERROR]: (data) => this.handleCallError(data),
            [TOOL_EVENT_NAMES.CALL_RESPONSE_READY]: (data) => this.handleCallResponseReady(data),
        };
        return handlers[eventType];
    }

    private recordToolInstance(eventType: string, eventData: TEventData): void {
        const toolId = findOwnerIdByType(eventData.context.ownerPath, 'tool', eventType);
        if (eventType === TOOL_EVENT_NAMES.CALL_START) {
            this.instanceRegistry.register('tool', toolId, eventData);
            return;
        }
        this.instanceRegistry.update('tool', toolId, eventData);
    }

    private async handleCallStart(eventData: TEventData): Promise<IEventProcessingResult> {
            const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, TOOL_EVENT_NAMES.CALL_START);
        const toolCallNode = this.nodeBuilder.createToolCallNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolCallNode });

                    if (!pathInfo.parentId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [
                    `[PATH-ONLY] Missing parent segment for ${TOOL_EVENT_NAMES.CALL_START}. Path=${pathInfo.segments.join(' -> ')}`
                            ]
                        };
                    }

                    const edge: IWorkflowEdge = {
                        id: EdgeUtils.generateId(pathInfo.parentId, toolCallNode.id, 'executes'),
                        source: pathInfo.parentId,
                        target: toolCallNode.id,
                        type: 'executes',
                        timestamp: Date.now()
                    };
                    updates.push({ action: 'create', edge });

        return {
            success: true,
            updates
        };
    }

    private async handleCallComplete(): Promise<IEventProcessingResult> {
        return {
            success: true,
            updates: []
        };
    }

    private async handleCallError(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, TOOL_EVENT_NAMES.CALL_ERROR);
        const toolErrorNode = this.nodeBuilder.createToolCallErrorNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolErrorNode });

        return {
            success: true,
            updates
        };
    }

    private async handleCallResponseReady(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const pathInfo = extractPathInfo(eventData.context.ownerPath, TOOL_EVENT_NAMES.CALL_RESPONSE_READY);
                    const toolCallId = pathInfo.nodeId;
                    if (!toolCallId) {
                        return {
                            success: false,
                            updates: [],
                errors: [`[PATH-ONLY] Empty path.tail for ${TOOL_EVENT_NAMES.CALL_RESPONSE_READY}.`]
                        };
                    }

                    const delegatedResponseNodeId = (() => {
                        const res = eventData.result;
                        if (!res || typeof res !== 'object') return undefined;
                        if (!('delegatedResponseNodeId' in res)) return undefined;
                        const id = res.delegatedResponseNodeId;
                        return typeof id === 'string' && id.length > 0 ? id : undefined;
                    })();
                    const parentForResponseId: string =
            delegatedResponseNodeId ?? toolCallId;

        const toolResponseNode = this.nodeBuilder.createToolResponseNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolResponseNode });

                    const edgeFromParent: IWorkflowEdge = {
                        id: EdgeUtils.generateId(parentForResponseId, toolResponseNode.id, 'result'),
                        source: parentForResponseId,
                        target: toolResponseNode.id,
                        type: 'result',
                        timestamp: Date.now()
                    };
                    updates.push({ action: 'create', edge: edgeFromParent });

        return {
            success: true,
            updates
        };
    }

    clear(): void {
        this.logger.debug('🧹 [TOOL-HANDLER] Handler state cleared');
    }
}

export function registerToolEventHandlers(
    registerHandler: (handler: IEventHandler) => void,
    logger: ILogger = SilentLogger,
    instanceRegistry: WorkflowInstanceRegistry
): void {
    const nodeBuilder = new ToolNodeBuilder();
    const logic = new ToolEventLogic(logger, nodeBuilder, instanceRegistry);
    const handlers: IEventHandler[] = [
        {
            name: 'ToolCallStartHandler',
            eventName: TOOL_EVENT_NAMES.CALL_START,
            handle: (eventData) => logic.handle(TOOL_EVENT_NAMES.CALL_START, eventData)
        },
        {
            name: 'ToolCallCompleteHandler',
            eventName: TOOL_EVENT_NAMES.CALL_COMPLETE,
            handle: (eventData) => logic.handle(TOOL_EVENT_NAMES.CALL_COMPLETE, eventData)
        },
        {
            name: 'ToolCallErrorHandler',
            eventName: TOOL_EVENT_NAMES.CALL_ERROR,
            handle: (eventData) => logic.handle(TOOL_EVENT_NAMES.CALL_ERROR, eventData)
        },
        {
            name: 'ToolCallResponseReadyHandler',
            eventName: TOOL_EVENT_NAMES.CALL_RESPONSE_READY,
            handle: (eventData) => logic.handle(TOOL_EVENT_NAMES.CALL_RESPONSE_READY, eventData)
        }
    ];
    handlers.forEach(registerHandler);
}
