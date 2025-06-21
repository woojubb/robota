import { AgentInterface, AgentConfig, AgentTemplate } from '../interfaces/agent';
import { AIProvider } from '../interfaces/provider';
import { BaseManager } from '../abstracts/base-manager';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { validateAgentConfig } from '../utils/validation';
import { Logger } from '../utils/logger';

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
    /** Average creation time in milliseconds */
    averageCreationTime: number;
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
 * Template application result
 */
export interface TemplateApplicationResult {
    /** Applied configuration */
    config: AgentConfig;
    /** Template that was applied */
    template: AgentTemplate;
    /** Any warnings during application */
    warnings: string[];
    /** Whether config was modified during application */
    modified: boolean;
}

/**
 * Factory for creating and managing agent instances
 * Handles agent creation, configuration management, template application, and lifecycle
 */
export class AgentFactory extends BaseManager {
    private logger: Logger;
    private options: Required<AgentFactoryOptions>;
    private templates: Map<string, AgentTemplate>;
    private activeAgents: Map<string, AgentInterface>;
    private creationStats: AgentCreationStats;
    private lifecycleEvents: AgentLifecycleEvents;
    private creationTimes: number[];

    constructor(
        options: AgentFactoryOptions = {},
        lifecycleEvents: AgentLifecycleEvents = {}
    ) {
        super();
        this.logger = new Logger('AgentFactory');
        this.options = {
            defaultModel: options.defaultModel || 'gpt-4',
            defaultProvider: options.defaultProvider || 'openai',
            maxConcurrentAgents: options.maxConcurrentAgents || 100,
            defaultSystemMessage: options.defaultSystemMessage || 'You are a helpful AI assistant.',
            strictValidation: options.strictValidation ?? true,
        };
        this.templates = new Map();
        this.activeAgents = new Map();
        this.creationStats = {
            totalCreated: 0,
            activeCount: 0,
            fromTemplates: 0,
            customConfigured: 0,
            averageCreationTime: 0,
        };
        this.lifecycleEvents = lifecycleEvents;
        this.creationTimes = [];

        this.logger.info('AgentFactory initialized', {
            options: this.options,
            hasLifecycleEvents: Object.keys(lifecycleEvents).length > 0,
        });
    }

    /**
     * Create a new agent instance
     */
    async createAgent(
        AgentClass: new (config: AgentConfig) => AgentInterface,
        config: Partial<AgentConfig>
    ): Promise<AgentInterface> {
        const startTime = Date.now();

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
                await (agent as any).initialize();
            }

            // Track agent
            const agentId = this.generateAgentId();
            this.activeAgents.set(agentId, agent);

            // Update statistics
            const creationTime = Date.now() - startTime;
            this.updateCreationStats(creationTime, false);

            // Call after create lifecycle event
            if (this.lifecycleEvents.afterCreate) {
                await this.lifecycleEvents.afterCreate(agent, fullConfig);
            }

            this.logger.info('Agent created successfully', {
                agentId,
                model: fullConfig.model,
                provider: fullConfig.provider,
                creationTime,
            });

            return agent;
        } catch (error) {
            // Call error lifecycle event
            if (this.lifecycleEvents.onCreateError) {
                await this.lifecycleEvents.onCreateError(error as Error, config as AgentConfig);
            }

            this.logger.error('Failed to create agent', { error, config });
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
        const template = this.templates.get(templateId);
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
        const agent = await this.createAgent(AgentClass, templateResult.config);

        // Update template usage statistics
        this.creationStats.fromTemplates++;

        this.logger.info('Agent created from template', {
            templateId,
            modified: templateResult.modified,
            warnings: templateResult.warnings.length,
        });

        return agent;
    }

    /**
     * Register an agent template
     */
    registerTemplate(template: AgentTemplate): void {
        // Validate template
        if (!template.id || !template.name) {
            throw new ValidationError('Template must have id and name');
        }

        if (!template.config) {
            throw new ValidationError('Template must have config');
        }

        // Validate template configuration
        if (this.options.strictValidation) {
            const validation = validateAgentConfig(template.config);
            if (!validation.isValid) {
                throw new ValidationError(`Invalid template configuration: ${validation.errors.join(', ')}`);
            }
        }

        this.templates.set(template.id, template);
        this.logger.info('Template registered', { templateId: template.id, name: template.name });
    }

    /**
     * Remove an agent template
     */
    unregisterTemplate(templateId: string): boolean {
        const removed = this.templates.delete(templateId);
        if (removed) {
            this.logger.info('Template unregistered', { templateId });
        }
        return removed;
    }

    /**
     * Get all registered templates
     */
    getTemplates(): AgentTemplate[] {
        return Array.from(this.templates.values());
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId: string): AgentTemplate | undefined {
        return this.templates.get(templateId);
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
        return this.getTemplates().filter(template => {
            if (criteria.category && template.category !== criteria.category) {
                return false;
            }
            if (criteria.tags && !criteria.tags.every(tag => template.tags?.includes(tag))) {
                return false;
            }
            if (criteria.provider && template.config.provider !== criteria.provider) {
                return false;
            }
            if (criteria.model && template.config.model !== criteria.model) {
                return false;
            }
            return true;
        });
    }

    /**
     * Apply template to configuration
     */
    applyTemplate(template: AgentTemplate, overrides: Partial<AgentConfig> = {}): TemplateApplicationResult {
        const warnings: string[] = [];
        let modified = false;

        // Start with template configuration
        const config: AgentConfig = { ...template.config };

        // Apply overrides
        for (const [key, value] of Object.entries(overrides)) {
            if (value !== undefined) {
                (config as any)[key] = value;
                modified = true;
            }
        }

        // Check for conflicts
        if (overrides.provider && overrides.provider !== template.config.provider) {
            warnings.push(`Provider override (${overrides.provider}) differs from template default (${template.config.provider})`);
        }

        if (overrides.model && overrides.model !== template.config.model) {
            warnings.push(`Model override (${overrides.model}) differs from template default (${template.config.model})`);
        }

        return {
            config,
            template,
            warnings,
            modified,
        };
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
                await (agent as any).cleanup();
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
            this.logger.error('Error destroying agent', { agentId, error });
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
            maxTokens: config.maxTokens,
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
    private updateCreationStats(creationTime: number, fromTemplate: boolean): void {
        this.creationStats.totalCreated++;
        this.creationStats.activeCount++;

        if (fromTemplate) {
            this.creationStats.fromTemplates++;
        } else {
            this.creationStats.customConfigured++;
        }

        // Update average creation time
        this.creationTimes.push(creationTime);

        // Keep only last 100 creation times for moving average
        if (this.creationTimes.length > 100) {
            this.creationTimes.shift();
        }

        this.creationStats.averageCreationTime =
            this.creationTimes.reduce((sum, time) => sum + time, 0) / this.creationTimes.length;
    }

    /**
 * Initialize the factory (BaseManager implementation)
 */
    protected async doInitialize(): Promise<void> {
        this.logger.info('Initializing AgentFactory');
        // Load default templates if needed
        // This could be extended to load from files or remote sources
    }

    /**
     * Cleanup factory resources (BaseManager implementation)
     */
    protected async doDispose(): Promise<void> {
        this.logger.info('Cleaning up AgentFactory');

        // Destroy all active agents
        const agentIds = Array.from(this.activeAgents.keys());
        await Promise.all(agentIds.map(id => this.destroyAgent(id)));

        // Clear templates
        this.templates.clear();

        // Reset statistics
        this.creationStats = {
            totalCreated: 0,
            activeCount: 0,
            fromTemplates: 0,
            customConfigured: 0,
            averageCreationTime: 0,
        };

        this.creationTimes = [];
    }
} 