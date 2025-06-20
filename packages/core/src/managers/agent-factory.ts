import { Robota } from '../robota';
import type { RobotaOptions } from '../robota';
import type { AgentTemplate, AgentConfig, AgentCreationConfig } from '../types';
import { AgentTemplateManager } from './agent-template-manager';



/**
 * Factory for creating Robota agents with template support
 * 
 * @description
 * Provides centralized agent creation functionality with support for both
 * template-based and dynamic agent generation. Handles provider selection,
 * system prompt generation, and configuration management.
 * 
 * @example
 * ```typescript
 * const factory = new AgentFactory(baseOptions);
 * 
 * // Create agent from template
 * const summarizerAgent = await factory.createFromTemplate('summarizer', {
 *   taskDescription: 'Summarize this research paper'
 * });
 * 
 * // Create dynamic agent
 * const customAgent = await factory.createAgent({
 *   taskDescription: 'Analyze market trends',
 *   requiredTools: ['web-search', 'data-analysis']
 * });
 * ```
 */
export class AgentFactory {
    private baseRobotaOptions: RobotaOptions;
    private templateManager: AgentTemplateManager;
    private debug: boolean;

    /**
     * Create an AgentFactory instance
     * 
     * @param baseRobotaOptions - Base configuration options for all agents
     * @param templateManager - Optional template manager (creates new one if not provided)
     * @param debug - Whether to enable debug logging
     */
    constructor(
        baseRobotaOptions: RobotaOptions,
        templateManager?: AgentTemplateManager,
        debug = false
    ) {
        this.baseRobotaOptions = baseRobotaOptions;
        this.templateManager = templateManager || new AgentTemplateManager();
        this.debug = debug;
    }

    /**
     * Create a Robota agent from a template
     * 
     * @param templateName - Name of the template to use
     * @param config - Additional configuration and overrides
     * @returns Configured Robota instance
     */
    async createFromTemplate(
        templateName: string,
        config: Partial<AgentCreationConfig> = {}
    ): Promise<Robota> {
        const template = this.templateManager.getTemplate(templateName);
        if (!template) {
            throw new Error(`Template not found: ${templateName}`);
        }

        if (this.debug) {
            console.log(`[AgentFactory] Creating agent from template: ${templateName}`);
        }

        // Generate system prompt using template
        const systemPrompt = this.generateSystemPromptFromTemplate(
            template,
            config.taskDescription,
            config.requiredTools
        );

        // Create agent configuration
        const agentConfig: AgentConfig = {
            provider: template.llm_provider,
            model: template.model,
            systemPrompt,
            maxTokens: template.maxTokens || config.agentConfig?.maxTokens || this.baseRobotaOptions.maxTokens,
            temperature: config.agentConfig?.temperature || template.temperature,
            ...config.agentConfig
        };

        return this.createRobotaFromConfig(agentConfig, config.requiredTools);
    }

    /**
     * Create a Robota agent dynamically without template
     * 
     * @param config - Agent creation configuration
     * @returns Configured Robota instance
     */
    async createAgent(config: AgentCreationConfig): Promise<Robota> {
        if (config.templateName) {
            return this.createFromTemplate(config.templateName, config);
        }

        if (!config.taskDescription) {
            throw new Error('Either templateName or taskDescription must be provided');
        }

        if (this.debug) {
            console.log(`[AgentFactory] Creating dynamic agent for task: ${config.taskDescription}`);
        }

        // Generate dynamic system prompt
        const systemPrompt = this.generateDynamicSystemPrompt(
            config.taskDescription,
            config.requiredTools
        );

        // Create agent configuration using base options
        const agentConfig: AgentConfig = {
            provider: this.baseRobotaOptions.currentProvider || 'unknown',
            model: this.baseRobotaOptions.currentModel || 'unknown',
            systemPrompt,
            maxTokens: config.agentConfig?.maxTokens || this.baseRobotaOptions.maxTokens,
            temperature: config.agentConfig?.temperature || this.baseRobotaOptions.temperature,
            ...config.agentConfig
        };

        return this.createRobotaFromConfig(agentConfig, config.requiredTools);
    }

    /**
     * Create agent for specific task (used by Team system)
     * 
     * @param config - Task configuration
     * @returns Robota agent instance
     */
    async createRobotaForTask(config: {
        taskDescription: string;
        requiredTools?: string[];
        agentTemplate?: string;
    }): Promise<Robota> {
        if (config.agentTemplate) {
            return this.createFromTemplate(config.agentTemplate, {
                taskDescription: config.taskDescription,
                requiredTools: config.requiredTools
            });
        } else {
            return this.createAgent({
                taskDescription: config.taskDescription,
                requiredTools: config.requiredTools
            });
        }
    }

    /**
     * Get the template manager instance
     */
    getTemplateManager(): AgentTemplateManager {
        return this.templateManager;
    }

    /**
     * Create Robota instance from agent configuration
     */
    private async createRobotaFromConfig(
        agentConfig: AgentConfig,
        requiredTools?: string[]
    ): Promise<Robota> {
        // Validate that the required provider is available
        if (!this.baseRobotaOptions.aiProviders ||
            !this.baseRobotaOptions.aiProviders[agentConfig.provider]) {
            throw new Error(`AI provider '${agentConfig.provider}' not found. Available providers: ${this.baseRobotaOptions.aiProviders ?
                Object.keys(this.baseRobotaOptions.aiProviders).join(', ') : 'none'
                }`);
        }

        // Use the provider and model from agent config if different from base
        const robotaOptions: RobotaOptions = {
            ...this.baseRobotaOptions,
            systemPrompt: agentConfig.systemPrompt,
            maxTokens: agentConfig.maxTokens,
            temperature: agentConfig.temperature
        };

        // Handle provider switching if needed
        if (agentConfig.provider !== this.baseRobotaOptions.currentProvider) {
            robotaOptions.currentProvider = agentConfig.provider as any;
        }

        if (agentConfig.model !== this.baseRobotaOptions.currentModel) {
            robotaOptions.currentModel = agentConfig.model;
        }

        return new Robota(robotaOptions);
    }

    /**
     * Generate system prompt from template
     */
    private generateSystemPromptFromTemplate(
        template: AgentTemplate,
        taskDescription?: string,
        requiredTools?: string[]
    ): string {
        let systemPrompt = template.system_prompt;

        // Add task-specific context if provided
        if (taskDescription) {
            systemPrompt += `\n\nSPECIFIC TASK: ${taskDescription}`;
        }

        // Add tools information if provided
        if (requiredTools && requiredTools.length > 0) {
            const toolsDescription = `You have access to the following tools: ${requiredTools.join(', ')}.`;
            systemPrompt += `\n\nAVAILABLE TOOLS: ${toolsDescription}`;
        }

        return systemPrompt;
    }

    /**
     * Generate dynamic system prompt for task-specific agents
     */
    private generateDynamicSystemPrompt(
        taskDescription: string,
        requiredTools?: string[]
    ): string {
        const toolsArray = requiredTools || [];
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
4. Be thorough but concise in your responses
5. Apply domain expertise relevant to your task
6. Ensure all aspects of the task are addressed completely

You are an expert in your assigned domain. Complete the task to the best of your abilities with professional quality output.`;
    }
} 