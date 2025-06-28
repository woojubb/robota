import { AgentInterface, AgentConfig, AgentTemplate } from '../interfaces/agent';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { validateAgentConfig } from '../utils/validation';
import { Logger, createLogger } from '../utils/logger';
import { AgentTemplates, TemplateApplicationResult } from './agent-templates';

/**
 * Configuration options for AgentFactory
 */
export interface AgentFactoryOptions {
    /** Default model to use if not specified in config */
    defaultModel?: string;
    /** Default provider to use if not specified in config */
    defaultProvider?: string;
    /** Maximum number of concurrent agents */
    maxConcurrentAgents?: number;
    /** Default system message for agents */
    defaultSystemMessage?: string;
    /** Enable strict configuration validation */
    strictValidation?: boolean;
}

/**
 * Agent creation statistics
 */
export interface AgentCreationStats {
    /** Total number of agents created */
    totalCreated: number;
    /** Number of currently active agents */
    activeCount: number;
    /** Number of agents created from templates */
    fromTemplates: number;
    /** Number of custom configured agents */
    customConfigured: number;
    /** Template vs custom creation ratio (fromTemplates / totalCreated) */
    templateUsageRatio: number;
}

/**
 * Agent lifecycle events
 */
export interface AgentLifecycleEvents {
    /** Called before agent creation */
    beforeCreate?: (config: AgentConfig) => Promise<void> | void;
    /** Called after successful agent creation */
    afterCreate?: (agent: AgentInterface, config: AgentConfig) => Promise<void> | void;
    /** Called when agent creation fails */
    onCreateError?: (error: Error, config: AgentConfig) => Promise<void> | void;
    /** Called when agent is destroyed */
    onDestroy?: (agentId: string) => Promise<void> | void;
}

/**
 * Agent Factory for creating and managing agents
 * Instance-based for isolated agent factory management
 */
export class AgentFactory {
    private agentTemplates: AgentTemplates;
    private initialized = false;
    private logger: Logger;
    private options: Required<AgentFactoryOptions>;
    private activeAgents: Map<string, AgentInterface>;
    private creationStats: AgentCreationStats;
    private lifecycleEvents: AgentLifecycleEvents;


    constructor(options: AgentFactoryOptions = {}, lifecycleEvents: AgentLifecycleEvents = {}) {
        this.agentTemplates = new AgentTemplates();
        this.logger = createLogger('AgentFactory');
        this.options = {
            defaultModel: options.defaultModel || 'gpt-4',
            defaultProvider: options.defaultProvider || 'openai',
            maxConcurrentAgents: options.maxConcurrentAgents || 100,
            defaultSystemMessage: options.defaultSystemMessage || 'You are a helpful AI assistant.',
            strictValidation: options.strictValidation ?? true,
        };
        this.activeAgents = new Map();
        this.creationStats = {
            totalCreated: 0,
            activeCount: 0,
            fromTemplates: 0,
            customConfigured: 0,
            templateUsageRatio: 0,
        };
        this.lifecycleEvents = lifecycleEvents;

        this.logger.debug('AgentFactory initialized', {
            maxConcurrentAgents: this.options.maxConcurrentAgents,
            strictValidation: this.options.strictValidation,
            hasDefaultModel: !!this.options.defaultModel,
            hasDefaultProvider: !!this.options.defaultProvider,
            hasLifecycleEvents: this.lifecycleEvents !== null
        });
    }

    /**
     * Initialize the factory
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.logger.debug('Initializing AgentFactory');
        this.initialized = true;
        this.logger.debug('AgentFactory initialization completed');
    }

    /**
     * Create a new agent instance
     */
    async createAgent(
        AgentClass: new (config: AgentConfig) => AgentInterface,
        config: Partial<AgentConfig>,
        fromTemplate: boolean = false
    ): Promise<AgentInterface> {
        try {
            // Check concurrent agent limit
            if (this.activeAgents.size >= this.options.maxConcurrentAgents) {
                throw new ConfigurationError(
                    `Maximum concurrent agents limit reached: ${this.options.maxConcurrentAgents}`
                );
            }

            // Apply default configuration
            const fullConfig = this.applyDefaults(config);

            // Validate configuration
            if (this.options.strictValidation) {
                const validation = validateAgentConfig(fullConfig);
                if (!validation.isValid) {
                    throw new ValidationError(`Invalid agent configuration: ${validation.errors.join(', ')}`);
                }
            }

            // Call before create lifecycle event
            if (this.lifecycleEvents.beforeCreate) {
                await this.lifecycleEvents.beforeCreate(fullConfig);
            }

            // Create agent instance
            const agent = new AgentClass(fullConfig);

            // Initialize agent if it has an initialize method
            if ('initialize' in agent && typeof agent.initialize === 'function') {
                await (agent as AgentInterface & { initialize(): Promise<void> }).initialize();
            }

            // Track agent
            const agentId = this.generateAgentId();
            this.activeAgents.set(agentId, agent);

            // Update statistics
            this.updateCreationStats(fromTemplate);

            // Call after create lifecycle event
            if (this.lifecycleEvents.afterCreate) {
                await this.lifecycleEvents.afterCreate(agent, fullConfig);
            }

            this.logger.info('Agent created successfully', {
                agentId,
                model: fullConfig.model,
                provider: fullConfig.provider,
            });

            return agent;
        } catch (error) {
            // Call error lifecycle event
            if (this.lifecycleEvents.onCreateError) {
                await this.lifecycleEvents.onCreateError(error as Error, config as AgentConfig);
            }

            this.logger.error('Failed to create agent', {
                error: error instanceof Error ? error.message : String(error),
                model: config.model,
                provider: config.provider,
                hasTools: !!config.tools?.length
            });
            throw error;
        }
    }

    /**
     * Create agent from template
     */
    async createFromTemplate(
        AgentClass: new (config: AgentConfig) => AgentInterface,
        templateId: string,
        overrides: Partial<AgentConfig> = {}
    ): Promise<AgentInterface> {
        const template = this.agentTemplates.getTemplate(templateId);
        if (!template) {
            throw new ConfigurationError(`Template not found: ${templateId}`);
        }

        // Apply template to configuration
        const templateResult = this.applyTemplate(template, overrides);

        if (templateResult.warnings.length > 0) {
            this.logger.warn('Template application warnings', {
                templateId,
                warnings: templateResult.warnings,
            });
        }

        // Create agent with template configuration
        const agent = await this.createAgent(AgentClass, templateResult.config, true);

        this.logger.info('Agent created from template', {
            templateId,
            modified: templateResult.modified,
            warnings: templateResult.warnings.length,
        });

        return agent;
    }

    /**
     * Register a template
     */
    registerTemplate(template: AgentTemplate): void {
        this.agentTemplates.registerTemplate(template);
    }

    /**
     * Unregister a template
     */
    unregisterTemplate(templateId: string): boolean {
        return this.agentTemplates.unregisterTemplate(templateId);
    }

    /**
     * Get all templates
     */
    getTemplates(): AgentTemplate[] {
        return this.agentTemplates.getTemplates();
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId: string): AgentTemplate | undefined {
        return this.agentTemplates.getTemplate(templateId);
    }

    /**
     * Find templates by criteria
     */
    findTemplates(criteria: {
        category?: string;
        tags?: string[];
        provider?: string;
        model?: string;
    }): AgentTemplate[] {
        return this.agentTemplates.findTemplates(criteria);
    }

    /**
     * Apply template to configuration
     */
    applyTemplate(template: AgentTemplate, overrides: Partial<AgentConfig> = {}): TemplateApplicationResult {
        return this.agentTemplates.applyTemplate(template, overrides);
    }

    /**
     * Destroy an agent
     */
    async destroyAgent(agentId: string): Promise<boolean> {
        const agent = this.activeAgents.get(agentId);
        if (!agent) {
            return false;
        }

        try {
            // Cleanup agent if it has a cleanup method
            if ('cleanup' in agent && typeof agent.cleanup === 'function') {
                await (agent as AgentInterface & { cleanup(): Promise<void> }).cleanup();
            }

            // Remove from tracking
            this.activeAgents.delete(agentId);
            this.creationStats.activeCount--;

            // Call destroy lifecycle event
            if (this.lifecycleEvents.onDestroy) {
                await this.lifecycleEvents.onDestroy(agentId);
            }

            this.logger.info('Agent destroyed', { agentId });
            return true;
        } catch (error) {
            this.logger.error('Error destroying agent', {
                agentId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get creation statistics
     */
    getCreationStats(): AgentCreationStats {
        return { ...this.creationStats };
    }

    /**
     * Get all active agents
     */
    getActiveAgents(): Map<string, AgentInterface> {
        return new Map(this.activeAgents);
    }

    /**
     * Validate agent configuration
     */
    validateConfiguration(config: Partial<AgentConfig>): { isValid: boolean; errors: string[] } {
        return validateAgentConfig(config);
    }

    /**
     * Apply default configuration values
     */
    private applyDefaults(config: Partial<AgentConfig>): AgentConfig {
        return {
            id: config.id || this.generateAgentId(),
            name: config.name || 'Unnamed Agent',
            model: config.model || this.options.defaultModel,
            provider: config.provider || this.options.defaultProvider,
            systemMessage: config.systemMessage || this.options.defaultSystemMessage,
            temperature: config.temperature ?? 0.7,
            ...(config.maxTokens !== undefined && { maxTokens: config.maxTokens }),
            tools: config.tools || [],
            metadata: config.metadata || {},
            ...config,
        };
    }

    /**
     * Generate unique agent ID
     */
    private generateAgentId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `agent_${timestamp}_${random}`;
    }

    /**
     * Update creation statistics
     */
    private updateCreationStats(fromTemplate: boolean): void {
        this.creationStats.totalCreated++;
        this.creationStats.activeCount++;

        if (fromTemplate) {
            this.creationStats.fromTemplates++;
        } else {
            this.creationStats.customConfigured++;
        }

        // Update template usage ratio
        this.creationStats.templateUsageRatio = this.creationStats.totalCreated > 0
            ? this.creationStats.fromTemplates / this.creationStats.totalCreated
            : 0;
    }
} 