import { IAgent, IAgentConfig, IAgentTemplate } from '../interfaces/agent';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { validateAgentConfig } from '../utils/validation';
import { createLogger, type ILogger } from '../utils/logger';
import { AgentTemplates, type ITemplateApplicationResult } from './agent-templates';
import {
  IAgentFactoryOptions,
  IAgentCreationStats,
  IAgentLifecycleEvents,
  TResolvedFactoryOptions,
  resolveFactoryOptions,
  applyAgentDefaults,
  generateAgentId,
  updateCreationStats,
} from './agent-factory-helpers';

export type {
  IAgentFactoryOptions,
  IAgentCreationStats,
  IAgentLifecycleEvents,
} from './agent-factory-helpers';

/**
 * Agent Factory for creating and managing agents
 * Instance-based for isolated agent factory management
 */
export class AgentFactory {
  private agentTemplates: AgentTemplates;
  private initialized = false;
  private logger: ILogger;
  private options: TResolvedFactoryOptions;
  private activeAgents: Map<string, IAgent<IAgentConfig>>;
  private creationStats: IAgentCreationStats;
  private lifecycleEvents: IAgentLifecycleEvents;

  constructor(options: IAgentFactoryOptions = {}, lifecycleEvents: IAgentLifecycleEvents = {}) {
    this.agentTemplates = new AgentTemplates();
    this.logger = createLogger('AgentFactory');
    this.options = resolveFactoryOptions(options);
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
      hasLifecycleEvents: this.lifecycleEvents !== null,
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
    AgentClass: new (config: IAgentConfig) => IAgent<IAgentConfig>,
    config: Partial<IAgentConfig>,
    fromTemplate: boolean = false,
  ): Promise<IAgent<IAgentConfig>> {
    // Apply defaults before try so fullConfig is available in catch
    let fullConfig: IAgentConfig | undefined;
    try {
      // Check concurrent agent limit
      if (this.activeAgents.size >= this.options.maxConcurrentAgents) {
        throw new ConfigurationError(
          `Maximum concurrent agents limit reached: ${this.options.maxConcurrentAgents}`,
        );
      }

      // Apply default configuration
      fullConfig = applyAgentDefaults(config, this.options);

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
      interface IInitializableAgent {
        initialize(): Promise<void>;
      }
      const maybeInitializable = agent as Partial<IInitializableAgent>;
      if (typeof maybeInitializable.initialize === 'function') {
        await maybeInitializable.initialize();
      }

      // Track agent
      const agentId = generateAgentId();
      this.activeAgents.set(agentId, agent);

      // Update statistics
      updateCreationStats(this.creationStats, fromTemplate);

      // Call after create lifecycle event
      if (this.lifecycleEvents.afterCreate) {
        await this.lifecycleEvents.afterCreate(agent, fullConfig);
      }

      this.logger.info('Agent created successfully', {
        agentId,
        model: fullConfig.defaultModel.model,
        provider: fullConfig.defaultModel.provider,
      });

      return agent;
    } catch (error) {
      // Call error lifecycle event
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (this.lifecycleEvents.onCreateError && fullConfig) {
        await this.lifecycleEvents.onCreateError(normalizedError, fullConfig);
      }

      this.logger.error('Failed to create agent', {
        error: normalizedError.message,
        model: config.defaultModel?.model,
        provider: config.defaultModel?.provider,
        hasTools: !!config.tools?.length,
      });
      throw normalizedError;
    }
  }

  /**
   * Create agent from template
   */
  async createFromTemplate(
    AgentClass: new (config: IAgentConfig) => IAgent<IAgentConfig>,
    templateId: string,
    overrides: Partial<IAgentConfig> = {},
  ): Promise<IAgent<IAgentConfig>> {
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
  registerTemplate(template: IAgentTemplate): void {
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
  getTemplates(): IAgentTemplate[] {
    return this.agentTemplates.getTemplates();
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId: string): IAgentTemplate | undefined {
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
  }): IAgentTemplate[] {
    return this.agentTemplates.findTemplates(criteria);
  }

  /**
   * Apply template to configuration
   */
  applyTemplate(
    template: IAgentTemplate,
    overrides: Partial<IAgentConfig> = {},
  ): ITemplateApplicationResult {
    return this.agentTemplates.applyTemplate(
      template,
      overrides as import('../interfaces/types').TConfigData,
    );
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
      interface ICleanableAgent {
        cleanup(): Promise<void>;
      }
      const maybeCleanable = agent as Partial<ICleanableAgent>;
      if (typeof maybeCleanable.cleanup === 'function') {
        await maybeCleanable.cleanup();
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
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get creation statistics
   */
  getCreationStats(): IAgentCreationStats {
    return { ...this.creationStats };
  }

  /**
   * Get all active agents
   */
  getActiveAgents(): Map<string, IAgent<IAgentConfig>> {
    return new Map(this.activeAgents);
  }

  /**
   * Validate agent configuration
   */
  validateConfiguration(config: Partial<IAgentConfig>): { isValid: boolean; errors: string[] } {
    return validateAgentConfig(config);
  }
}
