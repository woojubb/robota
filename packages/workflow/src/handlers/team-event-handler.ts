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

/**
 * TeamEventHandler - Handles team collaboration events
 */
export class TeamEventHandler implements EventHandler {
    readonly name = 'TeamEventHandler';
    readonly priority = Priority.HIGH;
    readonly patterns = ['team.*'];

    private logger: SimpleLogger;

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
                    const analysisNode = this.createAnalysisStartNode(eventData);
                    updates.push({ action: 'create', node: analysisNode });
                    break;

                case 'team.analysis_complete':
                    const analysisCompleteNode = this.createAnalysisCompleteNode(eventData);
                    updates.push({ action: 'create', node: analysisCompleteNode });
                    break;

                case 'team.task_assigned':
                    const taskNode = this.createTaskAssignedNode(eventData);
                    updates.push({ action: 'create', node: taskNode });
                    this.taskNodeIdMap.set(String(eventData.sourceId), taskNode.id);
                    break;

                case 'team.task_completed':
                    const taskCompleteNode = this.createTaskCompletedNode(eventData);
                    updates.push({ action: 'create', node: taskCompleteNode });
                    break;

                case 'team.agent_creation_start':
                    const agentCreationStartNode = this.createAgentCreationStartNode(eventData);
                    updates.push({ action: 'create', node: agentCreationStartNode });
                    break;

                case 'team.agent_creation_complete':
                    const agentCreationCompleteNode = this.createAgentCreationCompleteNode(eventData);
                    updates.push({ action: 'create', node: agentCreationCompleteNode });
                    break;

                case 'team.agent_execution_start':
                case 'team.agent_execution_started':
                    const agentExecStartNode = this.createAgentExecutionStartNode(eventData);
                    updates.push({ action: 'create', node: agentExecStartNode });
                    break;

                case 'team.agent_execution_complete':
                    const agentExecCompleteNode = this.createAgentExecutionCompleteNode(eventData);
                    updates.push({ action: 'create', node: agentExecCompleteNode });
                    break;

                case 'team.tool_response_ready':
                    // ✅ Team 도메인에서 발생하는 tool response ready 처리 (올바른 소유권)
                    const toolCallResponseNode = this.createToolCallResponseNode(eventData);
                    updates.push({ action: 'create', node: toolCallResponseNode });
                    break;

                case 'team.aggregation_complete':
                    const aggregationNode = this.createAggregationCompleteNode(eventData);
                    updates.push({ action: 'create', node: aggregationNode });
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
        const nodeId = `tool_response_call_${executionId}`;

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