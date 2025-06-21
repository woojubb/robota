import type { RobotaOptions, AgentTemplateManager, AIProvider } from '@robota-sdk/core';

/**
 * Team creation options for template-based teams
 * 
 * @description
 * Configuration interface for creating teams when using agent templates.
 * Since templates define their own AI providers, models, and settings,
 * you only need to provide the basic AI providers and optional configuration.
 * 
 * @example
 * ```typescript
 * const team = createTeam({
 *   aiProviders: {
 *     openai: openaiProvider,
 *     anthropic: anthropicProvider
 *   },
 *   debug: true
 * });
 * ```
 */
export interface TeamOptions {
    /** 
     * AI providers available for templates to use.
     * Each template specifies which provider it prefers.
     */
    aiProviders: Record<string, AIProvider>;

    /** 
     * Maximum number of team members that can be created concurrently.
     * Default: 5
     */
    maxMembers?: number;

    /** 
     * Enable debug mode for detailed logging of team operations.
     * Default: false
     */
    debug?: boolean;

    /** 
     * Maximum token limit for the entire conversation history.
     * Default: 50000
     */
    maxTokenLimit?: number;

    /** 
     * Logger for team operations. If not provided, no logging will be done.
     */
    logger?: any;

    /** 
     * Agent template manager for managing built-in and custom agent templates.
     * If not provided, a default template manager with built-in templates will be created.
     */
    templateManager?: AgentTemplateManager;

    /** 
     * Name of the agent template to use for the team coordinator/leader role.
     * This template should be specialized for task analysis, work distribution, and coordination.
     * Default: "task_coordinator"
     */
    leaderTemplate?: string;
}

/**
 * Internal configuration options for TeamContainer (used internally)
 * @internal
 */
export interface TeamContainerOptions {
    baseRobotaOptions: RobotaOptions;
    maxMembers?: number;
    debug?: boolean;
    templateManager?: AgentTemplateManager;
    leaderTemplate?: string;
}

/**
 * Configuration for creating an agent
 */
export interface AgentConfig {
    /** AI provider to use (e.g., 'openai', 'anthropic', 'google') */
    provider: string;
    /** Model name to use */
    model: string;
    /** System prompt for the agent */
    systemPrompt?: string;
    /** Maximum tokens for responses */
    maxTokens?: number;
    /** Temperature for response generation */
    temperature?: number;
}

/**
 * Parameters for assigning tasks to a specialized team member
 * 
 * @description
 * Defines the parameters needed when the team coordinator assigns a specialized
 * task to a temporary expert agent. The system uses these parameters to create
 * an appropriately configured agent and execute the task.
 * 
 * @example
 * ```typescript
 * const taskParams: AssignTaskParams = {
 *   jobDescription: 'Analyze market trends for electric vehicles in California',
 *   context: 'Focus on pricing strategies and customer adoption rates for Q1 2024',
 *   requiredTools: ['market-data-api', 'trend-analysis'],
 *   priority: 'high'
 * };
 * 
 * const result = await team.assignTask(taskParams);
 * ```
 */
export interface AssignTaskParams {
    /** 
     * Clear, specific description of the job to be completed.
     * Should provide enough detail for the specialist agent to understand
     * the scope and deliverables expected.
     */
    jobDescription: string;

    /** 
     * Additional context, constraints, or requirements for the job.
     * Helps the specialist agent understand the broader context and
     * any specific limitations or guidelines to follow.
     */
    context?: string;

    /** 
     * List of tools the specialist agent might need for this task.
     * If specified, the system will attempt to configure the agent
     * with access to these tools.
     */
    requiredTools?: string[];

    /** 
     * Priority level for the task, affecting resource allocation and urgency.
     * Higher priority tasks may receive more resources or faster processing.
     */
    priority?: 'low' | 'medium' | 'high' | 'urgent';

    /** 
     * Name of the agent template to use for this task.
     * Templates provide predefined configurations optimized for specific types of work.
     * Available templates: 'summarizer', 'ethical_reviewer', 'creative_ideator', 
     * 'fast_executor', 'domain_researcher', and any custom templates.
     * If not specified, a dynamic agent will be created based on the job description.
     */
    agentTemplate?: string;
}

/**
 * Result from an assigned task with execution metadata
 * 
 * @description
 * Contains the output from a specialized agent along with comprehensive
 * metadata about the task execution including performance metrics,
 * resource usage, and any errors encountered.
 * 
 * @example
 * ```typescript
 * const result: AssignTaskResult = await team.assignTask({
 *   jobDescription: 'Create financial projections',
 *   context: 'For a startup coffee shop',
 *   priority: 'high'
 * });
 * 
 * console.log('Task result:', result.result);
 * console.log('Executed by agent:', result.agentId);
 * console.log('Execution time:', result.metadata.executionTime + 'ms');
 * console.log('Tokens used:', result.metadata.tokensUsed);
 * 
 * if (result.metadata.errors?.length > 0) {
 *   console.log('Errors encountered:', result.metadata.errors);
 * }
 * ```
 */
export interface AssignTaskResult {
    /** 
     * The completed task result content from the specialist agent.
     * This contains the actual deliverable requested in the job description.
     */
    result: string;

    /** 
     * Unique identifier of the temporary agent that performed the task.
     * Useful for debugging and tracking which specialist handled the work.
     */
    agentId: string;

    /** 
     * Comprehensive metadata about the task execution including
     * performance metrics, resource usage, and error information.
     */
    metadata: {
        /** 
         * Time taken to complete the task in milliseconds.
         * Includes agent creation, task execution, and cleanup time.
         */
        executionTime: number;

        /** 
         * Estimated number of tokens consumed during task execution.
         * Useful for cost tracking and resource optimization.
         */
        tokensUsed?: number;

        /** 
         * List of any errors encountered during task execution.
         * Empty array indicates successful completion without errors.
         */
        errors?: string[];
    };
}

/**
 * Configuration for creating a task-specific agent
 */
export interface TaskAgentConfig {
    /** Description of the task the agent will perform */
    taskDescription: string;
    /** Required tools for the task */
    requiredTools: string[];
    /** Agent configuration overrides */
    agentConfig?: Partial<AgentConfig>;
}

/**
 * Represents a single agent in the team execution
 */
export interface AgentNode {
    /** Unique identifier for this agent */
    agentId: string;
    /** Reference to the actual Robota agent instance */
    agent: any; // Will be Robota instance
    /** ID of the parent agent that created this agent (null for team coordinator) */
    parentAgentId?: string;
    /** Task description that this agent was created for */
    taskDescription?: string;
    /** Timestamp when this agent was created */
    createdAt: Date;
    /** List of child agents created by this agent */
    childAgentIds: string[];
    /** AI provider used by this agent */
    aiProvider?: string;
    /** AI model used by this agent */
    aiModel?: string;
    /** Agent template used (if any) */
    agentTemplate?: string;
}

/**
 * Team execution structure that tracks agent relationships
 */
export interface TeamExecutionStructure {
    /** Unique identifier for this execution */
    executionId: string;
    /** Initial user request */
    userRequest: string;
    /** Final result */
    finalResult: string;
    /** Timestamp when execution started */
    startTime: Date;
    /** Timestamp when execution completed */
    endTime?: Date;
    /** Map of all agents involved in this execution */
    agents: Map<string, AgentNode>;
    /** ID of the root team coordinator agent */
    rootAgentId: string;
    /** Whether the execution was successful */
    success?: boolean;
    /** Error message if execution failed */
    error?: string;
}

/**
 * Comprehensive team execution statistics and performance metrics
 * 
 * @description
 * Provides detailed insights into team performance including resource utilization,
 * task completion rates, and efficiency metrics. Useful for monitoring costs,
 * optimizing workflows, and understanding team behavior patterns.
 * 
 * @example
 * ```typescript
 * // After running several team tasks
 * const stats = team.getStats();
 * 
 * console.log(`Team Performance Report:`);
 * console.log(`├─ Agents created: ${stats.totalAgentsCreated}`);
 * console.log(`├─ Tasks completed: ${stats.tasksCompleted}`);
 * console.log(`├─ Tasks failed: ${stats.tasksFailed}`);
 * console.log(`├─ Total execution time: ${stats.totalExecutionTime}ms`);
 * console.log(`└─ Total tokens used: ${stats.totalTokensUsed}`);
 * 
 * // Calculate derived metrics
 * const successRate = stats.tasksCompleted / (stats.tasksCompleted + stats.tasksFailed);
 * const avgExecutionTime = stats.totalExecutionTime / stats.tasksCompleted;
 * const avgTokensPerTask = stats.totalTokensUsed / stats.tasksCompleted;
 * 
 * console.log(`\nDerived Metrics:`);
 * console.log(`├─ Success rate: ${(successRate * 100).toFixed(1)}%`);
 * console.log(`├─ Average execution time: ${avgExecutionTime.toFixed(0)}ms`);
 * console.log(`└─ Average tokens per task: ${avgTokensPerTask.toFixed(0)}`);
 * ```
 */
export interface TeamStats {
    /** 
     * Total number of specialized agents created across all tasks.
     * Each delegated task typically creates one temporary agent.
     */
    totalAgentsCreated: number;

    /** 
     * Cumulative execution time in milliseconds for all completed tasks.
     * Includes agent creation, task execution, and cleanup overhead.
     */
    totalExecutionTime: number;

    /** 
     * Total tokens consumed across all agents and tasks.
     * Useful for cost tracking and resource optimization.
     */
    totalTokensUsed: number;

    /** 
     * Number of tasks that completed successfully without errors.
     * Used to calculate success rates and reliability metrics.
     */
    tasksCompleted: number;

    /** 
     * Number of tasks that failed due to errors or resource constraints.
     * Helps identify issues with task complexity or system limits.
     */
    tasksFailed: number;

    /** 
     * Breakdown of agent template usage.
     * Maps template names to usage counts for tracking template effectiveness.
     */
    templateUsage: Record<string, number>;

    /** 
     * Number of agents created using templates vs dynamic generation.
     * Useful for understanding template adoption and effectiveness.
     */
    templateVsDynamicAgents: {
        template: number;
        dynamic: number;
    };
} 