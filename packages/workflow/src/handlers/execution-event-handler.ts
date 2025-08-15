/**
 * ExecutionEventHandler - Handles execution-related events
 * 
 * Processes execution.* events and creates appropriate workflow nodes
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
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
import { WorkflowState } from '../services/workflow-state.js';
import { HandlerPriority as Priority } from '../interfaces/event-handler.js';

/**
 * ExecutionEventHandler - Handles execution lifecycle events
 */
export class ExecutionEventHandler implements EventHandler {
    readonly name = 'ExecutionEventHandler';
    readonly priority = Priority.HIGHEST; // Execution events are fundamental
    readonly patterns = ['execution.*', 'user.*'];

    private logger: SimpleLogger;

    // Mapping state for execution tracking
    private executionNodeMap = new Map<string, string>(); // executionId → nodeId
    private userMessageNodeMap = new Map<string, string>(); // messageId → nodeId
    private assistantMessageMap = new Map<string, string>(); // executionId → assistantMessageNodeId

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
            this.logger.debug(`🔧 [EXECUTION-HANDLER] Processing ${eventType}`, { eventData });

            const updates: WorkflowUpdate[] = [];
            let success = true;

            switch (eventType) {
                case 'execution.tool_results_ready': {
                    // Path-only: thinking scope = eventData.path
                    const parentPath = Array.isArray((eventData as any).path) ? (eventData as any).path : [];
                    const thinkingId = String(parentPath[parentPath.length - 1] || '');
                    if (!thinkingId) break;
                    // Collect existing tool_response nodes by checking originalEvent.path prefix match
                    const nodesAccessor: any = (this as any).subscriber?.getAllNodes?.() || [];
                    const toolResponses = nodesAccessor.filter((n: any) => n?.type === WORKFLOW_NODE_TYPES.TOOL_RESPONSE &&
                        Array.isArray(n?.data?.extensions?.robota?.originalEvent?.path) &&
                        n.data.extensions.robota.originalEvent.path.slice(0, -1).join('\u0000') === parentPath.join('\u0000'));
                    if (toolResponses.length === 0) break;
                    const nodeId = `tool_result_${thinkingId}_${Date.now()}`;
                    const toolResultNode: WorkflowNode = {
                        id: nodeId,
                        type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
                        level: 2,
                        status: 'running',
                        timestamp: Date.now(),
                        data: {
                            sourceId: String(eventData.sourceId || 'execution'),
                            sourceType: 'execution',
                            parentThinkingNodeId: thinkingId,
                            label: 'Tool Result Aggregation',
                            description: 'Aggregating tool call results',
                            extensions: { robota: { originalEvent: eventData } }
                        },
                        connections: []
                    } as unknown as WorkflowNode;
                    updates.push({ action: 'create', node: toolResultNode });
                    for (const tr of toolResponses) {
                        const edge: WorkflowEdge = {
                            id: EdgeUtils.generateId(tr.id, nodeId, 'result' as any),
                            source: tr.id,
                            target: nodeId,
                            type: 'result' as any,
                            timestamp: Date.now()
                        } as any;
                        updates.push({ action: 'create', edge } as any);
                    }
                    break;
                }
                case 'execution.start':
                    // Do not create execution node here; AgentEventHandler creates agent node instead
                    break;

                case 'execution.complete':
                    // Do not create a node for execution complete (minimal graph)
                    break;

                case 'execution.error':
                    const executionErrorNode = this.createExecutionErrorNode(eventData);
                    if ((eventData as any).parentId) executionErrorNode.parentId = String((eventData as any).parentId);
                    // [PATH-ONLY] prevId is no longer used; edges are created explicitly
                    updates.push({ action: 'create', node: executionErrorNode });
                    break;

                case 'execution.assistant_message_start':
                    // AgentEventHandler will create the thinking node; skip assistant_message node
                    // Maintain internal mapping to allow fallbacks if needed
                    break;

                case 'execution.assistant_message_complete':
                    // AgentEventHandler will create the response node; skip assistant_message node
                    break;

                case 'execution.tool_results_to_llm':
                    // Domain-neutral: delivery event to LLM, no graph mutation required
                    // Treat as successfully handled to avoid strict-policy aborts
                    break;

                case 'user.message':
                    {
                        const userMessageNode = this.createUserMessageNode(eventData);
                        if ((eventData as any).parentId) userMessageNode.parentId = String((eventData as any).parentId);
                        if (eventData.parentExecutionId) {
                            userMessageNode.parentId = String(eventData.parentExecutionId);
                        }
                        updates.push({ action: 'create', node: userMessageNode });
                        this.userMessageNodeMap.set(String(eventData.sourceId), userMessageNode.id);
                        // Explicit edge: agent → user_message ('receives') with robust lookup
                        const candidateExecIds = [
                            String(eventData.executionId || ''),
                            String(eventData.parentExecutionId || ''),
                            String(eventData?.metadata?.executionId || '')
                        ].filter(Boolean);
                        const candidateRootIds = [
                            String(eventData.rootExecutionId || ''),
                            String(eventData?.metadata?.conversationId || ''),
                            String(eventData.sourceId || '')
                        ].filter(Boolean);
                        let agentNodeForExec: string | undefined;
                        for (const id of candidateExecIds) {
                            agentNodeForExec = WorkflowState.getAgentForExecution(id);
                            if (agentNodeForExec) break;
                        }
                        if (!agentNodeForExec) {
                            for (const id of candidateRootIds) {
                                agentNodeForExec = WorkflowState.getAgentForRoot(id);
                                if (agentNodeForExec) break;
                            }
                        }
                        if (agentNodeForExec) {
                            const edge: WorkflowEdge = {
                                id: EdgeUtils.generateId(agentNodeForExec, userMessageNode.id, 'receives' as any),
                                source: agentNodeForExec,
                                target: userMessageNode.id,
                                type: 'receives' as any,
                                timestamp: Date.now()
                            } as any;
                            updates.push({ action: 'create', edge } as any);
                        }
                        // Record last user message under multiple context keys for robust lookup
                        {
                            const keys = [
                                String(eventData.executionId || ''),
                                String(eventData.parentExecutionId || ''),
                                String(eventData.rootExecutionId || ''),
                                String(eventData.sourceId || ''),
                                String(eventData?.metadata?.executionId || ''),
                                String(eventData?.metadata?.conversationId || '')
                            ].filter(Boolean);
                            for (const key of keys) {
                                WorkflowState.setLastUserMessage(key, userMessageNode.id);
                            }
                        }
                        break;
                    }

                case 'execution.user_message':
                    {
                        const userMessageNode = this.createUserMessageNode(eventData);
                        if ((eventData as any).parentId) userMessageNode.parentId = String((eventData as any).parentId);
                        if (eventData.parentExecutionId) {
                            userMessageNode.parentId = String(eventData.parentExecutionId);
                        }
                        updates.push({ action: 'create', node: userMessageNode });
                        this.userMessageNodeMap.set(String(eventData.sourceId), userMessageNode.id);
                        const rootId = String(eventData.rootExecutionId || eventData.sourceId || '');
                        // Explicit edge: agent → user_message ('receives') with robust lookup
                        const candidateExecIds2 = [
                            String(eventData.executionId || ''),
                            String(eventData.parentExecutionId || ''),
                            String(eventData?.metadata?.executionId || '')
                        ].filter(Boolean);
                        const candidateRootIds2 = [
                            rootId,
                            String(eventData?.metadata?.conversationId || '')
                        ].filter(Boolean);
                        let agentNodeForExec2: string | undefined;
                        for (const id of candidateExecIds2) {
                            agentNodeForExec2 = WorkflowState.getAgentForExecution(id);
                            if (agentNodeForExec2) break;
                        }
                        if (!agentNodeForExec2) {
                            for (const id of candidateRootIds2) {
                                agentNodeForExec2 = WorkflowState.getAgentForRoot(id);
                                if (agentNodeForExec2) break;
                            }
                        }
                        if (agentNodeForExec2) {
                            const edge: WorkflowEdge = {
                                id: EdgeUtils.generateId(agentNodeForExec2, userMessageNode.id, 'receives' as any),
                                source: agentNodeForExec2,
                                target: userMessageNode.id,
                                type: 'receives' as any,
                                timestamp: Date.now()
                            } as any;
                            updates.push({ action: 'create', edge } as any);
                        }
                        // Record last user message under multiple context keys for robust lookup
                        {
                            const keys = [
                                String(eventData.executionId || ''),
                                String(eventData.parentExecutionId || ''),
                                String(eventData.rootExecutionId || ''),
                                String(eventData.sourceId || ''),
                                String(eventData?.metadata?.executionId || ''),
                                String(eventData?.metadata?.conversationId || '')
                            ].filter(Boolean);
                            for (const key of keys) {
                                WorkflowState.setLastUserMessage(key, userMessageNode.id);
                            }
                        }
                        break;
                    }

                case 'user.input':
                    const userInputNode = this.createUserInputNode(eventData);
                    if ((eventData as any).parentId) userInputNode.parentId = String((eventData as any).parentId);
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
            this.logger.error(`❌ [EXECUTION-HANDLER] Error processing ${eventType}:`, error);
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

    private createExecutionStartNode(data: EventData): WorkflowNode {
        const nodeId = String(data.executionId);

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.EXECUTION,
            level: 0,
            status: 'running',
            timestamp: Date.now(), // Node creation time for ordering
            data: {
                sourceId: data.sourceId,
                sourceType: 'execution',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                // 🎯 Preserve original event timestamp from EventService
                originalEventTimestamp: data.timestamp, // Original event occurrence time
                label: 'Execution Start',
                description: 'Agent execution started',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                executionInfo: {
                    executionId: data.executionId,
                    startTime: new Date().toISOString(),
                    level: data.executionLevel || 1,
                    isRoot: !data.parentExecutionId
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isExecutionStart: true
                    }
                }
            },
            parentId: data.parentExecutionId ? String(data.parentExecutionId) : undefined,
            connections: []
        };
    }

    private createExecutionCompleteNode(data: EventData): WorkflowNode {
        const nodeId = `execution_complete_${data.executionId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.EXECUTION,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'execution',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Execution Complete',
                description: 'Agent execution completed successfully',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                executionInfo: {
                    executionId: data.executionId,
                    endTime: new Date().toISOString(),
                    level: data.executionLevel || 1,
                    duration: data.metadata?.duration || 0,
                    success: true
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isExecutionComplete: true
                    }
                }
            },
            parentId: data.parentExecutionId ? String(data.parentExecutionId) : undefined,
            connections: []
        };
    }

    private createExecutionErrorNode(data: EventData): WorkflowNode {
        const nodeId = `execution_error_${data.executionId}_${Date.now()}`;
        const errorMessage = (data.error instanceof Error ? data.error.message : String(data.error || data.parameters?.error || 'Execution failed'));

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 0,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'execution',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Execution Error',
                description: `Execution failed: ${errorMessage}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                error: data.error || { message: errorMessage },
                metadata: data.metadata || {},
                executionInfo: {
                    executionId: data.executionId,
                    errorTime: new Date().toISOString(),
                    level: data.executionLevel || 1,
                    success: false
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isExecutionError: true
                    }
                }
            },
            parentId: data.parentExecutionId ? String(data.parentExecutionId) : undefined,
            connections: []
        };
    }

    private createAssistantMessageStartNode(data: EventData): WorkflowNode {
        const nodeId = `assistant_message_start_${data.executionId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE,
            level: 1,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'execution',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
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
                        isAssistantMessage: true
                    }
                }
            },
            parentId: data.parentExecutionId ? String(data.parentExecutionId) : undefined,
            connections: []
        };
    }

    private createAssistantMessageCompleteNode(data: EventData): WorkflowNode {
        const nodeId = `assistant_message_complete_${data.executionId}_${Date.now()}`;
        const messageContent = String(data.result?.content || data.parameters?.content || 'Assistant response');
        const messageLength = messageContent.length;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE,
            level: 1,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'execution',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
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
                    responseTime: data.metadata?.responseTime || 0,
                    tokenCount: data.metadata?.tokenCount || 0,
                    hasCodeBlocks: /```/.test(messageContent),
                    hasLinks: /https?:\/\//.test(messageContent),
                    complexity: messageLength > 1000 ? 'high' : messageLength > 300 ? 'medium' : 'low'
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isAssistantMessage: true
                    }
                }
            },
            parentId: data.parentExecutionId ? String(data.parentExecutionId) : undefined,
            connections: []
        };
    }

    private createUserMessageNode(data: EventData): WorkflowNode {
        const nodeId = String(data.sourceId);
        const messageContent = String(data.parameters?.content || data.parameters?.message || 'User message');

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'user',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'User Message',
                description: 'User input message',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                messageInfo: {
                    messageId: data.sourceId,
                    content: messageContent,
                    length: messageContent.length,
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isUserMessage: true
                    }
                }
            },
            connections: []
        };
    }

    private createUserInputNode(data: EventData): WorkflowNode {
        const nodeId = `user_input_${data.sourceId}_${Date.now()}`;
        const inputContent = String(data.parameters?.input || data.parameters?.content || 'User input');

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: data.sourceId,
                sourceType: 'user',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'User Input',
                description: 'User provided input',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                inputInfo: {
                    inputId: data.sourceId,
                    content: inputContent,
                    inputType: data.parameters?.inputType || 'text',
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        isUserInput: true
                    }
                }
            },
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

    /**
     * Check if execution is root level (no parent)
     */
    isRootExecution(data: EventData): boolean {
        return !data.parentExecutionId;
    }

    /**
     * Get execution level from data
     */
    getExecutionLevel(data: EventData): number {
        return data.executionLevel || (this.isRootExecution(data) ? 1 : 2);
    }

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