/**
 * ToolEventHandler - Handles tool-related events
 * 
 * Processes tool.* events and creates appropriate workflow nodes
 * Based on existing implementation in workflow-event-subscriber.ts
 */

import type { SimpleLogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type {
    EventHandler,
    EventData,
    EventProcessingResult,
    HandlerPriority
} from '../interfaces/event-handler.js';
import type { WorkflowNode } from '../interfaces/workflow-node.js';
import type { WorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { WorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES, type WorkflowNodeType } from '../constants/workflow-types.js';
import { HandlerPriority as Priority } from '../interfaces/event-handler.js';
import { TOOL_EVENTS } from '@robota-sdk/agents';

/**
 * ToolEventHandler - Handles tool call and response events
 */
export class ToolEventHandler implements EventHandler {
    readonly name = 'ToolEventHandler';
    readonly priority = Priority.HIGH;
    readonly patterns = ['tool.*'];

    private logger: SimpleLogger;

    // Path-only: internal mappings removed (use path for relationships)

    constructor(logger: SimpleLogger = SilentLogger) {
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

    async handle(eventType: string, eventData: EventData): Promise<EventProcessingResult> {
        try {
            this.logger.debug(`🔧 [TOOL-HANDLER] Processing ${eventType}`, { eventData });

            const updates: WorkflowUpdate[] = [];
            let success = true;

            switch (eventType) {
                case TOOL_EVENTS.CALL_START: {
                    const pathInfo = this.extractPathInfo(eventData, TOOL_EVENTS.CALL_START);
                    const toolCallNode = this.createToolCallNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolCallNode });

                    if (!pathInfo.parentId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [
                                `[PATH-ONLY] Missing parent segment for ${TOOL_EVENTS.CALL_START}. Path=${pathInfo.segments.join(' -> ')}`
                            ]
                        };
                    }

                    const edge: WorkflowEdge = {
                        id: EdgeUtils.generateId(pathInfo.parentId, toolCallNode.id, 'executes' as any),
                        source: pathInfo.parentId,
                        target: toolCallNode.id,
                        type: 'executes' as any,
                        timestamp: Date.now()
                    } as any;
                    updates.push({ action: 'create', edge } as any);
                    break;
                }

                case TOOL_EVENTS.CALL_COMPLETE:
                    // Do not create a separate node for call_complete in minimal graph
                    break;

                case TOOL_EVENTS.CALL_ERROR: {
                    const pathInfo = this.extractPathInfo(eventData, TOOL_EVENTS.CALL_ERROR);
                    const toolErrorNode = this.createToolCallErrorNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolErrorNode });
                    break;
                }

                case TOOL_EVENTS.CALL_RESPONSE_READY: {
                    const pathInfo = this.extractPathInfo(eventData, TOOL_EVENTS.CALL_RESPONSE_READY);
                    const toolCallId = pathInfo.nodeId;
                    if (!toolCallId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Empty path.tail for ${TOOL_EVENTS.CALL_RESPONSE_READY}.`]
                        };
                    }

                    // Path-only: tool response is a child of:
                    // - the tool call node (default)
                    // - OR the delegated agent response node (when explicitly provided by tool result)
                    const delegatedResponseNodeId = (() => {
                        const res = (eventData as any)?.result;
                        if (!res || typeof res !== 'object') return undefined;
                        const data = (res as any).data;
                        if (!data || typeof data !== 'object') return undefined;
                        const id = (data as any).delegatedResponseNodeId;
                        return typeof id === 'string' && id.length > 0 ? id : undefined;
                    })();
                    const parentForResponseId: string = delegatedResponseNodeId ?? toolCallId;

                    // Create tool_response node
                    const toolResponseNode = this.createToolResponseNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolResponseNode });

                    // Atomic edge: parent (response or tool_call) → tool_response ('result')
                    const edgeFromParent: WorkflowEdge = {
                        id: EdgeUtils.generateId(parentForResponseId, toolResponseNode.id, 'result' as any),
                        source: parentForResponseId,
                        target: toolResponseNode.id,
                        type: 'result' as any,
                        timestamp: Date.now()
                    } as any;
                    updates.push({ action: 'create', edge: edgeFromParent } as any);

                    break;
                }

                default:
                    this.logger.warn(`⚠️ [TOOL-HANDLER] Unknown event type: ${eventType}`);
                    success = false;
            }

            return {
                success,
                updates,
                metadata: {
                    handlerType: 'tool',
                    eventType,
                    processed: true
                }
            };

        } catch (error) {
            this.logger.error(`❌ [TOOL-HANDLER] Error processing ${eventType}:`, error);
            return {
                success: false,
                updates: [],
                errors: [`ToolEventHandler failed: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerType: 'tool',
                    eventType,
                    error: true
                }
            };
        }
    }

    // =================================================================
    // Node Creation Methods
    // =================================================================

    private createToolCallNode(data: EventData, pathInfo: PathInfo): WorkflowNode {
        const executionId = pathInfo.nodeId || data.executionId || data.sourceId;
        const nodeId = String(executionId); // Use executionId as node id (parent will reference this directly)

        const toolName = String((data as any)?.toolName || data.parameters?.toolName || data.parameters?.name || 'unknown_tool');
        const toolType = this.getToolTypeFromName(toolName);

        return {
            id: nodeId,
            type: toolType,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: String(executionId),
                parentExecutionId: pathInfo.parentId ?? undefined,
                toolName: toolName,
                label: `${toolName} Call`,
                description: `Tool call: ${toolName}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                toolCall: undefined,
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName
                        }
                    }
                }
            },
            connections: []
        };
    }

    private createToolCallCompleteNode(data: EventData): WorkflowNode {
        const executionId = data.executionId || data.sourceId;
        const nodeId = `tool_call_complete_${executionId}`;

        const toolName = String(data.parameters?.toolName || data.result?.toolName || 'unknown_tool');

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: String(executionId),
                parentExecutionId: data.parentExecutionId,
                toolName: toolName,
                label: `${toolName} Complete`,
                description: `Tool call completed: ${toolName}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName
                        }
                    }
                }
            },
            connections: []
        };
    }

    private createToolCallErrorNode(data: EventData, pathInfo: PathInfo): WorkflowNode {
        const executionId = pathInfo.nodeId || data.executionId || data.sourceId;
        const nodeId = `tool_call_error_${executionId}`;

        const toolName = String(data.parameters?.toolName || 'unknown_tool');
        const errorMessage = (data.error instanceof Error ? data.error.message : String(data.error || data.parameters?.error || 'Tool call failed'));

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 2,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: String(executionId),
                parentExecutionId: pathInfo.parentId ?? undefined,
                toolName: toolName,
                label: `${toolName} Error`,
                description: `Tool call error: ${errorMessage}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                error: data.error || { message: errorMessage },
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName,
                            isError: true
                        }
                    }
                }
            },
            connections: []
        };
    }

    private createToolResponseNode(data: EventData, pathInfo: PathInfo): WorkflowNode {
        // Tool response node must be derived from context.ownerPath only (no ID parsing/inference).
        const toolCallId = pathInfo.nodeId;
        if (!toolCallId) {
            throw new Error('[PATH-ONLY] Missing tool call id (path tail) for tool.call_response_ready');
        }
        const nodeId = `tool_response_call_${toolCallId}`;

        const toolName = String(data.parameters?.toolName || data.result?.toolName || 'unknown_tool');
        const result = data.result || {};
        const responseContent = String(result.content || result.output || result.response || 'Tool response');

        // Path-only: no mappings stored

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: String(toolCallId),
                parentExecutionId: pathInfo.parentId ?? undefined,
                toolName: toolName,
                label: `${toolName} Response`,
                description: `Tool response from ${toolName}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: result,
                metadata: data.metadata || {},
                toolResponse: {
                    toolName: toolName,
                    content: responseContent,
                    success: !data.error,
                    timestamp: new Date().toISOString()
                },
                responseMetrics: {
                    responseLength: String(responseContent).length,
                    contentType: typeof responseContent,
                    hasError: !!data.error
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName,
                            toolCallId: toolCallId
                        }
                    }
                }
            },
            connections: []
        };
    }

    // createAgentExecutionStartedNode removed by Decision Gate (6.5)

    // =================================================================
    // Helper Methods
    // =================================================================

    private getToolTypeFromName(toolName: string): WorkflowNodeType {
        // Map tool names to specific node types
        const toolTypeMap: Record<string, WorkflowNodeType> = {
            'assignTask': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'fileRead': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'fileWrite': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'webSearch': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'codeExecution': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'apiCall': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'dataProcessing': WORKFLOW_NODE_TYPES.TOOL_CALL
        };

        return toolTypeMap[toolName] || WORKFLOW_NODE_TYPES.TOOL_CALL;
    }

    private extractPathInfo(eventData: EventData, eventLabel: string): PathInfo {
        const ownerPath = (eventData as any)?.context?.ownerPath as unknown;
        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for ${eventLabel}`);
        }
        const segments = ownerPath.map((seg: any) => String(seg?.id ?? ''));
        if (segments.some(s => !s)) {
            throw new Error(`[PATH-ONLY] Invalid context.ownerPath (missing segment id) for ${eventLabel}`);
        }
        const nodeId = segments[segments.length - 1];
        const parentId = segments.length > 1 ? segments[segments.length - 2] : undefined;
        return { segments, nodeId, parentId };
    }

    // Path-only: mapping methods removed (use path for relationships)

    /**
     * Create tool result aggregation node
     */
    createToolResultNode(thinkingNodeId: string, sourceId: string): WorkflowNode {
        const nodeId = `tool_result_${thinkingNodeId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: sourceId,
                sourceType: 'tool',
                parentThinkingNodeId: thinkingNodeId,
                label: 'Tool Result Aggregation',
                description: 'Aggregating tool call results',
                aggregationInfo: {
                    parentThinking: thinkingNodeId,
                    status: 'aggregating'
                },
                extensions: {
                    robota: {
                        handlerType: 'tool',
                        extra: {
                            isAggregation: true,
                            parentThinkingNodeId: thinkingNodeId
                        }
                    }
                }
            },
            connections: []
        };
    }

    /**
     * Clear handler state (useful for testing and cleanup)
     */
    clear(): void {
        // Path-only: no internal state to clear
        this.logger.debug('🧹 [TOOL-HANDLER] Handler state cleared');
    }
}

interface PathInfo {
    segments: string[];
    nodeId: string;
    parentId?: string;
}