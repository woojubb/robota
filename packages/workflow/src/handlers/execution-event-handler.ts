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
import type { WorkflowUpdate } from '../interfaces/workflow-builder.js';
import { WORKFLOW_NODE_TYPES } from '../constants/workflow-types.js';
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
                case 'execution.start':
                    const executionStartNode = this.createExecutionStartNode(eventData);
                    updates.push({ action: 'create', node: executionStartNode });
                    this.executionNodeMap.set(String(eventData.executionId), executionStartNode.id);
                    break;

                case 'execution.complete':
                    const executionCompleteNode = this.createExecutionCompleteNode(eventData);
                    updates.push({ action: 'create', node: executionCompleteNode });
                    break;

                case 'execution.error':
                    const executionErrorNode = this.createExecutionErrorNode(eventData);
                    updates.push({ action: 'create', node: executionErrorNode });
                    break;

                case 'execution.assistant_message_start':
                    const assistantStartNode = this.createAssistantMessageStartNode(eventData);
                    updates.push({ action: 'create', node: assistantStartNode });
                    this.assistantMessageMap.set(String(eventData.executionId), assistantStartNode.id);
                    break;

                case 'execution.assistant_message_complete':
                    const assistantCompleteNode = this.createAssistantMessageCompleteNode(eventData);
                    updates.push({ action: 'create', node: assistantCompleteNode });
                    break;

                case 'user.message':
                    const userMessageNode = this.createUserMessageNode(eventData);
                    // Parent from context only
                    if (eventData.parentExecutionId) {
                        userMessageNode.parentId = String(eventData.parentExecutionId);
                    }
                    updates.push({ action: 'create', node: userMessageNode });
                    this.userMessageNodeMap.set(String(eventData.sourceId), userMessageNode.id);
                    break;

                case 'user.input':
                    const userInputNode = this.createUserInputNode(eventData);
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