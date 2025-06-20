import { Robota } from '@robota-sdk/core';
import type { RobotaOptions } from '@robota-sdk/core';
import type { TaskAgentConfig, AgentConfig } from './types';

/**
 * Factory for creating task-specific Robota agents
 * Generates appropriate system prompts and tool configurations based on task requirements
 */
export class AgentFactory {
    private baseRobotaOptions: RobotaOptions;
    private debug: boolean;

    /**
     * Create an AgentFactory instance
     * 
     * @param baseRobotaOptions - Base configuration options for all agents
     * @param debug - Whether to enable debug logging
     */
    constructor(baseRobotaOptions: RobotaOptions, debug = false) {
        this.baseRobotaOptions = baseRobotaOptions;
        this.debug = debug;
    }

    /**
     * Create a Robota agent for a specific task
     */
    async createRobotaForTask(config: TaskAgentConfig): Promise<TaskAgent> {
        const systemPrompt = this.generateSystemPrompt(config.taskDescription, config.requiredTools);

        const robotaOptions: RobotaOptions = {
            ...this.baseRobotaOptions,
            systemPrompt,
            maxTokens: config.agentConfig?.maxTokens || this.baseRobotaOptions.maxTokens,
            temperature: config.agentConfig?.temperature || this.baseRobotaOptions.temperature
        };

        const robota = new Robota(robotaOptions);

        const agentConfig: AgentConfig = {
            provider: this.baseRobotaOptions.currentProvider || 'unknown',
            model: this.baseRobotaOptions.currentModel || 'unknown',
            systemPrompt,
            maxTokens: this.baseRobotaOptions.maxTokens,
            temperature: this.baseRobotaOptions.temperature,
            ...config.agentConfig
        };

        return new RobotaTaskAgent(robota, agentConfig, config.requiredTools);
    }

    /**
     * Generate system prompt for task-specific agent
     */
    private generateSystemPrompt(taskDescription: string, requiredTools: string[]): string {
        // Handle case where requiredTools might be a string instead of array
        const toolsArray = Array.isArray(requiredTools) ? requiredTools :
            (typeof requiredTools === 'string' ? [requiredTools] : []);

        const toolsDescription = toolsArray.length > 0
            ? `You have access to the following tools: ${toolsArray.join(', ')}.`
            : 'You have access to standard reasoning capabilities.';

        return `You are a specialized AI agent created to perform a specific task.

TASK ASSIGNMENT: ${taskDescription}

CAPABILITIES:
${toolsDescription}

CORE INSTRUCTIONS:
1. Focus solely on completing the assigned task with expertise and thoroughness
2. Use available tools effectively to gather information and perform actions
3. Provide clear, detailed, and professional results
4. If you need to delegate sub-tasks, use the delegateWork tool appropriately
5. Be thorough but concise in your responses
6. Apply domain expertise relevant to your task
7. Ensure all aspects of the task are addressed completely

You are an expert in your assigned domain. Complete the task to the best of your abilities with professional quality output.`;
    }
}

/**
 * Interface for task-specific agents
 */
export interface TaskAgent {
    /** Unique identifier for the agent */
    id: string;
    /** Configuration used for this agent */
    config: AgentConfig;
    /** Tools available to this agent */
    tools: string[];
    /** Execute a prompt and return the result */
    run(prompt: string): Promise<string>;
    /** Close/cleanup the agent */
    close(): void;
}

/**
 * Wrapper class to make Robota instance compatible with TaskAgent interface
 */
class RobotaTaskAgent implements TaskAgent {
    public readonly id: string;
    public readonly config: AgentConfig;
    public readonly tools: string[];
    private robota: Robota;

    constructor(robota: Robota, config: AgentConfig, tools: string[]) {
        this.id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.config = config;
        this.tools = tools;
        this.robota = robota;
    }

    /**
     * Execute a prompt and return the result
     */
    async run(prompt: string): Promise<string> {
        const response = await this.robota.run(prompt);
        return response;
    }

    /**
     * Close and cleanup the agent
     */
    close(): void {
        // Cleanup resources if needed
        // Robota instances don't typically need explicit cleanup, but this provides the interface
    }
} 