/**
 * TeamEventHandler - Handles team-related events
 * 
 * Processes team.* events and creates appropriate workflow nodes
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
import { WorkflowState } from '../services/workflow-state.js';

/**
 * TeamEventHandler - Handles team collaboration events
 */
export class TeamEventHandler implements EventHandler {
    readonly name = 'TeamEventHandler';
    readonly priority = Priority.HIGH;
    readonly patterns = ['team.*'];

    private logger: SimpleLogger;
    // Collect tool_response node ids per thinking to support proper join aggregation
    private toolResponsesByThinking: Map<string, Set<string>> = new Map();
    private thinkingToToolResultId = new Map<string, string>(); // Ensure single tool_result per thinking

    // Mapping state for team operations
    private agentNumberCounter = 0;
    private agentCopyCounters = new Map<number, number>();
    private agentNodeIdMap = new Map<string, string>(); // sourceId → nodeId
    private taskNodeIdMap = new Map<string, string>(); // taskId → nodeId

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
            this.logger.debug(`🔧 [TEAM-HANDLER] Processing ${eventType}`, { eventData });

            const updates: WorkflowUpdate[] = [];
            let success = true;

            switch (eventType) {
                case 'team.analysis_start':
                    // No node creation for analysis start (domain-neutral minimal graph)
                    break;

                case 'team.analysis_complete':
                    // No node creation for analysis complete
                    break;

                case 'team.task_assigned':
                    // No node creation for task assigned
                    // this.taskNodeIdMap.set(String(eventData.sourceId), taskNode.id);
                    break;

                case 'team.task_completed':
                    // No node creation for task completed
                    break;

                case 'team.agent_creation_start':
                    // No node creation for creation start
                    break;

                case 'team.agent_creation_complete':
                    // No node creation for creation complete
                    break;

                case 'team.agent_execution_start':
                    // No node creation for generic start (avoid duplicates)
                    break;
                case 'team.agent_execution_started':
                    // Do not create a node for team.agent_execution_started (avoid duplicate paths)
                    break;

                case 'team.agent_execution_complete':
                    // No node creation for complete
                    break;

                case 'team.tool_response_ready':
                    // ✅ Team 도메인에서 발생하는 tool response ready 처리 (올바른 소유권)
                    const toolCallResponseNode = this.createToolCallResponseNode(eventData);
                    if ((eventData as any).parentId) toolCallResponseNode.parentId = String((eventData as any).parentId);
                    (toolCallResponseNode.data as any).prevId = (eventData as any).prevId;
                    updates.push({ action: 'create', node: toolCallResponseNode });
                    // Collect per-thinking for later aggregation join
                    {
                        const toolCallId = String(eventData.parentExecutionId || eventData.executionId || '');
                        const toolCtx = WorkflowState.getToolCallContext(toolCallId);
                        const thinkingId = String(toolCtx?.thinkingId || toolCallId);
                        const set = this.toolResponsesByThinking.get(thinkingId) || new Set<string>();
                        set.add(toolCallResponseNode.id);
                        this.toolResponsesByThinking.set(thinkingId, set);
                        // If tool_result already exists for this thinking, append this response immediately
                        const existingToolResultId = this.thinkingToToolResultId.get(thinkingId);
                        if (existingToolResultId) {
                            const updateNode: WorkflowNode = {
                                id: existingToolResultId,
                                type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
                                level: 2,
                                status: 'running',
                                timestamp: Date.now(),
                                data: { prevIds: Array.from(set) },
                                connections: []
                            } as unknown as WorkflowNode;
                            updates.push({ action: 'update', node: updateNode });
                        }
                    }
                    break;

                case 'team.aggregation_complete':
                    // Create tool_result aggregation node instead of generic aggregation
                    if (!eventData.parentExecutionId) {
                        break;
                    }
                    // parentExecutionId is toolCallId in our event flow; resolve thinking and main exec
                    const toolCallId = String(eventData.parentExecutionId);
                    const toolCtx = WorkflowState.getToolCallContext(toolCallId);
                    const thinkingId = String(toolCtx?.thinkingId || toolCallId);
                    const collectedSet = this.toolResponsesByThinking.get(thinkingId) || new Set<string>();
                    const prevIds = Array.from(collectedSet);
                    const existingToolResultId = this.thinkingToToolResultId.get(thinkingId);
                    if (existingToolResultId) {
                        // Update existing tool_result node by appending prevIds
                        const updateNode: WorkflowNode = {
                            id: existingToolResultId,
                            type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
                            level: 2,
                            status: 'running',
                            timestamp: Date.now(),
                            data: { prevIds },
                            connections: []
                        } as unknown as WorkflowNode;
                        updates.push({ action: 'update', node: updateNode });
                    } else {
                        const toolResultNode = this.createToolResultNode(thinkingId, String(eventData.sourceId));
                        if (prevIds.length > 0) {
                            (toolResultNode.data as any).prevIds = prevIds;
                        }
                        updates.push({ action: 'create', node: toolResultNode });
                        this.thinkingToToolResultId.set(thinkingId, toolResultNode.id);
                    }
                    // Persist last aggregation (tool_result) for both thinking scope and main execution scope
                    const savedId = this.thinkingToToolResultId.get(thinkingId) as string;
                    WorkflowState.setLastAggregation(thinkingId, savedId);
                    if (toolCtx?.mainExecutionId) {
                        WorkflowState.setLastAggregation(String(toolCtx.mainExecutionId), savedId);
                    }
                    // Keep collected responses until round changes (do not clear to allow accumulation)
                    break;

                default:
                    this.logger.warn(`⚠️ [TEAM-HANDLER] Unknown event type: ${eventType}`);
                    success = false;
            }

            return {
                success,
                updates,
                metadata: {
                    handlerType: 'team',
                    eventType,
                    processed: true
                }
            };

        } catch (error) {
            this.logger.error(`❌ [TEAM-HANDLER] Error processing ${eventType}:`, error);
            return {
                success: false,
                updates: [],
                errors: [`TeamEventHandler failed: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerType: 'team',
                    eventType,
                    error: true
                }
            };
        }
    }

    // =================================================================
    // Node Creation Methods
    // =================================================================

    private createAnalysisStartNode(data: EventData): WorkflowNode {
        const nodeId = `team_analysis_start_${data.sourceId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TEAM_ANALYSIS,
            level: 0,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Team Analysis Start',
                description: 'Team collaboration analysis started',
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team'
                    }
                }
            },
            connections: []
        };
    }

    private createAnalysisCompleteNode(data: EventData): WorkflowNode {
        const nodeId = `team_analysis_complete_${data.sourceId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TEAM_ANALYSIS,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Team Analysis Complete',
                description: 'Team collaboration analysis completed',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team'
                    }
                }
            },
            connections: []
        };
    }

    private createTaskAssignedNode(data: EventData): WorkflowNode {
        const agentNumber = this.getNextAgentNumber();
        const nodeId = `task_assigned_agent_${agentNumber}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TASK,
            level: 1,
            status: 'pending',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                agentNumber: agentNumber,
                label: `Task Assigned to Agent ${agentNumber}`,
                description: `Task assigned to agent for execution`,
                taskDescription: data.parameters?.taskDescription || 'Task execution',
                assignedTo: `agent_${agentNumber}`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team',
                        agentNumber: agentNumber
                    }
                }
            },
            connections: []
        };
    }

    private createTaskCompletedNode(data: EventData): WorkflowNode {
        const nodeId = `task_completed_${data.sourceId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TASK,
            level: 1,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Task Completed',
                description: 'Task execution completed successfully',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team'
                    }
                }
            },
            connections: []
        };
    }

    private createAgentCreationStartNode(data: EventData): WorkflowNode {
        const agentNumber = this.getAgentNumberFromData(data);
        const nodeId = `agent_creation_start_${agentNumber}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.AGENT_CREATION,
            level: 1,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Creation Start`,
                description: `Agent ${agentNumber} creation process started`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team',
                        agentNumber: agentNumber
                    }
                }
            },
            connections: []
        };
    }

    private createAgentCreationCompleteNode(data: EventData): WorkflowNode {
        const agentNumber = this.getAgentNumberFromData(data);
        const copyNumber = this.getNextCopyNumber(agentNumber);
        const nodeId = `agent_${agentNumber}_copy_${copyNumber}`;

        // Store mapping for future reference
        this.agentNodeIdMap.set(String(data.sourceId), nodeId);

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: 1,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                agentNumber: agentNumber,
                copyNumber: copyNumber,
                label: `Agent ${agentNumber} Copy ${copyNumber}`,
                description: `Agent ${agentNumber} instance ${copyNumber} created`,
                agentTemplate: String(data.parameters?.agentTemplate || 'default'),
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team',
                        agentNumber: agentNumber,
                        copyNumber: copyNumber
                    }
                }
            },
            connections: []
        };
    }

    private createAgentExecutionStartNode(data: EventData): WorkflowNode {
        // Record as a team-domain info node instead of execution node to avoid cross-domain duplication
        const agentNumber = this.getAgentNumberFromData(data);
        const nodeId = `team_agent_execution_start_${agentNumber}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TEAM_ANALYSIS,
            level: 1,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                agentNumber: agentNumber,
                label: `Team: Agent ${agentNumber} Execution Start`,
                description: `Team observed agent ${agentNumber} execution start`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team',
                        note: 'team-domain record of agent execution start'
                    }
                }
            },
            connections: []
        };
    }

    private createAgentExecutionCompleteNode(data: EventData): WorkflowNode {
        const agentNumber = this.getAgentNumberFromData(data);
        const nodeId = `team_agent_execution_complete_${agentNumber}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TEAM_ANALYSIS,
            level: 1,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                agentNumber: agentNumber,
                label: `Team: Agent ${agentNumber} Execution Complete`,
                description: `Team observed agent ${agentNumber} execution completed`,
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team',
                        note: 'team-domain record of agent execution complete'
                    }
                }
            },
            connections: []
        };
    }

    private createToolResponseReadyNode(data: EventData): WorkflowNode {
        const nodeId = `tool_response_ready_${data.sourceId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Tool Response Ready',
                description: 'Tool response is ready for processing',
                toolName: String(data.parameters?.toolName || 'unknown'),
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team'
                    }
                }
            },
            connections: []
        };
    }

    private createAggregationCompleteNode(data: EventData): WorkflowNode {
        const nodeId = `aggregation_complete_${data.sourceId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.AGGREGATION,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: String(data.sourceId),
                sourceType: 'team',
                executionId: data.executionId,
                parentExecutionId: data.parentExecutionId,
                label: 'Aggregation Complete',
                description: 'Team task aggregation completed',
                eventType: data.eventType,
                parameters: data.parameters || {},
                result: data.result || {},
                metadata: data.metadata || {},
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'team'
                    }
                }
            },
            connections: []
        };
    }

    /**
     * Create tool result aggregation node (domain-neutral join node)
     */
    private createToolResultNode(thinkingNodeId: string, sourceId: string): WorkflowNode {
        const nodeId = `tool_result_${thinkingNodeId}_${Date.now()}`;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: sourceId,
                sourceType: 'team',
                parentThinkingNodeId: thinkingNodeId,
                label: 'Tool Result Aggregation',
                description: 'Aggregating tool call results',
                aggregationInfo: {
                    parentThinking: thinkingNodeId,
                    status: 'aggregating'
                },
                extensions: {
                    robota: {
                        handlerType: 'team',
                        isAggregation: true,
                        parentThinkingNodeId: thinkingNodeId
                    }
                }
            },
            connections: []
        };
    }

    // =================================================================
    // Helper Methods
    // =================================================================

    private getNextAgentNumber(): number {
        return ++this.agentNumberCounter;
    }

    private getAgentNumberFromData(data: EventData): number {
        // Try to extract agent number from existing data
        if (data.parameters?.agentNumber) {
            return Number(data.parameters.agentNumber);
        }
        if (data.metadata?.agentNumber) {
            return Number(data.metadata.agentNumber);
        }
        // Generate new agent number if not found
        return this.getNextAgentNumber();
    }

    private getNextCopyNumber(agentNumber: number): number {
        const current = this.agentCopyCounters.get(agentNumber) || 0;
        const next = current + 1;
        this.agentCopyCounters.set(agentNumber, next);
        return next;
    }

    /**
     * Create tool call response node from team context
     */
    private createToolCallResponseNode(data: EventData): WorkflowNode {
        const executionId = data.executionId || data.sourceId;
        // Prefer parentExecutionId (tool_call id) to guarantee uniqueness per tool call
        const toolCallId = data.parentExecutionId ? String(data.parentExecutionId) : String(executionId);
        const nodeId = `tool_response_call_${toolCallId}`;

        const toolName = String(data.parameters?.toolName || data.result?.toolName || 'assignTask');
        const result = data.result || {};
        const responseContent = String(result.content || result.output || result.response || 'Tool response');

        // ✅ Tool call response는 해당 tool call에 연결 (parentExecutionId는 부모 노드의 실제 ID)
        const parentId = data.parentExecutionId ? String(data.parentExecutionId) : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            parentId,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                eventType: 'team.tool_response_ready', // ✅ 올바른 소유권: team.* 접두어
                sourceId: String(data.sourceId),
                executionId: String(executionId),
                originalEventTimestamp: data.timestamp || new Date(),
                label: `Tool Response: ${toolName}`,
                description: `Response from ${toolName} tool`,
                toolName,
                parameters: data.parameters,
                result: {
                    content: responseContent,
                    ...result,
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
                        handlerType: 'team',
                        toolName: toolName,
                        parentExecutionId: data.parentExecutionId
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
        this.agentNumberCounter = 0;
        this.agentCopyCounters.clear();
        this.agentNodeIdMap.clear();
        this.taskNodeIdMap.clear();
        this.logger.debug('🧹 [TEAM-HANDLER] Handler state cleared');
    }
}