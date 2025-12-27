/**
 * ExecutionEventHandler - Handles execution-related events
 * 
 * Processes execution.* events and creates appropriate workflow nodes
 * Based on existing implementation in workflow-event-subscriber.ts
 */

import type { IOwnerPathSegment, ILogger } from '@robota-sdk/agents';
import { SilentLogger, EXECUTION_EVENTS } from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult,
} from '../interfaces/event-handler.js';
import type { IWorkflowNode } from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { HandlerPriority } from '../interfaces/event-handler.js';

/**
 * ExecutionEventHandler - Handles execution lifecycle events
 */
export class ExecutionEventHandler implements IEventHandler {
    readonly name = 'ExecutionEventHandler';
    readonly priority = HandlerPriority.HIGHEST; // Execution events are fundamental
    readonly patterns = ['execution.*'];

    private logger: ILogger;

    // Mapping state for execution tracking
    private executionNodeMap = new Map<string, string>(); // executionId → nodeId
    private userMessageNodeMap = new Map<string, string>(); // messageId → nodeId
    private assistantMessageMap = new Map<string, string>(); // executionId → assistantMessageNodeId

    constructor(logger: ILogger = SilentLogger) {
        this.logger = logger;
    }

    canHandle(eventType: string): boolean {
        return this.patterns.some(pattern => {
            if (pattern.includes('*')) {
                const prefix = pattern.replace('*', '');
                return eventType.startsWith(prefix);
            }
            return eventType === pattern;
        });
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        try {
            this.logger.debug(`🔧 [EXECUTION-HANDLER] Processing ${eventType}`);

            const updates: TWorkflowUpdate[] = [];
            let success = true;

            switch (eventType) {
                case EXECUTION_EVENTS.TOOL_RESULTS_READY: {
                    // Path-only: thinking scope = context.ownerPath (absolute)
                    const ownerPath: IOwnerPathSegment[] = eventData.context.ownerPath;
                    const thinkingId = ownerPath.length > 0 ? String(ownerPath[ownerPath.length - 1].id) : '';
                    if (!thinkingId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Invalid context.ownerPath (missing tail id) for ${EXECUTION_EVENTS.TOOL_RESULTS_READY}`]
                        };
                    }
                    const thinkingScopeKey = ownerPath.map(s => String(s.id)).join('\u0000');

                    // Collect existing tool_response nodes by checking originalEvent.context.ownerPath prefix match
                    const subscriber = (this as { subscriber?: { getAllNodes?: () => IWorkflowNode[] } }).subscriber;
                    const nodesAccessor = subscriber?.getAllNodes?.() ?? [];
                    const toolResponses = nodesAccessor.filter((n) => {
                        if (n?.type !== WORKFLOW_NODE_TYPES.TOOL_RESPONSE) return false;
                        const op = n?.data?.extensions?.robota?.originalEvent?.context?.ownerPath;
                        if (!Array.isArray(op) || op.length === 0) return false;
                        const key = op.map(s => String(s?.id ?? '')).slice(0, -1).join('\u0000');
                        return key === thinkingScopeKey;
                    });
                    if (toolResponses.length === 0) break;
                    const nodeId = `tool_result_${thinkingId}_${eventData.timestamp.getTime()}`;
                    const toolResultNode: IWorkflowNode = {
                        id: nodeId,
                        type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
                        level: 2,
                        status: 'running',
                        timestamp: Date.now(),
                        data: {
                            sourceId: thinkingId,
                            sourceType: 'execution',
                            parentThinkingNodeId: thinkingId,
                            label: 'Tool Result Aggregation',
                            description: 'Aggregating tool call results',
                            extensions: { robota: { originalEvent: eventData, handlerType: 'execution' } }
                        },
                        connections: []
                    };
                    updates.push({ action: 'create', node: toolResultNode });
                    for (const tr of toolResponses) {
                        const edge: IWorkflowEdge = {
                            id: EdgeUtils.generateId(tr.id, nodeId, 'result'),
                            source: tr.id,
                            target: nodeId,
                            type: 'result',
                            timestamp: Date.now()
                        };
                        updates.push({ action: 'create', edge });
                    }
                    break;
                }
                case EXECUTION_EVENTS.START:
                    // Do not create execution node here; AgentEventHandler creates agent node instead
                    break;

                case EXECUTION_EVENTS.COMPLETE:
                    // Do not create a node for execution complete (minimal graph)
                    break;

                case EXECUTION_EVENTS.ERROR:
                    const executionErrorNode = this.createExecutionErrorNode(eventData);
                    // [PATH-ONLY] prevId is no longer used; edges are created explicitly
                    updates.push({ action: 'create', node: executionErrorNode });
                    break;

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_START:
                    // AgentEventHandler will create the thinking node; skip assistant_message node
                    break;

                case EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE:
                    // AgentEventHandler will create the response node; skip assistant_message node
                    break;

                case EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM:
                    // Domain-neutral: delivery event to LLM, no graph mutation required
                    // Treat as successfully handled to avoid strict-policy aborts
                    break;

                case EXECUTION_EVENTS.USER_MESSAGE:
                    {
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
                                errors: [`[PATH-ONLY] Missing agent/execution segments in context.ownerPath for ${EXECUTION_EVENTS.USER_MESSAGE}`]
                            };
                        }
                        const userMessageNode = this.createUserMessageNode(eventData);
                        updates.push({ action: 'create', node: userMessageNode });
                        this.userMessageNodeMap.set(localAgentId, userMessageNode.id);

                        // Path-only: connect user_message to the local agent node only (no ordering-based inference).
                        const subscriber = (this as { subscriber?: { getAllNodes?: () => IWorkflowNode[] } }).subscriber;
                        const allNodes = subscriber?.getAllNodes?.() ?? [];
                        const agentNodeForExec = allNodes.find(n => n.type === WORKFLOW_NODE_TYPES.AGENT && String(n.data?.sourceId ?? '') === localAgentId)?.id;

                        if (!agentNodeForExec) {
                            return {
                                success: false,
                                updates: [],
                                errors: [
                                    `[PATH-ONLY] Missing source node for ${EXECUTION_EVENTS.USER_MESSAGE}. ` +
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

                        break;
                    }

                case 'user.input':
                    const userInputNode = this.createUserInputNode(eventData);
                    // [PATH-ONLY] prevId is no longer used; edges are created explicitly
                    updates.push({ action: 'create', node: userInputNode });
                    break;

                default:
                    this.logger.warn(`⚠️ [EXECUTION-HANDLER] Unknown event type: ${eventType}`);
                    success = false;
            }

            return {
                success,
                updates,
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

    // =================================================================
    // Node Creation Methods
    // =================================================================

    private createExecutionStartNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return ownerPath.length > 0 ? ownerPath[ownerPath.length - 1].id : '';
        })();
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = String(executionId);
        const derivedLevel = ownerPath.length;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.EXECUTION,
            level: 0,
            status: 'running',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                sourceId: agentId || executionId,
                sourceType: 'execution',
                executionId,
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                label: 'Execution Start',
                description: 'Agent execution started',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                executionInfo: {
                    executionId,
                    startTime: new Date().toISOString(),
                    level: derivedLevel
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isExecutionStart: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    private createExecutionCompleteNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return ownerPath.length > 0 ? ownerPath[ownerPath.length - 1].id : '';
        })();
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = `execution_complete_${executionId}_${data.timestamp.getTime()}`;
        const derivedLevel = ownerPath.length;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.EXECUTION,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId || executionId,
                sourceType: 'execution',
                executionId,
                label: 'Execution Complete',
                description: 'Agent execution completed successfully',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                executionInfo: {
                    executionId,
                    endTime: new Date().toISOString(),
                    level: derivedLevel,
                    duration: typeof data.metadata?.duration === 'number' ? data.metadata.duration : 0,
                    success: true
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isExecutionComplete: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    private createExecutionErrorNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return ownerPath.length > 0 ? ownerPath[ownerPath.length - 1].id : '';
        })();
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = `execution_error_${executionId}_${data.timestamp.getTime()}`;
        const errorMessage = (data.error instanceof Error ? data.error.message : String(data.error || data.parameters?.error || 'Execution failed'));
        const derivedLevel = ownerPath.length;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 0,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: agentId || executionId,
                sourceType: 'execution',
                executionId,
                label: 'Execution Error',
                description: `Execution failed: ${errorMessage}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                error: data.error || { message: errorMessage },
                metadata: data.metadata || {},
                executionInfo: {
                    executionId,
                    errorTime: new Date().toISOString(),
                    level: derivedLevel,
                    success: false
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isExecutionError: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    private createAssistantMessageStartNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = `assistant_message_start_${executionId}_${data.timestamp.getTime()}`;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE,
            level: 1,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: agentId || executionId,
                sourceType: 'execution',
                executionId,
                label: 'Assistant Message Start',
                description: 'Assistant started generating message',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                messageInfo: {
                    messageId: data.parameters?.messageId || `msg_${Date.now()}`,
                    startTime: new Date().toISOString(),
                    isStreaming: data.parameters?.isStreaming || false
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isAssistantMessage: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    private createAssistantMessageCompleteNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = `assistant_message_complete_${executionId}_${data.timestamp.getTime()}`;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;
        const messageContent = (() => {
            const r = data.result;
            if (r && typeof r === 'object' && 'content' in r && typeof r.content === 'string') return r.content;
            const p = data.parameters;
            if (p && typeof p.content === 'string') return p.content;
            return 'Assistant response';
        })();
        const messageLength = messageContent.length;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE,
            level: 1,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId || executionId,
                sourceType: 'execution',
                executionId,
                label: `Assistant Message (${messageLength} chars)`,
                description: 'Assistant message generation completed',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                messageInfo: {
                    messageId: data.parameters?.messageId || `msg_${Date.now()}`,
                    endTime: new Date().toISOString(),
                    content: messageContent,
                    length: messageLength,
                    wordCount: messageContent.split(/\s+/).filter((word: string) => word.length > 0).length
                },
                messageMetrics: {
                    responseTime: typeof data.metadata?.responseTime === 'number' ? data.metadata.responseTime : 0,
                    tokenCount: typeof data.metadata?.tokenCount === 'number' ? data.metadata.tokenCount : 0,
                    hasCodeBlocks: /```/.test(messageContent),
                    hasLinks: /https?:\/\//.test(messageContent),
                    complexity: messageLength > 1000 ? 'high' : messageLength > 300 ? 'medium' : 'low'
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isAssistantMessage: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    private createUserMessageNode(data: TEventData): IWorkflowNode {
        // Generate unique node ID for each user message to support continued conversations
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
            throw new Error('[PATH-ONLY] Missing context.ownerPath for execution.user_message');
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
            throw new Error('[PATH-ONLY] Missing agent/execution segments in context.ownerPath for execution.user_message');
        }
        const nodeId = `${agentId}_user_${executionId}_${data.timestamp.getTime()}`;
        const messageContent = (() => {
            const p = data.parameters;
            if (!p) return 'User message';
            if (typeof p.input === 'string') return p.input;
            if (typeof p.userMessageContent === 'string') return p.userMessageContent;
            if (typeof p.content === 'string') return p.content;
            if (typeof p.message === 'string') return p.message;
            return 'User message';
        })();

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId,
                sourceType: 'user',
                executionId,
                label: 'User Message',
                description: 'User input message',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                messageInfo: {
                    messageId: nodeId,
                    content: messageContent,
                    length: messageContent.length,
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isUserMessage: true }
                    }
                }
            },
            connections: []
        };
    }

    private createUserInputNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const nodeId = `user_input_${agentId || executionId}_${data.timestamp.getTime()}`;
        const inputContent = (() => {
            if (typeof data.parameters?.input === 'string') return data.parameters.input;
            if (typeof data.parameters?.content === 'string') return data.parameters.content;
            return 'User input';
        })();
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId || executionId,
                sourceType: 'user',
                executionId,
                label: 'User Input',
                description: 'User provided input',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                inputInfo: {
                    inputId: nodeId,
                    content: inputContent,
                    inputType: data.parameters?.inputType || 'text',
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isUserInput: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    // =================================================================
    // Helper Methods
    // =================================================================

    /**
     * Get execution node ID for a given execution ID
     */
    getExecutionNodeId(executionId: string): string | undefined {
        return this.executionNodeMap.get(executionId);
    }

    /**
     * Get user message node ID for a given message ID
     */
    getUserMessageNodeId(messageId: string): string | undefined {
        return this.userMessageNodeMap.get(messageId);
    }

    /**
     * Get assistant message node ID for a given execution ID
     */
    getAssistantMessageNodeId(executionId: string): string | undefined {
        return this.assistantMessageMap.get(executionId);
    }

    // executionLevel/parentExecutionId removed: use context.ownerPath only.

    /**
     * Clear handler state (useful for testing and cleanup)
     */
    clear(): void {
        this.executionNodeMap.clear();
        this.userMessageNodeMap.clear();
        this.assistantMessageMap.clear();
        this.logger.debug('🧹 [EXECUTION-HANDLER] Handler state cleared');
    }
}