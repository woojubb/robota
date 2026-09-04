import {
  applyAgentDefaults,
  resolveFactoryOptions,
  updateCreationStats,
  type IAgentFactoryOptions,
  type IAgentCreationStats,
  type IAgentLifecycleEvents,
  type TResolvedFactoryOptions,
} from './agent-factory-helpers';
import { AgentTemplates, type ITemplateApplicationResult } from './agent-templates';
import { lifecycleOf, runRegistryTransaction } from './registry-transaction';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { createLogger, type ILogger } from '../utils/logger';
import { validateAgentConfig } from '../utils/validation';

import type { IAgent, IAgentConfig, IAgentTemplate } from '../interfaces/agent';
import type { TConfigData } from '../interfaces/types';

export type {
  IAgentFactoryOptions,
  IAgentCreationStats,
  IAgentLifecycleEvents,
} from './agent-factory-helpers';

const MAX_ID_COLLISION_RETRIES = 16;

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
  /**
   * ARCH-055 admission: ids reserved by a `createAgent` that has not yet committed. Pending plus
   * active count toward `maxConcurrentAgents`, so concurrent creates cannot exceed the limit, and a
   * reserved id cannot be handed to a second create while the first is still initializing.
   */
  private readonly pendingAgents = new Set<string>();
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
   * Create a new agent instance.
   *
   * ARCH-055 (#2159): one transaction. Admission — the limit check and a collision-safe id with a
   * pending slot — happens BEFORE the first `await`, so concurrent creates cannot overshoot
   * `maxConcurrentAgents` or overwrite each other. Then `beforeCreate` → construct → `initialize` →
   * commit (pending → active, statistics) → `afterCreate`, each with its reverse step: a failure
   * anywhere rolls back every completed step in reverse (an initialized agent is `cleanup`ed, a
   * committed one is unregistered and its statistics reversed), releases the slot, and rethrows the
   * PRIMARY error with any rollback errors attached.
   */
  async createAgent(
    AgentClass: new (config: IAgentConfig) => IAgent<IAgentConfig>,
    config: Partial<IAgentConfig>,
    fromTemplate: boolean = false,
  ): Promise<IAgent<IAgentConfig>> {
    // Apply defaults before try so fullConfig is available in catch
    let fullConfig: IAgentConfig | undefined;
    const agentId = this.admit();
    try {
      // Apply default configuration
      fullConfig = applyAgentDefaults(config, this.options);
      const resolvedConfig = fullConfig;

      // Validate configuration
      if (this.options.strictValidation) {
        const validation = validateAgentConfig(fullConfig);
        if (!validation.isValid) {
          throw new ValidationError(`Invalid agent configuration: ${validation.errors.join(', ')}`);
        }
      }

      let agent: IAgent<IAgentConfig> | undefined;
      await runRegistryTransaction([
        {
          name: 'beforeCreate',
          run: () => this.lifecycleEvents.beforeCreate?.(resolvedConfig),
        },
        {
          name: 'construct',
          run: () => {
            agent = new AgentClass(resolvedConfig);
          },
        },
        {
          name: 'initialize',
          run: () => (agent ? lifecycleOf(agent)?.initialize?.() : undefined),
          undo: () => (agent ? lifecycleOf(agent)?.cleanup?.() : undefined),
        },
        {
          name: 'commit',
          run: () => {
            if (!agent) throw new ConfigurationError('Agent was not constructed');
            this.activeAgents.set(agentId, agent);
            updateCreationStats(this.creationStats, fromTemplate);
          },
          undo: () => {
            this.activeAgents.delete(agentId);
            this.creationStats.activeCount--;
            this.creationStats.totalCreated--;
            if (fromTemplate) this.creationStats.fromTemplates--;
            else this.creationStats.customConfigured--;
          },
        },
        {
          name: 'afterCreate',
          run: () =>
            agent ? this.lifecycleEvents.afterCreate?.(agent, resolvedConfig) : undefined,
        },
      ]);
      this.pendingAgents.delete(agentId);
      if (!agent) throw new ConfigurationError('Agent was not constructed');

      this.logger.info('Agent created successfully', {
        agentId,
        model: fullConfig.defaultModel.model,
        provider: fullConfig.defaultModel.provider,
      });

      return agent;
    } catch (error) {
      this.pendingAgents.delete(agentId);
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
   * ARCH-055 admission: reserve a collision-safe id and a pending slot synchronously. Pending and
   * active instances both count toward the limit.
   */
  private admit(): string {
    if (this.activeAgents.size + this.pendingAgents.size >= this.options.maxConcurrentAgents) {
      throw new ConfigurationError(
        `Maximum concurrent agents limit reached: ${this.options.maxConcurrentAgents}`,
      );
    }
    let agentId = this.options.idFactory();
    let attempts = 0;
    while (this.activeAgents.has(agentId) || this.pendingAgents.has(agentId)) {
      attempts += 1;
      if (attempts > MAX_ID_COLLISION_RETRIES) {
        throw new ConfigurationError(
          'Agent id factory keeps returning ids that are already in use',
        );
      }
      agentId = this.options.idFactory();
    }
    this.pendingAgents.add(agentId);
    return agentId;
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
    return this.agentTemplates.applyTemplate(template, overrides as TConfigData);
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
      // ARCH-055: the declared lifecycle, through the one type guard — not per-site duck typing.
      await lifecycleOf(agent)?.cleanup?.();

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
