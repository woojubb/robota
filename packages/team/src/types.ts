import type { RobotaConfig, AgentTemplate, AIProvider } from '@robota-sdk/agents';

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
     * Custom agent templates to register in addition to built-in templates.
     * Built-in templates are automatically available.
     */
    customTemplates?: AgentTemplate[];

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
    baseRobotaOptions: RobotaConfig;
    maxMembers?: number;
    debug?: boolean;
    customTemplates?: AgentTemplate[];
    leaderTemplate?: string;
    logger?: any;
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

    /** 
     * Whether the assigned agent should be able to delegate parts of the task to other specialists if needed.
     * Set to true ONLY for extremely complex tasks requiring multiple different areas of expertise.
     * Set to false when you want the agent to handle the task directly without further delegation.
     * Default: false
     */
    allowFurtherDelegation?: boolean;
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

        /** 
         * Number of executions tracked by the agent's analytics plugin.
         */
        agentExecutions?: number;

        /** 
         * Average duration of executions within the agent.
         */
        agentAverageDuration?: number;

        /** 
         * Success rate of executions within the agent (0-1).
         */
        agentSuccessRate?: number;
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

