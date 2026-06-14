import { ConfigurationError } from '../utils/errors';

import type { IAgent, IAgentConfig } from '../interfaces/agent';

const MAX_CONCURRENT_AGENTS = 100;
const DEFAULT_TEMPERATURE = 0.7;
const ID_RADIX = 36;
const AGENT_ID_SUBSTR_END = 8;

/**
 * Configuration options for AgentFactory
 */
export interface IAgentFactoryOptions {
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
export interface IAgentCreationStats {
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
export interface IAgentLifecycleEvents {
  /** Called before agent creation */
  beforeCreate?: (config: IAgentConfig) => Promise<void> | void;
  /** Called after successful agent creation */
  afterCreate?: (agent: IAgent<IAgentConfig>, config: IAgentConfig) => Promise<void> | void;
  /** Called when agent creation fails */
  onCreateError?: (error: Error, config: IAgentConfig) => Promise<void> | void;
  /** Called when agent is destroyed */
  onDestroy?: (agentId: string) => Promise<void> | void;
}

/**
 * Resolved factory options.
 * The infrastructure fields are always populated; `defaultModel`/`defaultProvider` stay exactly as
 * the caller supplied them — no vendor model/provider default is injected at this foundation layer.
 */
export type TResolvedFactoryOptions = Required<
  Pick<IAgentFactoryOptions, 'maxConcurrentAgents' | 'defaultSystemMessage' | 'strictValidation'>
> &
  Pick<IAgentFactoryOptions, 'defaultModel' | 'defaultProvider'>;

/**
 * Build resolved factory options from partial user input.
 *
 * Only vendor-neutral infrastructure defaults are applied here. A model/provider is never
 * defaulted to a hardcoded vendor name; resolution happens later in {@link applyAgentDefaults}
 * from the caller's config, and an unresolvable model/provider fails loudly rather than silently
 * substituting one.
 */
export function resolveFactoryOptions(options: IAgentFactoryOptions): TResolvedFactoryOptions {
  return {
    maxConcurrentAgents: options.maxConcurrentAgents || MAX_CONCURRENT_AGENTS,
    defaultSystemMessage: options.defaultSystemMessage || 'You are a helpful AI assistant.',
    strictValidation: options.strictValidation ?? true,
    ...(options.defaultModel !== undefined && { defaultModel: options.defaultModel }),
    ...(options.defaultProvider !== undefined && { defaultProvider: options.defaultProvider }),
  };
}

/**
 * Apply default configuration values to a partial agent config.
 */
export function applyAgentDefaults(
  config: Partial<IAgentConfig>,
  options: TResolvedFactoryOptions,
): IAgentConfig {
  if (!config.aiProviders || config.aiProviders.length === 0) {
    throw new ConfigurationError('At least one AI provider must be specified in aiProviders array');
  }

  const baseModel = config.defaultModel;

  // Resolve the model without falling back to a hardcoded vendor model. A missing model is a
  // configuration error to surface, not something to paper over.
  const resolvedModel = baseModel?.model ?? options.defaultModel;
  if (!resolvedModel) {
    throw new ConfigurationError(
      'No model specified: set config.defaultModel.model or the AgentFactory defaultModel option',
    );
  }

  // Provider resolves from the explicit config, then the first configured provider, then the
  // factory option — never a hardcoded vendor name.
  const resolvedProvider =
    baseModel?.provider ?? config.aiProviders[0]?.name ?? options.defaultProvider;
  if (!resolvedProvider) {
    throw new ConfigurationError(
      'No provider specified: set config.defaultModel.provider, an aiProviders entry, or the AgentFactory defaultProvider option',
    );
  }

  return {
    id: config.id || generateAgentId(),
    name: config.name || 'Unnamed Agent',
    aiProviders: config.aiProviders,
    defaultModel: {
      provider: resolvedProvider,
      model: resolvedModel,
      temperature: baseModel?.temperature ?? DEFAULT_TEMPERATURE,
      ...(baseModel?.maxTokens !== undefined && { maxTokens: baseModel.maxTokens }),
      ...(baseModel?.topP !== undefined && { topP: baseModel.topP }),
      systemMessage: baseModel?.systemMessage || options.defaultSystemMessage,
    },
    tools: config.tools || [],
    plugins: config.plugins || [],
    metadata: config.metadata || {},
    ...(config.logging && { logging: config.logging }),
    ...(config.conversationId && { conversationId: config.conversationId }),
    ...config,
  };
}

/**
 * Generate a unique agent ID.
 */
export function generateAgentId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(ID_RADIX).substring(2, AGENT_ID_SUBSTR_END);
  return `agent_${timestamp}_${random}`;
}

/**
 * Update creation statistics in-place and return the updated object.
 */
export function updateCreationStats(
  stats: IAgentCreationStats,
  fromTemplate: boolean,
): IAgentCreationStats {
  stats.totalCreated++;
  stats.activeCount++;

  if (fromTemplate) {
    stats.fromTemplates++;
  } else {
    stats.customConfigured++;
  }

  stats.templateUsageRatio = stats.totalCreated > 0 ? stats.fromTemplates / stats.totalCreated : 0;

  return stats;
}

// Re-export constant so consumers can use it if needed
