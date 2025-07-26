/* eslint-disable no-console */
import { Robota, AgentConfig, ExecutionAnalyticsPlugin, BasePlugin, ToolHooks, BaseTool, SimpleLogger } from '@robota-sdk/agents';
import { v4 as uuidv4 } from 'uuid';
import { createTaskAssignmentFacade } from './task-assignment/index.js';
import { AgentDelegationTool } from './tools/agent-delegation-tool.js';

import {
    TeamContainerOptions,
    AssignTaskParams,
    AssignTaskResult,
    TemplateInfo
} from './types.js';

/**
 * Task delegation record
 */
interface TaskDelegationRecord {
    id: string;
    originalTask: string;
    delegatedTask: string;
    agentTemplate?: string;
    agentId: string;
    priority: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    result: string;
    success: boolean;
    tokensUsed?: number;
    executionStats?: {
        agentExecutions: number;
        agentAverageDuration: number;
        agentSuccessRate: number;
    };
}

/**
 * Team execution analysis
 */
interface TeamExecutionAnalysis {
    totalTasks: number;
    directlyHandledTasks: number;
    delegatedTasks: number;
    delegationRate: number;
    delegationBreakdown: {
        template: string;
        count: number;
        averageDuration: number;
        successRate: number;
    }[];
    taskComplexityAnalysis: {
        simple: number;
        complex: number;
    };
    performanceMetrics: {
        averageDirectHandlingTime: number;
        averageDelegationTime: number;
        totalExecutionTime: number;
    };
}

/**
 * Built-in agent template interface
 */
interface AgentTemplate {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    config: {
        model: string;
        provider: string;
        systemMessage: string;
        temperature: number;
        maxTokens?: number;
    };
}

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
 * const analyticsStats = team.getAnalytics();
 * console.log(`Success rate: ${(analyticsStats.successRate * 100).toFixed(1)}%`);
 * console.log(`Average execution time: ${analyticsStats.averageDuration.toFixed(0)}ms`);
 * ```
 * 
 * @see {@link createTeam} - Convenience function for creating teams
 * @see {@link AssignTaskParams} - Parameters for task assignment
 */
export class TeamContainer {
    private teamAgent!: Robota;
    private options: TeamContainerOptions;
    private logger: SimpleLogger | undefined;
    private availableTemplates: AgentTemplate[];
    private delegationHistory: TaskDelegationRecord[] = [];
    private activeAgentsCount: number = 0; // Track currently active agents
    private totalAgentsCreated: number = 0; // Track total agents created
    private tasksCompleted: number = 0; // Track completed tasks
    private totalExecutionTime: number = 0; // Track total execution time in ms
    private toolHooks: ToolHooks | undefined; // Tool hooks for assignTask instrumentation

    constructor(options: TeamContainerOptions) {
        this.options = options;
        this.logger = options.logger;
        this.toolHooks = options.toolHooks; // Direct assignment without explicit undefined

        // Initialize built-in templates
        this.availableTemplates = this.getBuiltinTemplates();

        // Create dedicated analytics plugin for team agent (instance-specific)
        const teamAnalyticsPlugin = new ExecutionAnalyticsPlugin({
            maxEntries: 1000,
            trackErrors: true,
            performanceThreshold: 5000, // 5 seconds
            enableWarnings: true
        });

        // Create AssignTaskTool with dynamic Zod schema based on available templates
        console.log(`🔧 [TEAM-CONTAINER] Creating assignTask tool with toolHooks:`, !!this.toolHooks);
        const assignTaskTool = this.createAssignTaskTool();
        console.log(`🔧 [TEAM-CONTAINER] AssignTask tool created:`, !!assignTaskTool);

        // Get leader template (default: task_coordinator)
        const leaderTemplateName = this.options.leaderTemplate || 'task_coordinator';
        const leaderTemplate = this.getTemplate(leaderTemplateName);

        if (!leaderTemplate) {
            throw new Error(`Leader template '${leaderTemplateName}' not found. Available templates: ${this.availableTemplates.map(t => t.id).join(', ')}`);
        }

        // Validate template provider is available
        const availableProviders = this.options.baseRobotaOptions.aiProviders.map(p => p.name);
        if (!availableProviders.includes(leaderTemplate.config.provider)) {
            throw new Error(`Leader template requires provider '${leaderTemplate.config.provider}' but it's not available. Available providers: ${availableProviders.join(', ')}`);
        }

        // Create team agent using leader template configuration with new API
        const teamConfig: AgentConfig = {
            name: 'team-leader',
            aiProviders: this.options.baseRobotaOptions.aiProviders,
            defaultModel: {
                provider: leaderTemplate.config.provider,
                model: leaderTemplate.config.model,
                temperature: leaderTemplate.config.temperature,
                systemMessage: leaderTemplate.config.systemMessage,
                ...(leaderTemplate.config.maxTokens && { maxTokens: leaderTemplate.config.maxTokens })
            },
            plugins: [
                ...(this.options.baseRobotaOptions.plugins || []),
                teamAnalyticsPlugin as BasePlugin
            ],
            tools: [
                ...(this.options.baseRobotaOptions.tools || []),
                assignTaskTool
            ]
        };

        console.log(`🔧 [TEAM-CONTAINER] Creating teamAgent with ${teamConfig.tools?.length || 0} tools`);
        console.log(`🔧 [TEAM-CONTAINER] Tools list:`, teamConfig.tools?.map(t => t.getName?.() || 'unnamed'));

        this.teamAgent = new Robota(teamConfig);

        console.log(`🔧 [TEAM-CONTAINER] TeamAgent created successfully`);
        this.logger?.info(`Team created with leader template: ${leaderTemplateName} (${leaderTemplate.config.provider}/${leaderTemplate.config.model})`);
    }

    /**
     * Execute a task using the team approach
     * @param userPrompt - The task to execute
     * @returns Promise<string> - The result of the task execution
     */
    async execute(userPrompt: string): Promise<string> {
        const startTime = Date.now();

        try {
            console.log(`🚀 [TEAM-CONTAINER] Starting team execution with prompt:`, userPrompt);
            console.log(`🚀 [TEAM-CONTAINER] teamAgent object:`, !!this.teamAgent);
            console.log(`🚀 [TEAM-CONTAINER] teamAgent type:`, this.teamAgent?.constructor?.name);

            this.logger?.info(`🚀 Starting team execution`);

            console.log(`🔥 [TEAM-CONTAINER] About to call teamAgent.run()`);
            const result = await this.teamAgent.run(userPrompt);
            console.log(`🔥 [TEAM-CONTAINER] teamAgent.run() completed`);

            const executionTime = Date.now() - startTime;
            this.tasksCompleted++;
            this.totalExecutionTime += executionTime;

            this.logger?.info(`✅ Team execution completed in ${executionTime}ms`);
            return result;

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.totalExecutionTime += executionTime;

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger?.error(`❌ Team execution failed after ${executionTime}ms: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute a task using the team approach with streaming response
     * @param userPrompt - The task to execute
     * @returns AsyncGenerator<string, void, undefined> - Streaming chunks of the task execution result
     */
    async* executeStream(userPrompt: string): AsyncGenerator<string, void, undefined> {
        console.log(`🚨🚨🚨 [TEAM-CONTAINER-STREAM] EXECUTESTREAM CALLED!!! 🚨🚨🚨`);
        console.log(`🚨 [TEAM-CONTAINER-STREAM] This log should ALWAYS appear if this method is called!`);

        const startTime = Date.now();

        try {
            console.log(`🚀 [TEAM-CONTAINER-STREAM] Starting team streaming execution with prompt:`, userPrompt);
            console.log(`🚀 [TEAM-CONTAINER-STREAM] teamAgent object:`, !!this.teamAgent);
            console.log(`🚀 [TEAM-CONTAINER-STREAM] teamAgent type:`, this.teamAgent?.constructor?.name);

            this.logger?.info(`🚀 Starting team streaming execution`);

            console.log(`🔥 [TEAM-CONTAINER-STREAM] About to call teamAgent.runStream()`);
            // Delegate to teamAgent's runStream method (Facade Pattern)
            yield* this.teamAgent.runStream(userPrompt);
            console.log(`🔥 [TEAM-CONTAINER-STREAM] teamAgent.runStream() completed`);

            const executionTime = Date.now() - startTime;
            this.tasksCompleted++;
            this.totalExecutionTime += executionTime;

            this.logger?.info(`✅ Team streaming execution completed in ${executionTime}ms`);

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.totalExecutionTime += executionTime;

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger?.error(`❌ Team streaming execution failed after ${executionTime}ms: ${errorMessage}`);
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
     */
    private async assignTask(params: AssignTaskParams): Promise<AssignTaskResult> {
        let temporaryAgent: Robota | null = null;
        let counterIncremented = false; // Track if we incremented the counter
        const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();

        // Log received parameters
        console.log('assignTask params:', JSON.stringify(params, null, 2));

        try {



            // Atomic check and increment for maxMembers (prevents race condition)
            // Check against totalAgentsCreated to prevent too many agents overall
            if (this.options.maxMembers && this.totalAgentsCreated >= this.options.maxMembers) {
                const errorMessage = `Maximum number of team members (${this.options.maxMembers}) reached. Total created: ${this.totalAgentsCreated}, Currently active: ${this.activeAgentsCount}`;

                this.logger?.warn(errorMessage);

                return {
                    result: `Task assignment failed: ${errorMessage}`,
                    agentId: agentId,
                    metadata: {
                        executionTime: 0,
                        errors: [errorMessage]
                    }
                };
            }

            // Atomically increment counter BEFORE agent creation to prevent race conditions
            this.activeAgentsCount++;
            this.totalAgentsCreated++;
            counterIncremented = true; // Mark that we incremented the counter

            this.logger?.info(`📊 Agent slot reserved - Active: ${this.activeAgentsCount}, Total: ${this.totalAgentsCreated}, Max: ${this.options.maxMembers || 'unlimited'}`);

            // Create dedicated analytics plugin instance for this temporary agent (instance-specific)
            const taskAnalyticsPlugin = new ExecutionAnalyticsPlugin({
                maxEntries: 100,
                trackErrors: true,
                performanceThreshold: 10000, // 10 seconds for specialized tasks
                enableWarnings: true
            });

            // Create a temporary agent for this specific task
            // Determine if this agent should have delegation capabilities
            const shouldAllowDelegation = params.allowFurtherDelegation === true; // Default to false
            const delegationTools = shouldAllowDelegation ? [this.createAssignTaskTool()] : [];



            if (params.agentTemplate) {
                // Create from template
                const template = this.getTemplate(params.agentTemplate);
                if (!template) {
                    throw new Error(`Template '${params.agentTemplate}' not found. Available templates: ${this.availableTemplates.map(t => t.id).join(', ')}`);
                }

                // Validate template provider is available
                const availableProviders = this.options.baseRobotaOptions.aiProviders.map(p => p.name);
                if (!availableProviders.includes(template.config.provider)) {
                    throw new Error(`Template requires provider '${template.config.provider}' but it's not available. Available providers: ${availableProviders.join(', ')}`);
                }

                // Build system message with delegation guidance
                let systemMessage = template.config.systemMessage;
                if (shouldAllowDelegation) {
                    systemMessage += '\n\nDELEGATION GUIDANCE: You can use assignTask to delegate parts of this work to other specialists if the task would benefit from specialized expertise outside your primary domain. Focus on your expertise but delegate when it would significantly improve quality.';
                } else {
                    systemMessage += '\n\nDIRECT EXECUTION: Handle this task directly using your specialized knowledge and skills. Do not delegate - focus on completing the work within your expertise.';
                }

                temporaryAgent = new Robota({
                    name: `temp-agent-${agentId}`,
                    aiProviders: this.options.baseRobotaOptions.aiProviders,
                    defaultModel: {
                        provider: template.config.provider,
                        model: template.config.model,
                        temperature: template.config.temperature,
                        systemMessage: systemMessage,
                        ...(template.config.maxTokens && { maxTokens: template.config.maxTokens })
                    },
                    plugins: [taskAnalyticsPlugin as BasePlugin], // Add analytics to temporary agent
                    tools: [...delegationTools, ...(this.options.baseRobotaOptions.tools || [])]
                });
            } else {
                // Create dynamic agent
                let systemMessage = `You are a specialist agent created to handle this specific task: ${params.jobDescription}. ${params.context || ''}`;
                if (shouldAllowDelegation) {
                    systemMessage += '\n\nDELEGATION GUIDANCE: You can use assignTask to delegate parts of this work to other specialists if the task would benefit from specialized expertise outside your capabilities.';
                } else {
                    systemMessage += '\n\nDIRECT EXECUTION: Handle this task directly using your knowledge and skills. Do not delegate - focus on completing the work yourself.';
                }

                temporaryAgent = new Robota({
                    name: `temp-agent-${agentId}`,
                    aiProviders: this.options.baseRobotaOptions.aiProviders,
                    defaultModel: {
                        provider: this.options.baseRobotaOptions.aiProviders[0]?.name || 'openai',
                        model: 'gpt-4o-mini',
                        systemMessage: systemMessage
                    },
                    plugins: [taskAnalyticsPlugin as BasePlugin], // Add analytics to temporary agent
                    tools: [...delegationTools, ...(this.options.baseRobotaOptions.tools || [])]
                });
            }

            // Agent created successfully, execute the task
            this.logger?.info(`📊 Agent created - Active: ${this.activeAgentsCount}, Total: ${this.totalAgentsCreated}`);

            // Execute the task with the temporary agent
            const taskPrompt = this.buildTaskPrompt(params);
            const result = await temporaryAgent.run(taskPrompt);

            // Get execution stats from the temporary agent's analytics plugin
            const agentAnalyticsPlugin = temporaryAgent.getPlugin('ExecutionAnalyticsPlugin') as ExecutionAnalyticsPlugin | null;
            const executionStats = agentAnalyticsPlugin?.getAggregatedStats();
            const taskDuration = Date.now() - startTime;



            this.logger?.info(`✅ Task completed by agent ${agentId} (${taskDuration}ms)`);

            const delegationRecord: TaskDelegationRecord = {
                id: uuidv4(),
                originalTask: params.jobDescription,
                delegatedTask: taskPrompt,
                ...(params.agentTemplate && { agentTemplate: params.agentTemplate }),
                agentId: agentId,
                priority: params.priority || 'medium',
                startTime: new Date(startTime),
                endTime: new Date(Date.now()),
                duration: taskDuration,
                result: result,
                success: true,
                tokensUsed: this.estimateTokenUsage(taskPrompt, result),
                executionStats: {
                    agentExecutions: executionStats && 'totalExecutions' in executionStats ? Number(executionStats.totalExecutions) : 0,
                    agentAverageDuration: executionStats && 'averageDuration' in executionStats ? Number(executionStats.averageDuration) : 0,
                    agentSuccessRate: executionStats && 'successRate' in executionStats ? Number(executionStats.successRate) : 0
                }
            };
            this.delegationHistory.push(delegationRecord);

            return {
                result,
                agentId: agentId,
                metadata: {
                    executionTime: taskDuration,
                    tokensUsed: this.estimateTokenUsage(taskPrompt, result),
                    agentExecutions: executionStats && 'totalExecutions' in executionStats ? Number(executionStats.totalExecutions) : 0,
                    agentAverageDuration: executionStats && 'averageDuration' in executionStats ? Number(executionStats.averageDuration) : 0,
                    agentSuccessRate: executionStats && 'successRate' in executionStats ? Number(executionStats.successRate) : 0,
                    errors: []
                }
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const taskDuration = Date.now() - startTime;



            // Decrement counter if agent creation or execution failed (but only if we incremented it)
            if (counterIncremented && this.activeAgentsCount > 0) {
                this.activeAgentsCount--;
                counterIncremented = false; // Prevent double decrement

                this.logger?.info(`📊 Agent failed, slot released - Active: ${this.activeAgentsCount}`);
            }

            this.logger?.error(`❌ Task failed for agent ${agentId} (${taskDuration}ms): ${errorMessage}`);

            const delegationRecord: TaskDelegationRecord = {
                id: uuidv4(),
                originalTask: params.jobDescription,
                delegatedTask: params.jobDescription,
                ...(params.agentTemplate && { agentTemplate: params.agentTemplate }),
                agentId: agentId,
                priority: params.priority || 'medium',
                startTime: new Date(startTime),
                endTime: new Date(Date.now()),
                duration: taskDuration,
                result: `Task failed: ${errorMessage}`,
                success: false,
                tokensUsed: this.estimateTokenUsage(params.jobDescription, `Task failed: ${errorMessage}`),
                executionStats: {
                    agentExecutions: 0,
                    agentAverageDuration: 0,
                    agentSuccessRate: 0
                }
            };
            this.delegationHistory.push(delegationRecord);

            return {
                result: `Task failed: ${errorMessage}`,
                agentId: agentId,
                metadata: {
                    executionTime: taskDuration,
                    errors: [errorMessage]
                }
            };
        } finally {
            // Decrement active agent counter when agent completes successfully
            // (For failed cases, it's already decremented in catch block)
            if (counterIncremented && temporaryAgent && this.activeAgentsCount > 0) {
                this.activeAgentsCount--;

                this.logger?.info(`📊 Agent completed successfully - Active agents now: ${this.activeAgentsCount}`);
            }



            // Cleanup handled automatically by garbage collection
            temporaryAgent = null;
        }
    }

    /**
     * Get team analytics from ExecutionAnalyticsPlugin
     */
    getAnalytics() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getStats' in analyticsPlugin && typeof analyticsPlugin.getStats === 'function') {
            return analyticsPlugin.getStats();
        }
        return undefined;
    }

    /**
     * Get execution statistics by operation type
     */
    getExecutionStats(operation?: string) {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin') as ExecutionAnalyticsPlugin | null;
        if (analyticsPlugin && typeof analyticsPlugin.getExecutionStats === 'function') {
            return analyticsPlugin.getExecutionStats(operation);
        }
        return [];
    }

    /**
     * Get detailed plugin status and memory usage
     */
    getStatus() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getStatus' in analyticsPlugin && typeof analyticsPlugin.getStatus === 'function') {
            return analyticsPlugin.getStatus();
        }
        return undefined;
    }

    /**
     * Clear analytics data
     */
    clearAnalytics(): void {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'clearData' in analyticsPlugin && typeof analyticsPlugin.clearData === 'function') {
            analyticsPlugin.clearData();
        }
    }

    /**
     * Get raw analytics data
     */
    getAnalyticsData() {
        const analyticsPlugin = this.teamAgent.getPlugin('ExecutionAnalyticsPlugin');
        if (analyticsPlugin && 'getData' in analyticsPlugin && typeof analyticsPlugin.getData === 'function') {
            return analyticsPlugin.getData();
        }
        return undefined;
    }

    /**
     * Get all plugin statuses
     */
    getPluginStatuses() {
        const plugins = this.teamAgent.getPlugins();
        return plugins.map(plugin => {
            if ('getStatus' in plugin && typeof plugin.getStatus === 'function') {
                return plugin.getStatus();
            }
            return {
                name: plugin.name,
                version: plugin.version,
                enabled: plugin.isEnabled(),
                initialized: true
            };
        });
    }

    /**
     * Get delegation history
     * 
     * Returns raw delegation records for detailed analysis
     */
    getDelegationHistory(): TaskDelegationRecord[] {
        return [...this.delegationHistory];
    }

    /**
     * Get team execution analysis
     * 
     * Provides comprehensive analysis of how the team handled tasks,
     * including delegation patterns and performance metrics
     */
    getTeamExecutionAnalysis(): TeamExecutionAnalysis {
        const analytics = this.getAnalytics();
        const totalExecutions = analytics && 'totalExecutions' in analytics ? Number(analytics['totalExecutions']) : 0;
        const delegatedTasks = this.delegationHistory.length;
        const directlyHandledTasks = Math.max(0, totalExecutions - delegatedTasks);

        // Calculate delegation breakdown by template
        const templateStats = new Map<string, { count: number; totalDuration: number; successes: number }>();

        this.delegationHistory.forEach(record => {
            const template = record.agentTemplate || 'dynamic';
            const stats = templateStats.get(template) || { count: 0, totalDuration: 0, successes: 0 };

            stats.count++;
            stats.totalDuration += record.duration || 0;
            if (record.success) stats.successes++;

            templateStats.set(template, stats);
        });

        const delegationBreakdown = Array.from(templateStats.entries()).map(([template, stats]) => ({
            template,
            count: stats.count,
            averageDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
            successRate: stats.count > 0 ? stats.successes / stats.count : 0
        }));

        // Calculate performance metrics
        const delegationTimes = this.delegationHistory.map(r => r.duration || 0);
        const averageDelegationTime = delegationTimes.length > 0
            ? delegationTimes.reduce((a, b) => a + b, 0) / delegationTimes.length
            : 0;

        const averageDirectHandlingTime = analytics && 'averageDuration' in analytics ? Number(analytics['averageDuration']) : 0;
        const totalExecutionTime = delegationTimes.reduce((a, b) => a + b, 0);

        return {
            totalTasks: totalExecutions,
            directlyHandledTasks,
            delegatedTasks,
            delegationRate: totalExecutions > 0 ? delegatedTasks / totalExecutions : 0,
            delegationBreakdown,
            taskComplexityAnalysis: {
                simple: directlyHandledTasks,
                complex: delegatedTasks
            },
            performanceMetrics: {
                averageDirectHandlingTime,
                averageDelegationTime,
                totalExecutionTime
            }
        };
    }

    /**
     * Clear delegation history
     */
    clearDelegationHistory(): void {
        this.delegationHistory = [];
        this.logger?.debug('Delegation history cleared');
    }

    /**
     * Get current team statistics
     */
    /**
     * Get statistics for team performance (alias for getTeamStats)
     * 
     * @description
     * Returns statistics about team performance including task completion,
     * agent creation, and execution time. This method is used by examples
     * to show team performance metrics.
     * 
     * @returns Object containing team performance statistics
     */
    getStats() {
        return {
            tasksCompleted: this.tasksCompleted,
            totalAgentsCreated: this.totalAgentsCreated,
            totalExecutionTime: this.totalExecutionTime
        };
    }

    getTeamStats() {
        return {
            activeAgentsCount: this.activeAgentsCount,
            totalAgentsCreated: this.totalAgentsCreated,
            maxMembers: this.options.maxMembers || 'unlimited',
            delegationHistoryLength: this.delegationHistory.length,
            successfulTasks: this.delegationHistory.filter(d => d.success).length,
            failedTasks: this.delegationHistory.filter(d => !d.success).length,
            tasksCompleted: this.tasksCompleted,
            totalExecutionTime: this.totalExecutionTime
        };
    }

    /**
     * Reset team statistics
     */
    resetTeamStats(): void {
        this.activeAgentsCount = 0;
        this.totalAgentsCreated = 0;
        this.tasksCompleted = 0;
        this.totalExecutionTime = 0;
        this.delegationHistory = [];
    }

    /**
     * Get available templates
     */
    getTemplates(): AgentTemplate[] {
        return [...this.availableTemplates];
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId: string): AgentTemplate | undefined {
        return this.availableTemplates.find(template => template.id === templateId);
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
     * Create AssignTask tool using the task assignment system
     * Uses AgentDelegationTool with hooks if toolHooks provided, otherwise uses standard facade
     */
    private createAssignTaskTool(): BaseTool<any, any> {
        console.log('🔍 [DEBUG] createAssignTaskTool - toolHooks:', this.toolHooks ? 'PRESENT' : 'MISSING');
        console.log('🔍 [DEBUG] toolHooks details:', this.toolHooks);

        // Convert templates to the format expected by the task assignment system
        const templateInfo: TemplateInfo[] = this.availableTemplates.map(template => ({
            id: template.id,
            description: template.description
        }));

        if (this.toolHooks) {
            console.log('✅ [DEBUG] Using AgentDelegationTool with hooks');
            // Use AgentDelegationTool with hooks for instrumentation
            const delegationTool = new AgentDelegationTool({
                hooks: this.toolHooks,
                availableTemplates: templateInfo,
                executor: async (params: AssignTaskParams) => {
                    return await this.assignTask(params);
                },
                logger: this.logger
            });
            return delegationTool as unknown as BaseTool<any, any>;
        } else {
            console.log('❌ [DEBUG] Using standard facade (no hooks)');
            // Use standard task assignment facade (existing behavior)
            const taskAssignment = createTaskAssignmentFacade(
                templateInfo,
                async (params: AssignTaskParams) => {
                    return await this.assignTask(params);
                }
            );

            // Log the schema for debugging
            console.log('assignTask schema:', JSON.stringify(taskAssignment.tool.schema, null, 2));

            return taskAssignment.tool;
        }
    }

    /**
     * Get built-in agent templates
     */
    private getBuiltinTemplates(): AgentTemplate[] {
        const defaultModel = this.options.baseRobotaOptions.defaultModel.model || 'gpt-4o-mini';
        const defaultProvider = this.options.baseRobotaOptions.defaultModel.provider || 'openai';

        return [
            {
                id: 'general',
                name: 'General Purpose Agent',
                description: 'Basic general-purpose agent with no specific specialization. Use only when no other specialized template fits the task requirements or when task scope is too broad and unclear for specialist agents. This is the fallback option when specialized expertise is not needed.',
                category: 'general',
                tags: ['general', 'default', 'versatile', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are a helpful and capable AI assistant with broad knowledge and skills. You can adapt to various tasks and requirements while maintaining high quality and accuracy. Your strengths include:\n\n• General problem-solving and analysis\n• Clear communication and explanation\n• Flexible task adaptation\n• Balanced approach to different types of work\n• Reliable execution of varied requests\n\nWhen handling tasks:\n1. Analyze the request to understand requirements\n2. Apply appropriate methods and knowledge\n3. Provide clear, useful, and accurate responses\n4. Ask for clarification when needed\n5. Adapt your approach to the specific context\n6. Ensure completeness and quality in your work\n\nProvide helpful, accurate, and well-structured responses that meet the user\'s needs effectively.',
                    temperature: 0.5
                }
            },
            {
                id: 'summarizer',
                name: 'Content Summarizer',
                description: 'Analysis specialist expert in document summarization, data extraction, and distilling complex information. Use for: summarizing documents, extracting key insights, creating executive summaries, condensing reports, highlighting main points, creating meeting notes, and comprehensive content analysis.',
                category: 'analysis',
                tags: ['analysis', 'summarization', 'extraction', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are an expert summarization specialist with advanced capabilities in analyzing and distilling complex information. Your expertise includes:\n\n• Extracting key points and main ideas from lengthy documents\n• Creating concise summaries while preserving essential information\n• Identifying critical insights and actionable items\n• Structuring information in clear, digestible formats\n• Adapting summary length and style to audience needs\n\nWhen summarizing, focus on:\n1. Main themes and central arguments\n2. Supporting evidence and key data points\n3. Conclusions and recommendations\n4. Action items and next steps\n5. Critical dependencies and risks\n\nDELEGATION GUIDELINES:\n- Handle summarization and analysis tasks directly within your expertise\n- Consider delegating if the task requires specialized domain research, creative ideation, or ethical review beyond summarization\n- Only delegate when it would significantly improve quality or when the task clearly falls outside summarization expertise\n- For pure summarization requests, always handle directly\n\nProvide summaries that are accurate, comprehensive, and immediately useful for decision-making.',
                    temperature: 0.3
                }
            },
            {
                id: 'ethical_reviewer',
                name: 'Ethical Reviewer',
                description: 'Ethics and compliance specialist expert in comprehensive review processes. Use for: ethical evaluation, compliance checking, bias detection, privacy assessment, content moderation, legal review, risk analysis, safety evaluation, and responsible AI practices.',
                category: 'analysis',
                tags: ['ethics', 'review', 'compliance', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are an ethical review specialist focused on responsible AI practices and content compliance. Your expertise covers:\n\n• AI ethics and responsible technology development\n• Privacy protection and data governance\n• Bias detection and fairness assessment\n• Legal compliance and regulatory requirements\n• Content moderation and safety guidelines\n• Transparency and accountability standards\n\nWhen reviewing content or proposals, evaluate:\n1. Potential ethical implications and risks\n2. Privacy and data protection concerns\n3. Bias, fairness, and inclusivity issues\n4. Legal and regulatory compliance\n5. Transparency and explainability requirements\n6. Potential unintended consequences\n\nProvide balanced assessments with specific recommendations for addressing identified concerns while supporting innovation and progress.',
                    temperature: 0.2
                }
            },
            {
                id: 'creative_ideator',
                name: 'Creative Ideator',
                description: 'Creativity and innovation specialist expert in brainstorming and imaginative problem solving. Use for: brainstorming sessions, innovative product concepts, creative problem solving, design thinking, artistic projects, marketing campaigns, breakthrough ideas, imaginative solutions, and out-of-the-box thinking.',
                category: 'creative',
                tags: ['creativity', 'brainstorming', 'innovation', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are a creative ideation expert specializing in innovative thinking and breakthrough idea generation. Your strengths include:\n\n• Divergent thinking and brainstorming techniques\n• Cross-industry innovation and pattern recognition\n• Creative problem-solving methodologies\n• Design thinking and user-centered innovation\n• Future-oriented scenario planning\n• Connecting disparate concepts and ideas\n\nWhen generating ideas, apply:\n1. Multiple perspective-taking and reframing\n2. "What if" scenarios and possibility thinking\n3. Combination and recombination of existing concepts\n4. Challenge assumptions and conventional wisdom\n5. Explore edge cases and unconventional approaches\n6. Consider both incremental and radical innovations\n\nDeliver creative solutions that are imaginative yet practical, pushing boundaries while remaining grounded in feasibility.',
                    temperature: 0.8
                }
            },
            {
                id: 'fast_executor',
                name: 'Fast Executor',
                description: 'Speed and accuracy specialist expert in rapid task execution. Use for: quick tasks, urgent requests, simple implementations, straightforward analysis, routine operations, time-sensitive work, efficient problem solving, rapid prototyping, and immediate action items requiring fast, accurate execution.',
                category: 'execution',
                tags: ['execution', 'speed', 'accuracy', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are a fast and accurate task executor focused on efficiency and precision. Your core competencies include:\n\n• Rapid task analysis and prioritization\n• Efficient workflow optimization\n• Quick decision-making with available information\n• Streamlined communication and reporting\n• Resource optimization and time management\n• Quality control under time constraints\n\nWhen executing tasks, prioritize:\n1. Speed without compromising accuracy\n2. Clear, concise deliverables\n3. Essential information over comprehensive detail\n4. Actionable outputs and next steps\n5. Efficient use of available resources\n6. Quick validation and error checking\n\nDeliver results that meet requirements efficiently, focusing on what matters most for immediate progress and decision-making.',
                    temperature: 0.1,
                    maxTokens: 1000
                }
            },
            {
                id: 'domain_researcher',
                name: 'Domain Researcher',
                description: 'Research and analysis specialist with deep domain-expertise. Use for: market research, competitive analysis, technical investigation, academic research, industry analysis, trend studies, data analysis, expert insights, comprehensive reports, and evidence-based conclusions requiring specialized research skills.',
                category: 'research',
                tags: ['research', 'analysis', 'domain-expertise', 'specialist'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: 'You are a domain research specialist with expertise in conducting thorough investigations across various fields. Your research capabilities include:\n\n• Systematic literature review and analysis\n• Primary and secondary source evaluation\n• Cross-disciplinary knowledge synthesis\n• Trend analysis and pattern recognition\n• Expert opinion and perspective gathering\n• Evidence-based conclusion development\n\nWhen conducting research, focus on:\n1. Comprehensive coverage of relevant sources\n2. Critical evaluation of information quality\n3. Identification of knowledge gaps and limitations\n4. Synthesis of findings into coherent insights\n5. Recognition of competing perspectives and debates\n6. Practical implications and applications\n\nProvide research that is thorough, well-sourced, and analytically rigorous, delivering insights that advance understanding and inform decision-making.',
                    temperature: 0.4
                }
            },
            {
                id: 'task_coordinator',
                name: 'Task Coordinator',
                description: 'Management and coordination specialist expert in task-management workflows. Use for: managing team workload, assigning tasks, monitoring progress, coordinating resources, ensuring timely completion of tasks, and complex project coordination requiring management expertise.',
                category: 'management',
                tags: ['management', 'coordination', 'task-management'],
                config: {
                    model: defaultModel,
                    provider: defaultProvider,
                    systemMessage: `You are a Team Coordinator that manages collaborative work through intelligent task delegation.

CORE PRINCIPLES:
- Respond in the same language as the user's input
- For simple, single-component tasks, handle them directly yourself
- For complex or multi-faceted tasks, delegate to specialized team members
- Each delegated task must be self-contained and understandable without context
- Always synthesize and integrate results from team members into your final response

AVAILABLE ROLES:
- Coordinators: Can break down complex tasks and manage workflows
- Specialists: Focus on specific domains and can handle targeted tasks efficiently

DELEGATION BEST PRACTICES:
- Create clear, standalone instructions for each specialist
- Avoid overlapping tasks between different team members
- Select appropriate specialist templates based on task requirements
- Ensure each delegated task is complete and actionable
- Handle final synthesis and coordination yourself

Your goal is to coordinate effectively while leveraging specialist expertise for optimal results.`,
                    temperature: 0.6
                }
            }
        ];
    }
}

