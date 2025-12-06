// Team legacy types removed; team package now provides assignTask tool collection only.

/**
 * Result from an assigned task with execution metadata (internal use only)
 * 
 * @description
 * Contains the output from a specialized agent along with comprehensive
 * metadata about the task execution including performance metrics,
 * resource usage, and any errors encountered.
 * 
 * @internal This interface is for internal use only.
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

