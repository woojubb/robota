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
import { WorkflowState } from '../services/workflow-state.js';
import { HandlerPriority as Priority } from '../interfaces/event-handler.js';

// 🎯 [EVENT-CONSTANTS] Tool events
const TOOL_EVENTS = {
    CALL_START: 'tool.call_start',
    CALL_COMPLETE: 'tool.call_complete',
    CALL_ERROR: 'tool.call_error',
    CALL_RESPONSE_READY: 'tool.call_response_ready'
} as const;

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
                    const pathArr = pathInfo.segments;
                    const pathTail = pathInfo.nodeId; // Usually tool call ID
                    if (!pathTail) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Empty path.tail for ${TOOL_EVENTS.CALL_RESPONSE_READY}.`]
                        };
                    }

                    const nodesAccessor: any[] = (this as any).subscriber?.getAllNodes?.() || [];

                    // Try to find response node directly by path.tail
                    let responseNode = nodesAccessor.find(n => n?.id === pathTail && n?.type === WORKFLOW_NODE_TYPES.RESPONSE);

                    // If path.tail is a tool call ID, find the associated response node
                    if (!responseNode && pathTail.startsWith('call_')) {
                        // Find response node that has this tool call as parentExecutionId
                        responseNode = nodesAccessor.find(n =>
                            n?.type === WORKFLOW_NODE_TYPES.RESPONSE &&
                            String((n as any)?.data?.extensions?.robota?.originalEvent?.parentExecutionId || '') === pathTail
                        );

                        this.logger.debug(`[PATH-TRANSLATION] Tool call ID '${pathTail}' → response node '${responseNode?.id || 'not found'}'`);
                    }

                    // If response node not found, try tool_call as parent (path-tail call_* case)
                    let parentForResponseId: string | undefined = responseNode?.id;
                    if (!parentForResponseId && pathTail.startsWith('call_')) {
                        const callNode = nodesAccessor.find(n => n?.id === pathTail && n?.type === WORKFLOW_NODE_TYPES.TOOL_CALL);
                        if (callNode) {
                            parentForResponseId = callNode.id;
                        }
                    }

                    if (!parentForResponseId) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Cannot find agent_response or tool_call for path.tail '${pathTail}'. Expected response node or tool call node in current snapshot.`]
                        };
                    }

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

                // tool.agent_execution_started removed by Decision Gate (6.5)

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
                parentExecutionId: pathInfo.parentId,
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
                        toolName: toolName
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
                        toolName: toolName
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
                parentExecutionId: pathInfo.parentId,
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
                        toolName: toolName,
                        isError: true
                    }
                }
            },
            connections: []
        };
    }

    private createToolResponseNode(data: EventData, pathInfo: PathInfo): WorkflowNode {
        // Prefer tool call id for response node id; keep current naming for compatibility
        const toolCallId = pathInfo.nodeId || String(data.executionId || data.parentExecutionId || data.sourceId);
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
                parentExecutionId: pathInfo.parentId,
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
                        toolName: toolName,
                        toolCallId: toolCallId
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
        const candidatePaths: unknown[] = [
            (eventData as any).path,
            (eventData as any).ownerPath,
            (eventData.metadata as any)?.path,
            (eventData as any)?.extensions?.robota?.originalEvent?.ownerPath,
            (eventData as any)?.extensions?.robota?.originalEvent?.path
        ];

        for (const candidate of candidatePaths) {
            if (Array.isArray(candidate) && candidate.length > 0) {
                const segments = candidate.map(segment => String(segment));
                const nodeId = segments[segments.length - 1];
                const parentId = segments.length > 1 ? segments[segments.length - 2] : undefined;
                return { segments, nodeId, parentId };
            }
        }

        throw new Error(`[PATH-ONLY] Missing path data for ${eventLabel}`);
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
                        isAggregation: true,
                        parentThinkingNodeId: thinkingNodeId
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