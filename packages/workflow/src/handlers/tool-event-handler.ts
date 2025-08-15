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
                case TOOL_EVENTS.CALL_START:
                    const toolCallNode = this.createToolCallNode(eventData);
                    if ((eventData as any).parentId) toolCallNode.parentId = String((eventData as any).parentId);
                    if (eventData.parentExecutionId) {
                        toolCallNode.parentId = String(eventData.parentExecutionId);
                        this.logger.debug(`🔗 [TOOL-CALL-PARENT] Setting parent: ${toolCallNode.parentId} for tool call: ${toolCallNode.id}`);
                    }
                    updates.push({ action: 'create', node: toolCallNode });
                    // Path-only: no state mappings needed
                    // Explicit edge: thinking → tool_call ('executes')
                    const parentThinking = (eventData as any).metadata?.directParentId || (eventData as any).parentExecutionId;
                    if (parentThinking) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(String(parentThinking), toolCallNode.id, 'executes' as any),
                            source: String(parentThinking),
                            target: toolCallNode.id,
                            type: 'executes' as any,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }
                    break;

                case TOOL_EVENTS.CALL_COMPLETE:
                    // Do not create a separate node for call_complete in minimal graph
                    break;

                case TOOL_EVENTS.CALL_ERROR:
                    const toolErrorNode = this.createToolCallErrorNode(eventData);
                    if ((eventData as any).parentId) toolErrorNode.parentId = String((eventData as any).parentId);
                    // [PATH-ONLY] prevId is no longer used; edges are created explicitly
                    updates.push({ action: 'create', node: toolErrorNode });
                    break;

                case TOOL_EVENTS.CALL_RESPONSE_READY: {
                    // Path-only with tool call ID translation to response ID
                    const pathArr = (eventData as any)?.path as string[] | undefined;
                    if (!Array.isArray(pathArr) || pathArr.length < 1) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Invalid path for ${TOOL_EVENTS.CALL_RESPONSE_READY}: ${JSON.stringify(pathArr)}`]
                        };
                    }

                    const pathTail = String(pathArr[pathArr.length - 1]); // Could be tool call ID or response ID
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

                    if (!responseNode) {
                        return {
                            success: false,
                            updates: [],
                            errors: [`[PATH-ONLY] Cannot find agent_response node for path.tail '${pathTail}'. Expected response node or valid tool call mapping.`]
                        };
                    }

                    // Create tool_response node
                    const toolResponseNode = this.createToolResponseNode(eventData);
                    updates.push({ action: 'create', node: toolResponseNode });

                    // Atomic edge: agent_response → tool_response ('result')
                    const edgeFromResponse: WorkflowEdge = {
                        id: EdgeUtils.generateId(responseNode.id, toolResponseNode.id, 'result' as any),
                        source: responseNode.id,
                        target: toolResponseNode.id,
                        type: 'result' as any,
                        timestamp: Date.now()
                    } as any;
                    updates.push({ action: 'create', edge: edgeFromResponse } as any);

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

    private createToolCallNode(data: EventData): WorkflowNode {
        const executionId = data.executionId || data.sourceId;
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
                parentExecutionId: data.parentExecutionId,
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

    private createToolCallErrorNode(data: EventData): WorkflowNode {
        const executionId = data.executionId || data.sourceId;
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
                parentExecutionId: data.parentExecutionId,
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

    private createToolResponseNode(data: EventData): WorkflowNode {
        // Prefer tool call id for response node id; keep current naming for compatibility
        const toolCallId = String(data.executionId || data.parentExecutionId || data.sourceId);
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
                parentExecutionId: data.parentExecutionId,
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