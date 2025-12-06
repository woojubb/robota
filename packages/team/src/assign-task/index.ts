import {
    Robota,
    AgentConfig,
    ExecutionAnalyticsPlugin,
    BasePlugin,
    BaseTool,
    SimpleLogger,
    EventService,
    DEFAULT_ABSTRACT_EVENT_SERVICE,
    ToolExecutionContext,
    createFunctionTool
} from '@robota-sdk/agents';
import { v4 as uuidv4 } from 'uuid';
import { createTaskAssignmentFacade } from '../task-assignment/index.js';
import { SubAgentEventRelay } from '../services/sub-agent-event-relay.js';
import {
    AssignTaskParams,
    AssignTaskResult,
    TemplateInfo,
    AgentTemplate
} from '../types.js';

/**
 * Configuration for assignTask functionality
 */
export interface AssignTaskConfig {
    availableTemplates: AgentTemplate[];
    baseRobotaOptions: {
        aiProviders: any;
        tools?: any[];
        defaultModel: {
            model: string;
            provider: string;
        };
    };
    maxMembers?: number;
    logger?: SimpleLogger;
    eventService?: EventService;
}

/**
 * Create assignTask tool that can be used in both Team and Playground environments
 * 
 * @param config - Configuration for assignTask. If not provided, returns a dummy implementation
 * @returns BaseTool that can create and execute sub-agents
 */
export function createAssignTaskTool(config?: AssignTaskConfig): BaseTool<any, any> {
    // If no config provided, return dummy implementation for playground
    if (!config) {
        const parameters = {
            type: 'object',
            properties: {
                jobDescription: {
                    type: 'string',
                    description: 'Clear, specific description of the job to be completed'
                },
                agentTemplate: {
                    type: 'string',
                    description: 'Agent template to use (general, summarizer, creative_ideator, etc.)',
                    enum: ['general', 'summarizer', 'ethical_reviewer', 'creative_ideator', 'fast_executor', 'domain_researcher', 'task_coordinator']
                },
                priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'urgent'],
                    description: 'Priority level for the task'
                },
                context: {
                    type: 'string',
                    description: 'Additional context, constraints, or requirements for the job'
                },
                allowFurtherDelegation: {
                    type: 'boolean',
                    description: 'Whether the assigned agent can delegate parts of the task to other specialists'
                }
            },
            required: ['jobDescription']
        } as const;

        const executor = async (params: AssignTaskParams) => {
            // Dummy implementation - just return a mock response
            return `Task "${params.jobDescription}" has been assigned to a ${params.agentTemplate || 'general'} agent with ${params.priority || 'medium'} priority. The agent will complete this task and return the results.`;
        };

        return createFunctionTool(
            'assignTask',
            'Assign a specialized task to a temporary expert agent',
            parameters as any,
            executor as any
        );
    }

    // Real implementation using task assignment facade
    const templateInfo: TemplateInfo[] = config.availableTemplates.map(template => ({
        id: template.id,
        description: template.description
    }));

    const taskAssignment = createTaskAssignmentFacade(
        templateInfo,
        async (params: AssignTaskParams, context?: ToolExecutionContext): Promise<AssignTaskResult> => {
            if (!context) {
                config.logger?.error("Critical Error: assignTask called without ToolExecutionContext");
                return {
                    result: "Task assignment failed: Critical error - execution context was not provided.",
                    agentId: `error-${Date.now()}`,
                    metadata: {
                        executionTime: 0,
                        errors: ["ToolExecutionContext is required for assignTask"]
                    }
                };
            }

            // Execute the actual task assignment
            return await executeAssignTask(params, context, config);
        }
    );

    return taskAssignment.tool;
}

/**
 * Execute task assignment - core implementation
 */
async function executeAssignTask(
    params: AssignTaskParams,
    context: ToolExecutionContext,
    config: AssignTaskConfig
): Promise<AssignTaskResult> {
    const parentToolCallId = context?.executionId;
    let temporaryAgent: Robota | null = null;
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Dynamic level calculation from context
    const toolLevel = context?.executionLevel || 2;
    const agentLevel = toolLevel + 1;

    try {
        // Create analytics plugin for temporary agent
        const taskAnalyticsPlugin = new ExecutionAnalyticsPlugin({
            maxEntries: 100,
            trackErrors: true,
            performanceThreshold: 10000,
            enableWarnings: true
        });

        // Determine delegation capabilities
        const shouldAllowDelegation = params.allowFurtherDelegation === true;
        const delegationTools = shouldAllowDelegation ? [createAssignTaskTool(config)] : [];

        // Create conversation ID
        const conversationId = `conv_${agentId.split('-').slice(1).join('_')}`;

        // Create execution context for child agent
        const childExecutionContext: ToolExecutionContext = {
            executionId: agentId,
            parentExecutionId: parentToolCallId || context.executionId || 'unknown',
            rootExecutionId: context.rootExecutionId || context.executionId || 'unknown',
            executionLevel: agentLevel,
            executionPath: [...(context.executionPath || []), parentToolCallId || context.executionId || 'unknown'],
            toolName: 'assignTask',
            parameters: params as any
        };

        // Create scoped event service
        const scopedEventService = config.eventService && 'createContextBoundInstance' in config.eventService &&
            typeof config.eventService.createContextBoundInstance === 'function'
            ? config.eventService.createContextBoundInstance(childExecutionContext)
            : new SubAgentEventRelay(config.eventService || DEFAULT_ABSTRACT_EVENT_SERVICE, parentToolCallId || context.executionId || 'unknown');

        if (params.agentTemplate) {
            // Create from template
            const template = config.availableTemplates.find(t => t.id === params.agentTemplate);
            if (!template) {
                throw new Error(`Template '${params.agentTemplate}' not found. Available templates: ${config.availableTemplates.map(t => t.id).join(', ')}`);
            }

            // Build system message with delegation guidance
            let systemMessage = template.config.systemMessage;
            if (shouldAllowDelegation) {
                systemMessage += '\n\nDELEGATION GUIDANCE: You can use assignTask to delegate parts of this work to other specialists if the task would benefit from specialized expertise outside your primary domain.';
            } else {
                systemMessage += '\n\nDIRECT EXECUTION: Handle this task directly using your specialized knowledge and skills. Do not delegate - focus on completing the work within your expertise.';
            }

            const tempAgentConfig: AgentConfig = {
                name: `temp-agent-${agentId}`,
                aiProviders: config.baseRobotaOptions.aiProviders,
                defaultModel: {
                    provider: template.config.provider,
                    model: template.config.model,
                    temperature: template.config.temperature,
                    systemMessage: systemMessage,
                    ...(template.config.maxTokens && { maxTokens: template.config.maxTokens })
                },
                plugins: [taskAnalyticsPlugin as BasePlugin],
                tools: [...delegationTools, ...(config.baseRobotaOptions.tools || [])],
                conversationId: conversationId,
                eventService: scopedEventService,
                executionContext: childExecutionContext
            };

            config.logger?.info(`🎯 [assignTask] Creating temporaryAgent from template: ${params.agentTemplate}`);
            temporaryAgent = new Robota(tempAgentConfig);

        } else {
            // Create dynamic agent
            let systemMessage = `You are a specialist agent created to handle this specific task: ${params.jobDescription}. ${params.context || ''}`;
            if (shouldAllowDelegation) {
                systemMessage += '\n\nDELEGATION GUIDANCE: You can use assignTask to delegate parts of this work to other specialists if the task would benefit from specialized expertise outside your capabilities.';
            } else {
                systemMessage += '\n\nDIRECT EXECUTION: Handle this task directly using your knowledge and skills. Do not delegate - focus on completing the work yourself.';
            }

            const dynamicAgentConfig: AgentConfig = {
                name: `temp-agent-${agentId}`,
                aiProviders: config.baseRobotaOptions.aiProviders,
                defaultModel: {
                    provider: config.baseRobotaOptions.aiProviders[0]?.name || 'openai',
                    model: 'gpt-3.5-turbo',
                    systemMessage: systemMessage
                },
                plugins: [taskAnalyticsPlugin as BasePlugin],
                tools: [...delegationTools, ...(config.baseRobotaOptions.tools || [])],
                conversationId: conversationId,
                eventService: scopedEventService,
                executionContext: childExecutionContext
            };

            config.logger?.info(`🎯 [assignTask] Creating dynamic temporaryAgent`);
            temporaryAgent = new Robota(dynamicAgentConfig);
        }

        // Execute the task
        const taskPrompt = buildTaskPrompt(params);
        config.logger?.info(`🎯 [assignTask] About to execute temporaryAgent.run() for agent: ${agentId}`);

        let result: string;
        try {
            result = await temporaryAgent.run(taskPrompt);
            config.logger?.info(`🎯 [assignTask] temporaryAgent.run() completed for agent: ${agentId}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            config.logger?.warn(`🚨 [assignTask] temporaryAgent.run() failed for agent: ${agentId} - Error: ${errorMessage}`);
            throw error;
        }

        // Get execution stats
        const agentAnalyticsPlugin = temporaryAgent.getPlugin('ExecutionAnalyticsPlugin') as ExecutionAnalyticsPlugin | null;
        const executionStats = agentAnalyticsPlugin?.getAggregatedStats();
        const taskDuration = Date.now() - startTime;

        config.logger?.info(`✅ Task completed by agent ${agentId} (${taskDuration}ms)`);

        return {
            result: result || 'Agent execution completed',
            agentId: agentId,
            metadata: {
                executionTime: taskDuration,
                tokensUsed: estimateTokenUsage(taskPrompt, result || ''),
                agentExecutions: executionStats && 'totalExecutions' in executionStats ? Number(executionStats.totalExecutions) : 0,
                agentAverageDuration: executionStats && 'averageDuration' in executionStats ? Number(executionStats.averageDuration) : 0,
                agentSuccessRate: executionStats && 'successRate' in executionStats ? Number(executionStats.successRate) : 0,
                errors: []
            }
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const taskDuration = Date.now() - startTime;

        config.logger?.error(`❌ Task failed for agent ${agentId} (${taskDuration}ms): ${errorMessage}`);

        return {
            result: `Task failed: ${errorMessage}`,
            agentId: agentId,
            metadata: {
                executionTime: taskDuration,
                errors: [errorMessage]
            }
        };
    } finally {
        // Cleanup
        temporaryAgent = null;
    }
}

/**
 * Build task prompt from parameters
 */
function buildTaskPrompt(params: AssignTaskParams): string {
    let prompt = `Task: ${params.jobDescription}`;

    if (params.context) {
        prompt += `\n\nContext: ${params.context}`;
    }

    if (params.requiredTools && params.requiredTools.length > 0) {
        prompt += `\n\nRequired Tools: ${params.requiredTools.join(', ')}`;
    }

    if (params.priority && params.priority !== 'medium') {
        prompt += `\n\nPriority: ${params.priority}`;
    }

    return prompt;
}

/**
 * Estimate token usage
 */
function estimateTokenUsage(prompt: string, response: string): number {
    return Math.ceil((prompt.length + response.length) / 4);
}

// Re-export types for convenience
export type { AssignTaskParams, AssignTaskResult };
