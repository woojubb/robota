/* eslint-disable no-console */
import { Robota, RobotaConfig, ExecutionAnalyticsPlugin, FunctionTool } from '@robota-sdk/agents';
import { AgentFactory as CoreAgentFactory } from '@robota-sdk/agents';
import { v4 as uuidv4 } from 'uuid';
import type { ToolSchema, ToolResult, ToolExecutionContext } from '@robota-sdk/agents';
import {
    TeamContainerOptions,
    AssignTaskParams,
    AssignTaskResult,
    TeamStats
} from './types.js';

/**
 * TeamContainer - Multi-Agent Team Collaboration System
 * 
 * @description
 * The TeamContainer class implements an intelligent multi-agent collaboration system 
 * where a primary team coordinator can dynamically delegate specialized tasks to 
 * temporary expert agents. This enables solving complex, multi-faceted problems 
 * through coordinated teamwork.
 * 
 * @features
 * - **Intelligent Task Delegation**: Automatically breaks down complex requests into specialized components
 * - **Dynamic Agent Creation**: Creates temporary expert agents tailored for specific tasks
 * - **Collaborative Workflows**: Coordinates multiple agents to solve multi-faceted problems
 * - **Result Integration**: Synthesizes outputs from multiple agents into cohesive responses
 * - **Resource Management**: Automatic cleanup and resource management for temporary agents
 * - **Performance Monitoring**: Comprehensive statistics and performance tracking via ExecutionAnalyticsPlugin
 * 
 * @example Basic Usage
 * ```typescript
 * import { createTeam } from '@robota-sdk/team';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const team = createTeam({
 *   provider: new OpenAIProvider({
 *     apiKey: process.env.OPENAI_API_KEY,
 *     model: 'gpt-4'
 *   }),
 *   maxTokenLimit: 50000,
 *   logger: console
 * });
 * 
 * const response = await team.execute(`
 *   Create a comprehensive business plan including:
 *   1) Market analysis
 *   2) Financial projections  
 *   3) Marketing strategy
 * `);
 * ```
 * 
 * @example Advanced Configuration
 * ```typescript
 * const team = new TeamContainer({
 *   baseRobotaOptions: {
 *     aiProviders: { openai: openaiProvider },
 *     currentProvider: 'openai',
 *     currentModel: 'gpt-4',
 *     maxTokenLimit: 50000
 *   },
 *   maxMembers: 10,
 *   debug: true
 * });
 * 
 * // The team intelligently delegates work
 * const result = await team.execute(
 *   'Design a complete mobile app including UI/UX design, backend architecture, and deployment strategy'
 * );
 * 
 * // View team performance statistics from ExecutionAnalyticsPlugin
 * const stats = team.getStats();
 * const analyticsStats = team.getAnalyticsStats();
 * console.log(`Created ${stats.totalAgentsCreated} specialized agents`);
 * console.log(`Success rate: ${(analyticsStats.successRate * 100).toFixed(1)}%`);
 * console.log(`Average execution time: ${analyticsStats.averageDuration.toFixed(0)}ms`);
 * ```
 * 
 * @see {@link createTeam} - Convenience function for creating teams
 * @see {@link AssignTaskParams} - Parameters for task assignment
 * @see {@link TeamStats} - Team performance statistics
 */
export class TeamContainer {
    private teamAgent!: Robota;
    private agentFactory!: CoreAgentFactory;
    private options: TeamContainerOptions;
    private stats: TeamStats;
    private logger?: any;

    constructor(options: TeamContainerOptions) {
        this.options = options;
        this.stats = {
            totalAgentsCreated: 0,
            totalExecutionTime: 0,
            totalTokensUsed: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            templateUsage: {},
            templateVsDynamicAgents: {
                template: 0,
                dynamic: 0
            }
        };
        this.logger = options.logger;

        // Create AgentFactory for creating temporary agents with proper configuration
        this.agentFactory = new CoreAgentFactory({
            defaultProvider: this.options.baseRobotaOptions.currentProvider || 'openai',
            defaultModel: this.options.baseRobotaOptions.currentModel || 'gpt-4o-mini',
            maxConcurrentAgents: this.options.maxMembers || 5,
            strictValidation: false // Allow flexible configuration for dynamic agents
        });

        // Register built-in templates
        this.registerBuiltinTemplates();

        // Create shared analytics plugin for team agent
        const teamAnalyticsPlugin = new ExecutionAnalyticsPlugin({
            maxEntries: 1000,
            trackErrors: true,
            performanceThreshold: 5000, // 5 seconds
            enableWarnings: true
        });

        // Create AssignTaskTool using FunctionTool
        const assignTaskSchema: ToolSchema = {
            name: 'assignTask',
            description: 'Assign a specialized task to a temporary expert agent. Use this when the task requires specific expertise, complex analysis, or when breaking down work into specialized components would be beneficial. The expert agent will be created, complete the task, and be automatically cleaned up.',
            parameters: {
                type: 'object',
                properties: {
                    jobDescription: {
                        type: 'string',
                        description: 'Clear, specific description of the job to be completed. Should provide enough detail for the specialist agent to understand the scope and deliverables expected.'
                    },
                    context: {
                        type: 'string',
                        description: 'Additional context, constraints, or requirements for the job. Helps the specialist agent understand the broader context and any specific limitations or guidelines to follow.'
                    },
                    requiredTools: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of tools the specialist agent might need for this task. If specified, the system will attempt to configure the agent with access to these tools.'
                    },
                    priority: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'urgent'],
                        description: 'Priority level for the task, affecting resource allocation and urgency. Higher priority tasks may receive more resources or faster processing.'
                    },
                    agentTemplate: {
                        type: 'string',
                        description: 'Name of the agent template to use for this task. Templates provide predefined configurations optimized for specific types of work. Available templates: summarizer, ethical_reviewer, creative_ideator, fast_executor, domain_researcher, and any custom templates. If not specified, a dynamic agent will be created based on the job description.'
                    }
                },
                required: ['jobDescription']
            }
        };

        const assignTaskTool = new FunctionTool(
            assignTaskSchema,
            async (parameters: Record<string, any>) => {
                const assignTaskParams: AssignTaskParams = {
                    jobDescription: parameters.jobDescription,
                    context: parameters.context,
                    requiredTools: parameters.requiredTools || [],
                    priority: parameters.priority || 'medium',
                    agentTemplate: parameters.agentTemplate
                };

                const result = await this.assignTask(assignTaskParams);

                return {
                    result: result.result,
                    agentId: result.agentId,
                    executionTime: result.metadata.executionTime,
                    tokensUsed: result.metadata.tokensUsed
                };
            }
        );

        // Create team agent with analytics plugin and assignTask tool
        const teamConfig: RobotaConfig = {
            ...this.options.baseRobotaOptions,
            systemMessage: this.generateTeamSystemMessage(),
            plugins: [
                ...(this.options.baseRobotaOptions.plugins || []),
                teamAnalyticsPlugin
            ],
            tools: [assignTaskTool]
        };
        this.teamAgent = new Robota(teamConfig);
    }

    /**
     * Generate system message for the Team agent
     */
    private generateTeamSystemMessage(): string {
        return `You are a Team Coordinator that manages collaborative work through intelligent task delegation.

CORE PRINCIPLES:
- Respond in the same language as the user's input
- For complex, multi-faceted tasks, delegate to specialized team members using assignTask
- For simple, single-component tasks, handle directly
- Each delegated task must be self-contained and understandable without context
- Synthesize results from multiple specialists into your final response

DELEGATION GUIDELINES:
1. **When to delegate**: Use assignTask for tasks requiring specific expertise, complex analysis, research, creative work, or when breaking down multi-component requests
2. **Task clarity**: Create complete, standalone instructions for each specialist
3. **No overlap**: Avoid overlapping tasks between different specialists  
4. **Template selection**: Use appropriate agent templates when specified (domain_researcher for analysis, creative_ideator for brainstorming, etc.)
5. **Synthesis**: Handle final synthesis and comparison yourself

AVAILABLE TOOL:
- assignTask: Delegate specialized work to temporary expert agents

Your goal is to provide comprehensive, high-quality responses by intelligently coordinating specialist expertise when beneficial.`;
    }

    /**
     * Execute a task using the team approach
     * @param userPrompt - The task to execute
     * @returns Promise<string> - The result of the task execution
     */
    async execute(userPrompt: string): Promise<string> {
        try {
            this.logger?.info(`🚀 Starting team execution`);

            // Execute using team agent - analytics plugin will automatically track
            const result = await this.teamAgent.run(userPrompt);

            // Update legacy stats for compatibility
            this.stats.tasksCompleted++;

            this.logger?.info(`✅ Team execution completed`);
            return result;

        } catch (error) {
            // Update legacy stats for compatibility
            this.stats.tasksFailed++;

            this.logger?.error(`❌ Team execution failed`, error);
            throw error;
        }
    }

    /**
     * Assign specialized tasks to a temporary expert agent
     * 
     * @description
     * This method creates a temporary specialized agent to handle a specific task.
     * The agent is configured with appropriate tools and context for the task,
     * executes the work, and is automatically cleaned up after completion.
     * 
     * @param params - Task assignment parameters
     * @param params.jobDescription - Clear description of the specific job to assign
     * @param params.context - Additional context or constraints for the job
     * @param params.requiredTools - List of tools the member might need
     * @param params.priority - Priority level for the task ('low' | 'medium' | 'high' | 'urgent')
     * 
     * @returns Promise resolving to the task result with metadata
     * 
     * @throws {Error} When maximum number of team members is reached
     * @throws {Error} When task execution fails
     * 
     * @example
     * ```typescript
     * const result = await team.assignTask({
     *   jobDescription: 'Analyze market trends for electric vehicles',
     *   context: 'Focus on the North American market for the next 5 years',
     *   requiredTools: ['market-data-api', 'trend-analysis'],
     *   priority: 'high'
     * });
     * 
     * console.log(result.result); // Market analysis report
     * console.log(result.metadata.executionTime); // Time taken in ms
     * console.log(result.agentId); // ID of the temporary agent used
     * ```
     */
    async assignTask(params: AssignTaskParams): Promise<AssignTaskResult> {
        let temporaryAgent: any = null;
        const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();

        try {
            this.logger?.info(`🔄 Assigning task: ${params.jobDescription}`);

            // Create shared analytics plugin instance for this temporary agent
            const taskAnalyticsPlugin = new ExecutionAnalyticsPlugin({
                maxEntries: 100,
                trackErrors: true,
                performanceThreshold: 10000, // 10 seconds for specialized tasks
                enableWarnings: true
            });

            // Create a temporary agent for this specific task
            if (params.agentTemplate) {
                // Create from template
                temporaryAgent = await this.agentFactory.createFromTemplate(
                    Robota,
                    params.agentTemplate,
                    {
                        ...this.options.baseRobotaOptions,
                        plugins: [taskAnalyticsPlugin] // Add analytics to temporary agent
                    }
                );

                // Update template usage stats
                this.stats.templateUsage[params.agentTemplate] = (this.stats.templateUsage[params.agentTemplate] || 0) + 1;
                this.stats.templateVsDynamicAgents.template++;
            } else {
                // Create dynamic agent
                temporaryAgent = await this.agentFactory.createAgent(
                    Robota,
                    {
                        ...this.options.baseRobotaOptions,
                        systemMessage: `You are a specialist agent created to handle this specific task: ${params.jobDescription}. ${params.context || ''}`,
                        plugins: [taskAnalyticsPlugin] // Add analytics to temporary agent
                    }
                );

                this.stats.templateVsDynamicAgents.dynamic++;
            }

            // Execute the task with the temporary agent - plugin will automatically track
            const taskPrompt = this.buildTaskPrompt(params);
            const result = await temporaryAgent.run(taskPrompt);

            // Update legacy stats for compatibility
            this.stats.totalAgentsCreated++;
            this.stats.tasksCompleted++;

            // Get execution stats from the temporary agent's analytics plugin
            const agentAnalyticsPlugin = temporaryAgent.getPlugin('ExecutionAnalyticsPlugin') as ExecutionAnalyticsPlugin | null;
            const executionStats = agentAnalyticsPlugin?.getAggregatedStats();
            const taskDuration = Date.now() - startTime;

            this.logger?.info(`✅ Task completed by agent ${agentId} (${taskDuration}ms)`);

            return {
                result,
                agentId: agentId,
                metadata: {
                    executionTime: taskDuration,
                    tokensUsed: this.estimateTokenUsage(taskPrompt, result),
                    agentExecutions: executionStats?.totalExecutions || 0,
                    agentAverageDuration: executionStats?.averageDuration || 0,
                    agentSuccessRate: executionStats?.successRate || 0,
                    errors: []
                }
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const taskDuration = Date.now() - startTime;

            // Update legacy stats for compatibility
            this.stats.totalAgentsCreated++;
            this.stats.tasksFailed++;

            this.logger?.error(`❌ Task failed for agent ${agentId} (${taskDuration}ms):`, error);

            return {
                result: `Task failed: ${errorMessage}`,
                agentId: agentId,
                metadata: {
                    executionTime: taskDuration,
                    errors: [errorMessage]
                }
            };
        } finally {
            // Always cleanup the temporary agent
            if (temporaryAgent) {
                // Robota instances don't need explicit cleanup in current implementation
                // Future versions may support cleanup methods
            }
        }
    }

    /**
     * Get comprehensive team execution statistics (legacy interface)
     */
    getStats(): TeamStats {
        // Update legacy stats with data from main team agent's analytics plugin
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getStats' in analyticsPlugin && typeof analyticsPlugin.getStats === 'function') {
            const analyticsStats = analyticsPlugin.getStats();
            this.stats.totalExecutionTime = analyticsStats.totalDuration || 0;
        }

        return { ...this.stats };
    }

    /**
     * Get detailed analytics statistics from main team agent's ExecutionAnalyticsPlugin
     */
    getAnalyticsStats() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getStats' in analyticsPlugin && typeof analyticsPlugin.getStats === 'function') {
            return analyticsPlugin.getStats();
        }
        return undefined;
    }

    /**
     * Get execution statistics by operation type from main team agent
     */
    getExecutionStatsByOperation(operation?: string) {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getExecutionStats' in analyticsPlugin && typeof (analyticsPlugin as any).getExecutionStats === 'function') {
            return (analyticsPlugin as any).getExecutionStats(operation);
        }
        return [];
    }

    /**
     * Get plugin status and memory usage from main team agent
     */
    getPluginStatus() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getStatus' in analyticsPlugin && typeof analyticsPlugin.getStatus === 'function') {
            return analyticsPlugin.getStatus();
        }
        return undefined;
    }

    /**
     * Clear analytics statistics from main team agent
     */
    clearAnalyticsStats(): void {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'clearData' in analyticsPlugin && typeof analyticsPlugin.clearData === 'function') {
            analyticsPlugin.clearData();
        }
    }

    /**
     * Get analytics data (raw execution history) from main team agent
     */
    getAnalyticsData() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getData' in analyticsPlugin && typeof analyticsPlugin.getData === 'function') {
            return analyticsPlugin.getData();
        }
        return undefined;
    }

    /**
     * Get all plugin statuses from team agent
     */
    getAllPluginStatuses() {
        // Get all plugins and their statuses through common interface
        const plugins = this.teamAgent.getPlugins();
        return plugins.map(plugin => {
            if ('getStatus' in plugin && typeof plugin.getStatus === 'function') {
                return plugin.getStatus();
            }
            // Fallback to basic status
            return {
                name: plugin.name,
                version: plugin.version,
                enabled: plugin.isEnabled(),
                initialized: true
            };
        });
    }

    /**
     * Reset team statistics
     */
    resetStats(): void {
        this.stats = {
            totalAgentsCreated: 0,
            totalExecutionTime: 0,
            totalTokensUsed: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            templateUsage: {},
            templateVsDynamicAgents: {
                template: 0,
                dynamic: 0
            }
        };

        // Also clear analytics plugin stats
        this.clearAnalyticsStats();
    }

    /**
     * Get the agent factory instance for advanced operations
     */
    getTemplateManager() {
        return this.agentFactory;
    }

    /**
     * Build task prompt for delegation
     */
    private buildTaskPrompt(params: AssignTaskParams): string {
        let prompt = `Task: ${params.jobDescription}\n\n`;

        if (params.context) {
            prompt += `Context: ${params.context}\n\n`;
        }

        if (params.requiredTools && params.requiredTools.length > 0) {
            prompt += `Available tools: ${params.requiredTools.join(', ')}\n\n`;
        }

        prompt += `Priority: ${params.priority || 'medium'}\n\nPlease complete this task thoroughly and provide a comprehensive response.`;

        return prompt;
    }

    /**
     * Estimate token usage for a prompt and response
     */
    private estimateTokenUsage(prompt: string, response: string): number {
        // Rough estimation: 4 characters per token
        return Math.ceil((prompt.length + response.length) / 4);
    }

    /**
     * Register built-in agent templates
     */
    private registerBuiltinTemplates(): void {
        const builtinTemplates = [
            {
                id: 'summarizer',
                name: 'Content Summarizer',
                description: 'Specialized agent for summarizing and condensing content',
                category: 'analysis',
                tags: ['summary', 'analysis', 'content'],
                config: {
                    ...this.options.baseRobotaOptions,
                    systemMessage: 'You are a specialized summarization agent. Your expertise is in distilling complex information into clear, concise summaries while preserving key insights and important details.',
                    temperature: 0.3
                }
            },
            {
                id: 'domain_researcher',
                name: 'Domain Researcher',
                description: 'Expert researcher for specific domains and topics',
                category: 'research',
                tags: ['research', 'analysis', 'domain-expert'],
                config: {
                    ...this.options.baseRobotaOptions,
                    systemMessage: 'You are a specialized research agent with deep analytical capabilities. Your role is to conduct thorough research, analyze complex topics, and provide comprehensive insights with evidence-based conclusions.',
                    temperature: 0.4
                }
            },
            {
                id: 'creative_ideator',
                name: 'Creative Ideator',
                description: 'Creative agent for brainstorming and innovative thinking',
                category: 'creative',
                tags: ['creative', 'brainstorming', 'innovation'],
                config: {
                    ...this.options.baseRobotaOptions,
                    systemMessage: 'You are a creative ideation specialist. Your strength lies in generating innovative ideas, thinking outside the box, and approaching problems from unique angles to provide creative solutions.',
                    temperature: 0.8
                }
            },
            {
                id: 'ethical_reviewer',
                name: 'Ethical Reviewer',
                description: 'Ethical analysis and review specialist',
                category: 'analysis',
                tags: ['ethics', 'review', 'analysis'],
                config: {
                    ...this.options.baseRobotaOptions,
                    systemMessage: 'You are an ethical review specialist. Your expertise is in analyzing proposals, decisions, and content from ethical perspectives, identifying potential concerns, and suggesting improvements.',
                    temperature: 0.2
                }
            },
            {
                id: 'fast_executor',
                name: 'Fast Executor',
                description: 'Quick task execution specialist',
                category: 'execution',
                tags: ['fast', 'execution', 'efficiency'],
                config: {
                    ...this.options.baseRobotaOptions,
                    systemMessage: 'You are a fast execution specialist. Your strength is in quickly completing straightforward tasks with accuracy and efficiency.',
                    temperature: 0.1,
                    maxTokens: 1000
                }
            }
        ];

        for (const template of builtinTemplates) {
            this.agentFactory.registerTemplate(template);
        }

        this.logger?.info(`Registered ${builtinTemplates.length} built-in agent templates`);
    }
}

