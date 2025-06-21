import { Robota } from '@robota-sdk/agents';
import type { AgentConfig as BaseAgentConfig } from '@robota-sdk/agents';
import type { TaskAgentConfig, AgentConfig } from './types';

/**
 * Factory for creating task-specific Robota agents
 * 
 * @description
 * Simplified factory for creating task-specific agents that work with the team system.
 */
export class AgentFactory {
    private baseConfig: BaseAgentConfig;
    private debug: boolean;

    /**
     * Create an AgentFactory instance
     */
    constructor(baseConfig: BaseAgentConfig, debug = false) {
        this.baseConfig = baseConfig;
        this.debug = debug;
    }

    /**
     * Create a TaskAgent for a specific task
     */
    async createRobotaForTask(config: TaskAgentConfig): Promise<TaskAgent> {
        if (this.debug) {
            console.log(`Creating agent for task: ${config.taskDescription}`);
        }

        // Create task-specific system message
        const systemMessage = `You are a specialist agent. Your task: ${config.taskDescription}\n\nRequired tools: ${config.requiredTools.join(', ')}`;

        // Create Robota instance with task-specific configuration
        const robotaConfig: BaseAgentConfig = {
            ...this.baseConfig,
            systemMessage,
            ...config.agentConfig
        };

        const robota = new Robota(robotaConfig);

        // Create team-specific agent configuration
        const agentConfig: AgentConfig = {
            provider: robotaConfig.provider,
            model: robotaConfig.model,
            systemPrompt: systemMessage,
            maxTokens: robotaConfig.maxTokens,
            temperature: robotaConfig.temperature
        };

        return new RobotaTaskAgent(robota, agentConfig, config.requiredTools);
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
    /** Get the underlying Robota instance for accessing conversation history */
    getRobotaInstance(): Robota;
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
        this.robota.destroy().catch(console.error);
    }

    /**
     * Get the underlying Robota instance for accessing conversation history
     */
    getRobotaInstance(): Robota {
        return this.robota;
    }
} 