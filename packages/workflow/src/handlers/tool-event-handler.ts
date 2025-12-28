/**
 * ToolEventHandler - Handles tool-related events
 * 
 * Processes tool.* events and creates appropriate workflow nodes
 * Based on existing implementation in workflow-event-subscriber.ts
 */

import type { IOwnerPathSegment, ILogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type {
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import type { IWorkflowNode } from '../interfaces/workflow-node.js';
import type { IWorkflowEdge } from '../interfaces/workflow-edge.js';
import { EdgeUtils } from '../interfaces/workflow-edge.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES, type TWorkflowNodeKind } from '../constants/workflow-types.js';
import { HandlerPriority } from '../interfaces/event-handler.js';
import { TOOL_EVENTS } from '@robota-sdk/agents';
import type { IPathInfo } from './path-info.js';

/**
 * ToolEventHandler - Handles tool call and response events
 */
export class ToolEventHandler implements IEventHandler {
    readonly name = 'ToolEventHandler';
    readonly priority = HandlerPriority.HIGH;
    readonly patterns = ['tool.*'];

    private logger: ILogger;

    // Path-only: internal mappings removed (use path for relationships)

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
            this.logger.debug(`🔧 [TOOL-HANDLER] Processing ${eventType}`);

            const updates: TWorkflowUpdate[] = [];
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

                    const edge: IWorkflowEdge = {
                        id: EdgeUtils.generateId(pathInfo.parentId, toolCallNode.id, 'executes'),
                        source: pathInfo.parentId,
                        target: toolCallNode.id,
                        type: 'executes',
                        timestamp: Date.now()
                    };
                    updates.push({ action: 'create', edge });
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
                    // - the delegated agent response node (preferred, derived via explicit ownerPath)
                    // - OR an explicitly provided delegated response node id (when present on tool result)
                    const delegatedResponseNodeId = (() => {
                        const res = eventData.result;
                        if (!res || typeof res !== 'object') return undefined;
                        if (!('delegatedResponseNodeId' in res)) return undefined;
                        const id = res.delegatedResponseNodeId;
                        return typeof id === 'string' && id.length > 0 ? id : undefined;
                    })();
                    const delegatedResponseFromGraph = this.findLatestResponseNodeIdForToolCall(toolCallId);
                    // Deterministic parent selection:
                    // - If a delegated response node exists (delegated agent flow), connect from it (prevents tool_call forks).
                    // - Otherwise (local tool flow), connect from tool_call node itself.
                    const parentForResponseId: string =
                        delegatedResponseNodeId ?? delegatedResponseFromGraph ?? toolCallId;

                    // Create tool_response node
                    const toolResponseNode = this.createToolResponseNode(eventData, pathInfo);
                    updates.push({ action: 'create', node: toolResponseNode });

                    // Atomic edge: parent (response or tool_call) → tool_response ('result')
                    const edgeFromParent: IWorkflowEdge = {
                        id: EdgeUtils.generateId(parentForResponseId, toolResponseNode.id, 'result'),
                        source: parentForResponseId,
                        target: toolResponseNode.id,
                        type: 'result',
                        timestamp: Date.now()
                    };
                    updates.push({ action: 'create', edge: edgeFromParent });

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
            this.logger.error(
                `❌ [TOOL-HANDLER] Error processing ${eventType}:`,
                error instanceof Error ? error : new Error(String(error))
            );
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

    private createToolCallNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const toolCallId = pathInfo.nodeId;
        const nodeId = toolCallId; // Use toolCallId as node id (parent will reference this directly)

        const toolName =
            typeof (data as { toolName?: unknown }).toolName === 'string'
                ? String((data as { toolName?: string }).toolName)
                : (typeof data.parameters?.toolName === 'string'
                    ? data.parameters.toolName
                    : (typeof data.parameters?.name === 'string'
                        ? data.parameters.name
                        : 'unknown_tool'));
        const toolType = this.getToolTypeFromName(toolName);

        return {
            id: nodeId,
            type: toolType,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
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

    private createToolCallCompleteNode(data: TEventData): IWorkflowNode {
        const toolCallId = this.extractPathInfo(data, 'tool.call_complete').nodeId;
        const nodeId = `tool_call_complete_${toolCallId}`;

        const toolName = typeof data.parameters?.toolName === 'string'
            ? data.parameters.toolName
            : (data.result && typeof data.result === 'object' && 'toolName' in data.result && typeof data.result.toolName === 'string'
                ? data.result.toolName
                : 'unknown_tool');

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_CALL,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
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

    private createToolCallErrorNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const toolCallId = pathInfo.nodeId;
        const nodeId = `tool_call_error_${toolCallId}`;

        const toolName = typeof data.parameters?.toolName === 'string' ? data.parameters.toolName : 'unknown_tool';
        const errorMessage = (data.error instanceof Error ? data.error.message : String(data.error || data.parameters?.error || 'Tool call failed'));

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 2,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
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

    private createToolResponseNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        // Tool response node must be derived from context.ownerPath only (no ID parsing/inference).
        const toolCallId = pathInfo.nodeId;
        if (!toolCallId) {
            throw new Error('[PATH-ONLY] Missing tool call id (path tail) for tool.call_response_ready');
        }
        const nodeId = `tool_response_call_${toolCallId}`;

        const toolName = typeof data.parameters?.toolName === 'string'
            ? data.parameters.toolName
            : (data.result && typeof data.result === 'object' && 'toolName' in data.result && typeof data.result.toolName === 'string'
                ? data.result.toolName
                : 'unknown_tool');
        const result = data.result || {};
        const responseContent = (() => {
            if (result && typeof result === 'object') {
                if ('content' in result && typeof result.content === 'string') return result.content;
                if ('output' in result && typeof result.output === 'string') return result.output;
                if ('response' in result && typeof result.response === 'string') return result.response;
            }
            return 'Tool response';
        })();

        // Path-only: no mappings stored

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
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

    private getToolTypeFromName(toolName: string): TWorkflowNodeKind {
        // Map tool names to specific node types
        const toolTypeMap: Record<string, TWorkflowNodeKind> = {
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

    private extractPathInfo(eventData: TEventData, eventLabel: string): IPathInfo {
        const ownerPath: IOwnerPathSegment[] = eventData.context.ownerPath;
        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for ${eventLabel}`);
        }
        const segments = ownerPath.map((seg) => String(seg.id ?? ''));
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
    createToolResultNode(thinkingNodeId: string, sourceId: string): IWorkflowNode {
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

    private findLatestResponseNodeIdForToolCall(toolCallId: string): string | undefined {
        // Path-only allowed scan: match by explicit ownerPath segment `{ type: 'tool', id: toolCallId }`
        try {
            const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];
            let best: { id: string; ts: number } | undefined;
            for (const node of nodesAccessor) {
                if (node?.type !== WORKFLOW_NODE_TYPES.RESPONSE) continue;
                const orig = node?.data?.extensions?.robota?.originalEvent;
                const ownerPath = orig?.context?.ownerPath;
                if (!Array.isArray(ownerPath) || ownerPath.length === 0) continue;
                const matchesToolScope = ownerPath.some((seg: any) => seg?.type === 'tool' && String(seg?.id ?? '') === toolCallId);
                if (!matchesToolScope) continue;
                const ts = Number(node?.timestamp || 0);
                const id = String(node?.id ?? '');
                if (!id) continue;
                if (!best || ts > best.ts) best = { id, ts };
            }
            return best?.id;
        } catch {
            return undefined;
        }
    }

    /**
     * Clear handler state (useful for testing and cleanup)
     */
    clear(): void {
        // Path-only: no internal state to clear
        this.logger.debug('🧹 [TOOL-HANDLER] Handler state cleared');
    }
}
