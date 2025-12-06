// Team package now provides assignTask tool collection only. All agents remain neutral and identical.

export interface AssignTaskParams {
    /** 
     * Clear, specific description of the job to be completed.
     */
    jobDescription: string;
    /**
     * Optional template identifier to use when creating the agent.
     */
    templateId?: string;
    /**
     * Optional override for provider/model/settings.
     */
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** 
     * Additional context or requirements for the job.
     */
    context?: string;
    /** 
     * Optional tool requirements for the assigned agent.
     */
    requiredTools?: string[];
    /** 
     * Whether further delegation is allowed.
     */
    allowFurtherDelegation?: boolean;
}

/**
 * Result from an assigned task with execution metadata.
 */
export interface AssignTaskResult {
    /** 
     * The completed task result content from the assigned agent.
     */
    result: string;

    /** 
     * Unique identifier of the agent that performed the task.
     */
    agentId: string;

    /** 
     * Execution metadata for the task.
     */
    metadata: {
        /** 
         * Time taken to complete the task in milliseconds.
         */
        executionTime: number;

        /** 
         * Estimated number of tokens consumed during task execution.
         */
        tokensUsed?: number;

        /** 
         * List of any errors encountered during task execution.
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

