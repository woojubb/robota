import { v4 as uuidv4 } from 'uuid';
import { Robota } from '@robota-sdk/core';
import type { RobotaOptions } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';
import { AgentFactory, type TaskAgent } from './agent-factory';
import type {
    TeamContainerOptions,
    AgentConfig,
    DelegateWorkParams,
    DelegateWorkResult,
    TeamStats,
    TeamExecutionStructure,
    AgentNode
} from './types';
import { ZodFunctionTool } from '@robota-sdk/tools';
import type { UniversalMessage } from '@robota-sdk/core';

/**
 * Raw conversation data for a single agent
 */
export interface AgentConversationData {
    agentId: string;
    taskDescription?: string;
    parentAgentId?: string;
    messages: UniversalMessage[];
    createdAt: Date;
    childAgentIds: string[];
}

/**
 * Complete workflow history with all agent conversations
 */
export interface WorkflowHistory {
    executionId: string;
    userRequest: string;
    finalResult: string;
    startTime: Date;
    endTime?: Date;
    success?: boolean;
    error?: string;
    agentConversations: AgentConversationData[];
    agentTree: AgentTreeNode[];
}

/**
 * Tree structure for representing agent hierarchy
 */
export interface AgentTreeNode {
    agentId: string;
    taskDescription?: string;
    messageCount: number;
    children: AgentTreeNode[];
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
 * - **Performance Monitoring**: Comprehensive statistics and performance tracking
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
 * // View team performance statistics
 * const stats = team.getStats();
 * console.log(`Created ${stats.totalAgentsCreated} specialized agents`);
 * console.log(`Completed ${stats.tasksCompleted} tasks in ${stats.totalExecutionTime}ms`);
 * ```
 * 
 * @see {@link createTeam} - Convenience function for creating teams
 * @see {@link DelegateWorkParams} - Parameters for task delegation
 * @see {@link TeamStats} - Team performance statistics
 */
export class TeamContainer {
    private teamAgent: Robota;
    private agentFactory: AgentFactory;
    private options: TeamContainerOptions;
    private stats: TeamStats;
    private logger?: any;
    private toolCallCount: number = 0;
    private executionStructure: TeamExecutionStructure | null = null;
    private lastCompletedExecution: TeamExecutionStructure | null = null;

    /**
     * Create a TeamContainer instance
     * 
     * @param options - Configuration options for the team
     * 
     * @example
     * ```ts
     * const team = new TeamContainer({
     *   baseRobotaOptions: {
     *     aiProviders: { openai: openaiProvider },
     *     currentProvider: 'openai',
     *     currentModel: 'gpt-4'
     *   },
     *   maxMembers: 5,
     *   debug: true
     * });
     * ```
     */
    constructor(options: TeamContainerOptions) {
        this.options = options;
        this.stats = {
            totalAgentsCreated: 0,
            totalExecutionTime: 0,
            totalTokensUsed: 0,
            tasksCompleted: 0,
            tasksFailed: 0
        };

        // Create AgentFactory for creating temporary agents
        this.agentFactory = new AgentFactory(options.baseRobotaOptions, options.debug);

        this.logger = options.baseRobotaOptions.logger;

        // Create delegate work tool
        const delegateWorkTool = this.createDelegateWorkTool();

        this.teamAgent = new Robota({
            ...options.baseRobotaOptions,
            systemPrompt: this.generateTeamSystemPrompt(),
            toolProviders: [delegateWorkTool]
        });

        this.setupToolCallTracking();
    }

    /**
     * Execute a user prompt through the team
     * 
     * @param userPrompt - The user's request to be processed by the team
     * @returns Promise resolving to the final result
     * 
     * @example
     * ```ts
     * const result = await team.execute(
     *   'Create a comprehensive marketing strategy for our new SaaS product'
     * );
     * ```
     */
    async execute(userPrompt: string): Promise<string> {
        const startTime = Date.now();
        const executionId = uuidv4();

        // Initialize execution structure
        this.executionStructure = {
            executionId,
            userRequest: userPrompt,
            finalResult: '',
            startTime: new Date(startTime),
            agents: new Map(),
            rootAgentId: 'team-coordinator'
        };

        // Add the team coordinator as root agent
        this.executionStructure.agents.set('team-coordinator', {
            agentId: 'team-coordinator',
            agent: this.teamAgent,
            createdAt: new Date(startTime),
            childAgentIds: []
        });

        try {
            if (this.options.debug) {
                console.log(`[TeamContainer] Executing user prompt: ${userPrompt}`);
            }

            // Let the team agent decide everything through prompts
            const prompt = this.buildTeamPrompt(userPrompt);
            const result = await this.teamAgent.run(prompt);

            const executionTime = Date.now() - startTime;
            this.stats.totalExecutionTime += executionTime;
            this.stats.tasksCompleted++;

            // Complete execution structure
            this.executionStructure.finalResult = result;
            this.executionStructure.endTime = new Date();
            this.executionStructure.success = true;

            // Store completed execution before clearing
            this.lastCompletedExecution = { ...this.executionStructure };

            if (this.options.debug) {
                console.log(`[TeamContainer] Task completed in ${executionTime}ms`);
            }

            return result;
        } catch (error) {
            this.stats.tasksFailed++;
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Mark execution as failed
            if (this.executionStructure) {
                this.executionStructure.endTime = new Date();
                this.executionStructure.success = false;
                this.executionStructure.error = errorMessage;

                // Store failed execution before clearing
                this.lastCompletedExecution = { ...this.executionStructure };
            }

            if (this.options.debug) {
                console.error(`[TeamContainer] Task failed: ${errorMessage}`);
            }

            throw new Error(`Team execution failed: ${errorMessage}`);
        } finally {
            this.executionStructure = null;
        }
    }

    /**
     * Delegate specialized work to a temporary expert agent
     * 
     * @description
     * This method creates a temporary specialized agent to handle a specific task.
     * The agent is configured with appropriate tools and context for the task,
     * executes the work, and is automatically cleaned up after completion.
     * 
     * @param params - Work delegation parameters
     * @param params.jobDescription - Clear description of the specific job to delegate
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
     * const result = await team.delegateWork({
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
    async delegateWork(params: DelegateWorkParams): Promise<DelegateWorkResult> {
        const startTime = Date.now();
        let temporaryAgent: TaskAgent | null = null;

        try {
            if (this.options.debug) {
                console.log(`[TeamContainer] Delegating work: ${params.jobDescription}`);
            }

            // Check if we've reached the maximum number of members
            if (this.options.maxMembers && this.stats.totalAgentsCreated >= this.options.maxMembers) {
                throw new Error(`Maximum number of team members (${this.options.maxMembers}) reached`);
            }

            // Create a temporary agent for this specific task
            temporaryAgent = await this.agentFactory.createRobotaForTask({
                taskDescription: params.jobDescription,
                requiredTools: params.requiredTools || []
            });

            this.stats.totalAgentsCreated++;

            // Add agent to execution structure if tracking
            if (this.executionStructure) {
                const agentNode: AgentNode = {
                    agentId: temporaryAgent.id,
                    agent: temporaryAgent,
                    parentAgentId: 'team-coordinator', // For now, all delegated agents are children of coordinator
                    taskDescription: params.jobDescription,
                    createdAt: new Date(),
                    childAgentIds: []
                };

                this.executionStructure.agents.set(temporaryAgent.id, agentNode);

                // Add to parent's children list
                const parentAgent = this.executionStructure.agents.get('team-coordinator');
                if (parentAgent) {
                    parentAgent.childAgentIds.push(temporaryAgent.id);
                }
            }

            // Execute the task with the temporary agent
            const taskPrompt = this.buildTaskPrompt(params);
            const result = await temporaryAgent.run(taskPrompt);

            const executionTime = Date.now() - startTime;

            // Build result with metadata
            const delegateResult: DelegateWorkResult = {
                result,
                agentId: temporaryAgent.id,
                metadata: {
                    executionTime,
                    tokensUsed: this.estimateTokenUsage(taskPrompt, result),
                    errors: []
                }
            };

            // Update stats
            this.stats.totalExecutionTime += executionTime;
            this.stats.totalTokensUsed += delegateResult.metadata.tokensUsed || 0;

            if (this.options.debug) {
                console.log(`[TeamContainer] Work delegated successfully to agent ${temporaryAgent.id}`);
            }

            return delegateResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const executionTime = Date.now() - startTime;

            if (this.options.debug) {
                console.error(`[TeamContainer] Work delegation failed: ${errorMessage}`);
            }

            // Return error result
            return {
                result: `Task failed: ${errorMessage}`,
                agentId: temporaryAgent?.id || 'unknown',
                metadata: {
                    executionTime,
                    errors: [errorMessage]
                }
            };
        } finally {
            // Always cleanup the temporary agent
            if (temporaryAgent) {
                temporaryAgent.close();
            }
        }
    }

    /**
     * Get comprehensive team execution statistics
     * 
     * @description
     * Returns detailed statistics about team performance including agent creation,
     * task completion rates, execution times, and resource utilization.
     * 
     * @returns Current team statistics
     * @returns {number} returns.totalAgentsCreated - Total number of specialized agents created
     * @returns {number} returns.totalExecutionTime - Cumulative execution time in milliseconds
     * @returns {number} returns.totalTokensUsed - Total tokens consumed by all agents
     * @returns {number} returns.tasksCompleted - Number of successfully completed tasks
     * @returns {number} returns.tasksFailed - Number of failed tasks
     * 
     * @example
     * ```typescript
     * const stats = team.getStats();
     * 
     * console.log(`Team Performance:`);
     * console.log(`- Created ${stats.totalAgentsCreated} specialized agents`);
     * console.log(`- Completed ${stats.tasksCompleted} tasks (${stats.tasksFailed} failed)`);
     * console.log(`- Total execution time: ${stats.totalExecutionTime}ms`);
     * console.log(`- Tokens used: ${stats.totalTokensUsed}`);
     * 
     * const successRate = stats.tasksCompleted / (stats.tasksCompleted + stats.tasksFailed);
     * console.log(`- Success rate: ${(successRate * 100).toFixed(1)}%`);
     * ```
     */
    getStats(): TeamStats {
        return { ...this.stats };
    }

    /**
     * Reset team statistics to initial values
     * 
     * @description
     * Clears all performance statistics and counters, resetting the team
     * to its initial state. Useful for benchmarking or starting fresh
     * after a series of operations.
     * 
     * @example
     * ```typescript
     * // Run some operations
     * await team.execute('Analyze market data');
     * await team.execute('Create financial report');
     * 
     * console.log(team.getStats()); // Shows accumulated statistics
     * 
     * // Reset for new benchmark
     * team.resetStats();
     * console.log(team.getStats()); // All counters back to zero
     * ```
     */
    resetStats(): void {
        this.stats = {
            totalAgentsCreated: 0,
            totalExecutionTime: 0,
            totalTokensUsed: 0,
            tasksCompleted: 0,
            tasksFailed: 0
        };
    }

    /**
     * Get the current execution structure with agent relationships
     * 
     * @returns Current execution structure or null if no execution is running
     */
    getExecutionStructure(): TeamExecutionStructure | null {
        return this.executionStructure;
    }

    /**
     * Get the last completed execution structure
     * 
     * @returns Last completed execution structure or null if no execution has been completed
     */
    getLastCompletedExecution(): TeamExecutionStructure | null {
        return this.lastCompletedExecution;
    }

    /**
     * Check if there is an active execution
     * 
     * @returns True if an execution is currently running
     */
    hasActiveExecution(): boolean {
        return this.executionStructure !== null;
    }

    /**
     * Get workflow history from last completed execution
     * 
     * @returns Complete workflow history or null if no execution completed
     * 
     * @example
     * ```ts
     * await team.execute('Create marketing strategy');
     * const history = team.getWorkflowHistory();
     * if (history) {
     *   console.log(`Execution took ${history.endTime - history.startTime}ms`);
     *   console.log(`Used ${history.agentConversations.length} agents`);
     * }
     * ```
     */
    getWorkflowHistory(): WorkflowHistory | null {
        const execution = this.getLastCompletedExecution();
        if (!execution) {
            return null;
        }

        try {
            return this.extractWorkflowHistory(execution);
        } catch (error) {
            this.logger?.error('Error extracting workflow history:', error);
            return null;
        }
    }

    /**
     * Generate system prompt for the Team agent
     */
    private generateTeamSystemPrompt(): string {
        return `You are an intelligent Team Coordinator that manages collaborative work through delegation.

CORE PRINCIPLES:
- Respond in the same language as the user's input
- PREFER COLLABORATION: When in doubt, lean towards delegating work to specialized team members
- This is a TEAM environment - utilize team members for better results
- Analyze each request thoroughly to determine the optimal approach
- Make intelligent decisions about when to delegate vs handle directly
- Think step-by-step about what the user really needs
- NEVER leave any part of a multi-component request unaddressed

CRITICAL DELEGATION RULES:

1. SUB AGENTS ARE ISOLATED: They know NOTHING about your conversation. They cannot see the original request or other tasks.

2. NO SEQUENTIAL SPLITTING: NEVER break "list N things" into N separate tasks. This creates meaningless instructions like "explain the first one" which sub agents cannot understand.

3. SELF-CONTAINED INSTRUCTIONS ONLY: Every delegated task must be completely understandable without any external context. If you cannot write a fully independent instruction, handle the task directly.

4. COMPLETE SCOPE PRESERVATION: When delegating, maintain the FULL original scope. Do not reduce "3 differences" to "1 difference".

5. NO RELATIVE REFERENCES: Do not use ordinal numbers, positional words, or references to other parts.

6. NO REDUNDANT DELEGATION: Avoid delegating tasks that overlap or duplicate work. Each delegation should cover distinct, non-overlapping aspects.

7. TEAM LEADER SYNTHESIS ROLE: Your role as team coordinator is to delegate data gathering/analysis to specialists, then synthesize their findings into the final answer. Do NOT delegate the final comparison, synthesis, or conclusion tasks.

TASK DISTRIBUTION STRATEGY:

For Comparison/Analysis Tasks (e.g., "Compare A vs B", "Differences between X and Y"):
- Delegate: Individual component analysis (e.g., "Analyze React's features", "Analyze Vue.js features")
- Retain: Final comparison, synthesis, and conclusion drawing
- AVOID: Delegating direct comparison tasks that duplicate your synthesis work

For Multi-Component Tasks:
- Delegate: Each distinct component that requires specialized knowledge
- Retain: Integration, prioritization, and final structuring
- AVOID: Overlapping or redundant task assignments

For Information Gathering:
- Delegate: Research on specific topics, data collection, specialized analysis
- Retain: Information synthesis, final formatting, and comprehensive response building

WORKFLOW ANALYSIS:
When you receive a user request, analyze it to determine the best approach:

1. If this is a simple, single-component task you can handle directly, do so
2. If this request requires multiple specialized tasks or components:
   - IDENTIFY ALL distinct components mentioned in the request
   - Break down the request into separate, NON-OVERLAPPING components  
   - Use delegateWork for EACH component separately (avoiding redundancy)
   - Wait for ALL results before providing your final response
   - Synthesize all results into a comprehensive answer that YOU create

DELEGATION GUIDELINES:
- If the user's request has multiple distinct parts that need different expertise, delegate each part separately
- Look for indicators of multi-component work: different domains, varied methodologies, numbered lists, explicit divisions
- For comparison tasks: delegate individual component analysis, retain comparison synthesis
- For complex multi-part requests requiring different expertise, break them down intelligently
- Ensure your final response addresses ALL parts of the user's request
- Be intelligent about when to delegate vs handle directly
- When using delegateWork, follow the parameter requirements defined in the tool schema
- DO NOT stop after the first delegation if there are more components to handle
- AVOID delegating the same type of work multiple times with different angles

DECISION FRAMEWORK:
- Can I write a complete, standalone instruction that makes sense to someone who knows nothing about this conversation?
- If YES: Delegate with full scope (but avoid overlap with other delegations)
- If NO: Handle directly
- Is this a synthesis/comparison/conclusion task that requires my oversight?
- If YES: Handle directly after gathering component data
- If NO: Consider delegation for data gathering

EXAMPLE - GOOD DELEGATION for "Compare React vs Vue.js differences":
✅ Delegate: "Analyze React's core features, architecture, and development approach"
✅ Delegate: "Analyze Vue.js's core features, architecture, and development approach"  
✅ Retain: Compare findings and identify key differences

EXAMPLE - BAD DELEGATION:
❌ "Analyze React features" + "Analyze Vue features" + "Compare React vs Vue differences"
(The third delegation duplicates your synthesis work)

You have access to the delegateWork tool. Use it wisely to provide complete responses that address the full scope of user requests while avoiding redundant work distribution.`;
    }

    /**
     * Build the prompt for the Team agent
     */
    private buildTeamPrompt(userPrompt: string): string {
        return userPrompt;
    }

    /**
     * Build the prompt for task agents
     */
    private buildTaskPrompt(params: DelegateWorkParams): string {
        let prompt = params.jobDescription;

        if (params.context) {
            prompt += `\n\nAdditional Context: ${params.context}`;
        }

        if (params.priority) {
            prompt += `\n\nPriority Level: ${params.priority}`;
        }

        return prompt;
    }

    /**
     * Estimate token usage for logging purposes
     */
    private estimateTokenUsage(prompt: string, response: string): number {
        // Rough estimation: ~4 characters per token
        return Math.ceil((prompt.length + response.length) / 4);
    }

    /**
     * Create the delegateWork tool
     */
    private createDelegateWorkTool() {
        const delegateWorkSchema = z.object({
            jobDescription: z.string().describe('Clear description of the specific job to delegate'),
            context: z.string().describe('Additional context or constraints for the job'),
            requiredTools: z.array(z.string()).optional().describe('List of tools the member might need'),
            priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium').describe('Priority level for the task')
        });

        const tools = {
            delegateWork: {
                name: 'delegateWork',
                description: 'Delegate work to a specialized team member. Use this when the task requires specific expertise, complex analysis, or when breaking down work into specialized components would be beneficial.',
                parameters: delegateWorkSchema,
                handler: async (params: { [x: string]: any }) => {
                    this.toolCallCount++;
                    this.logger?.info(`🎯 Tool call #${this.toolCallCount} received: delegateWork`);
                    this.logger?.info(`📋 Job: ${params.jobDescription}`);

                    // Type-safe conversion to DelegateWorkParams
                    const delegateParams: DelegateWorkParams = {
                        jobDescription: params.jobDescription,
                        context: params.context,
                        requiredTools: params.requiredTools || [],
                        priority: params.priority || 'medium'
                    };

                    return await this.delegateWork(delegateParams);
                }
            }
        };

        return createZodFunctionToolProvider({ tools });
    }

    /**
     * Setup tool call tracking
     */
    private setupToolCallTracking(): void {
        const originalRun = this.teamAgent.run.bind(this.teamAgent);
        this.teamAgent.run = async (input: string, options?: any) => {
            this.logger?.info('🚀 Team agent starting work...');
            this.toolCallCount = 0;

            const result = await originalRun(input, options);

            if (this.toolCallCount > 0) {
                this.logger?.info(`📊 Total tool calls made: ${this.toolCallCount}`);
            } else {
                this.logger?.info('ℹ️  No tool calls made - handling directly');
            }

            return result;
        };
    }

    /**
     * Initialize the team agent with the delegateWork tool
     */
    private initializeTeamAgent(): void {
        // This method is no longer needed as tool is added in constructor
    }

    /**
     * Extract complete workflow history from team execution structure
     */
    private extractWorkflowHistory(executionStructure: TeamExecutionStructure): WorkflowHistory {
        const agentConversations: AgentConversationData[] = [];
        const agentTree: AgentTreeNode[] = [];

        // Extract conversation data from each agent
        for (const [agentId, agentNode] of executionStructure.agents) {
            let messages = [];

            // Handle different agent types (team coordinator vs task agents)
            if (agentNode.agentId === 'team-coordinator') {
                // Team coordinator is a direct Robota instance
                messages = (agentNode.agent as any).conversation.getMessages();
            } else {
                // Task agents need to use getRobotaInstance() method
                const taskAgent = agentNode.agent as any;
                if (taskAgent.getRobotaInstance) {
                    messages = taskAgent.getRobotaInstance().conversation.getMessages();
                }
            }

            const conversationData: AgentConversationData = {
                agentId: agentNode.agentId,
                taskDescription: agentNode.taskDescription,
                parentAgentId: agentNode.parentAgentId,
                messages: messages,
                createdAt: agentNode.createdAt,
                childAgentIds: agentNode.childAgentIds
            };

            agentConversations.push(conversationData);
        }

        // Build agent tree starting from root
        const rootAgent = executionStructure.agents.get(executionStructure.rootAgentId);
        if (rootAgent) {
            agentTree.push(this.buildAgentTree(rootAgent, executionStructure.agents));
        }

        return {
            executionId: executionStructure.executionId,
            userRequest: executionStructure.userRequest,
            finalResult: executionStructure.finalResult,
            startTime: executionStructure.startTime,
            endTime: executionStructure.endTime,
            success: executionStructure.success,
            error: executionStructure.error,
            agentConversations,
            agentTree
        };
    }

    /**
     * Build agent tree recursively
     */
    private buildAgentTree(agentNode: AgentNode, allAgents: Map<string, AgentNode>): AgentTreeNode {
        const children: AgentTreeNode[] = [];

        for (const childId of agentNode.childAgentIds) {
            const childAgent = allAgents.get(childId);
            if (childAgent) {
                children.push(this.buildAgentTree(childAgent, allAgents));
            }
        }

        // Get message count based on agent type
        let messageCount = 0;
        if (agentNode.agentId === 'team-coordinator') {
            // Team coordinator is a direct Robota instance
            messageCount = (agentNode.agent as any).conversation.getMessageCount();
        } else {
            // Task agents need to use getRobotaInstance() method
            const taskAgent = agentNode.agent as any;
            if (taskAgent.getRobotaInstance) {
                messageCount = taskAgent.getRobotaInstance().conversation.getMessageCount();
            }
        }

        return {
            agentId: agentNode.agentId,
            taskDescription: agentNode.taskDescription,
            messageCount: messageCount,
            children
        };
    }


}

