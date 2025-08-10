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
import type { WorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES, type WorkflowNodeType } from '../constants/workflow-types.js';
import { HandlerPriority as Priority } from '../interfaces/event-handler.js';

/**
 * ToolEventHandler - Handles tool call and response events
 */
export class ToolEventHandler implements EventHandler {
    readonly name = 'ToolEventHandler';
    readonly priority = Priority.HIGH;
    readonly patterns = ['tool.*'];

    private logger: SimpleLogger;

    // Mapping state for tool operations
    private toolCallToThinkingMap = new Map<string, string>(); // tool_call_id → thinking_node_id
    private thinkingToToolResultMap = new Map<string, string>(); // thinking_node_id → tool_result_node_id
    private toolResponseMap = new Map<string, string>(); // tool_call_id → tool_response_id

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
                case 'tool.call_start':
                    const toolCallNode = this.createToolCallNode(eventData);

                    // ✅ Parent is execution node (round owner)
                    if (eventData.parentExecutionId) {
                        toolCallNode.parentId = String(eventData.parentExecutionId);
                        this.logger.debug(`🔗 [TOOL-CALL-PARENT] Setting parent: ${toolCallNode.parentId} for tool call: ${toolCallNode.id}`);
                    }

                    updates.push({ action: 'create', node: toolCallNode });
                    break;

                case 'tool.call_complete':
                    const toolCompleteNode = this.createToolCallCompleteNode(eventData);
                    updates.push({ action: 'create', node: toolCompleteNode });
                    break;

                case 'tool.call_error':
                    const toolErrorNode = this.createToolCallErrorNode(eventData);
                    updates.push({ action: 'create', node: toolErrorNode });
                    break;

                case 'tool.call_response_ready':
                    const toolResponseNode = this.createToolResponseNode(eventData);

                    // ✅ Tool response는 tool call에 연결
                    if (eventData.toolCallId) {
                        const execId = String(eventData.toolCallId);
                        toolResponseNode.parentId = execId;
                        this.logger.debug(`🔗 [TOOL-RESPONSE-PARENT] Setting parent: ${toolResponseNode.parentId} for tool response: ${toolResponseNode.id}`);
                    } else if (eventData.parentExecutionId) {
                        toolResponseNode.parentId = String(eventData.parentExecutionId);
                        this.logger.debug(`🔗 [TOOL-RESPONSE-PARENT] Setting parent: ${toolResponseNode.parentId} for tool response: ${toolResponseNode.id}`);
                    }

                    updates.push({ action: 'create', node: toolResponseNode });
                    break;

                case 'tool.agent_execution_started':
                    const agentExecNode = this.createAgentExecutionStartedNode(eventData);
                    updates.push({ action: 'create', node: agentExecNode });
                    break;

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

        const toolName = String(data.parameters?.toolName || data.parameters?.name || 'unknown_tool');
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
        const executionId = data.executionId || data.sourceId;
        const nodeId = `tool_response_call_${executionId}`;

        const toolName = String(data.parameters?.toolName || data.result?.toolName || 'unknown_tool');
        const result = data.result || {};
        const responseContent = String(result.content || result.output || result.response || 'Tool response');

        // Store mapping for tool call → response relationship
        const toolCallId = String(executionId);
        this.toolResponseMap.set(toolCallId, nodeId);

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: String(executionId),
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

    private createAgentExecutionStartedNode(data: EventData): WorkflowNode {
        const nodeId = `agent_execution_started_${String(data.sourceId)}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: 1,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'tool',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Agent Execution Started',
                description: 'Agent execution started via tool',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                agentInfo: {
                    agentId: String(data.sourceId),
                    startedVia: 'tool',
                    parentTool: String(data.parameters?.parentToolName || 'unknown')
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        triggeredByTool: true
                    }
                }
            },
            connections: []
        };
    }

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

    /**
     * Get tool response node ID for a given tool call ID
     */
    getToolResponseId(toolCallId: string): string | undefined {
        return this.toolResponseMap.get(toolCallId);
    }

    /**
     * Get all tool calls for a thinking node
     */
    getToolCallsForThinking(thinkingNodeId: string): string[] {
        const toolCalls: string[] = [];
        for (const [toolCallId, thinkingId] of this.toolCallToThinkingMap.entries()) {
            if (thinkingId === thinkingNodeId) {
                toolCalls.push(toolCallId);
            }
        }
        return toolCalls;
    }

    /**
     * Associate tool call with thinking node
     */
    associateToolCallWithThinking(toolCallId: string, thinkingNodeId: string): void {
        this.toolCallToThinkingMap.set(toolCallId, thinkingNodeId);
        this.logger.debug(`🔗 [TOOL-HANDLER] Associated ${toolCallId} with thinking ${thinkingNodeId}`);
    }

    /**
     * Get thinking node for tool call
     */
    getThinkingForToolCall(toolCallId: string): string | undefined {
        return this.toolCallToThinkingMap.get(toolCallId);
    }

    /**
     * Create tool result aggregation node
     */
    createToolResultNode(thinkingNodeId: string, sourceId: string): WorkflowNode {
        const nodeId = `tool_result_${thinkingNodeId}_${Date.now()}`;

        // Store mapping
        this.thinkingToToolResultMap.set(thinkingNodeId, nodeId);

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
                    toolCallsCount: this.getToolCallsForThinking(thinkingNodeId).length,
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
        this.toolCallToThinkingMap.clear();
        this.thinkingToToolResultMap.clear();
        this.toolResponseMap.clear();
        this.logger.debug('🧹 [TOOL-HANDLER] Handler state cleared');
    }
}