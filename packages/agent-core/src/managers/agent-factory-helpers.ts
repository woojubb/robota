import type { IAgent, IAgentConfig } from '../interfaces/agent';
import { ConfigurationError } from '../utils/errors';

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

/** Resolved (all-required) factory options */
export type TResolvedFactoryOptions = Required<IAgentFactoryOptions>;

/**
 * Build a Required<IAgentFactoryOptions> from partial user input.
 */
export function resolveFactoryOptions(options: IAgentFactoryOptions): TResolvedFactoryOptions {
  return {
    defaultModel: options.defaultModel || 'gpt-4',
    defaultProvider: options.defaultProvider || 'openai',
    maxConcurrentAgents: options.maxConcurrentAgents || MAX_CONCURRENT_AGENTS,
    defaultSystemMessage: options.defaultSystemMessage || 'You are a helpful AI assistant.',
    strictValidation: options.strictValidation ?? true,
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

  const defaultModel = config.defaultModel || {
    provider: config.aiProviders[0]?.name || options.defaultProvider,
    model: options.defaultModel,
    temperature: 0.7,
    systemMessage: options.defaultSystemMessage,
  };

  return {
    id: config.id || generateAgentId(),
    name: config.name || 'Unnamed Agent',
    aiProviders: config.aiProviders,
    defaultModel: {
      provider: defaultModel.provider,
      model: defaultModel.model,
      temperature: defaultModel.temperature ?? DEFAULT_TEMPERATURE,
      ...(defaultModel.maxTokens !== undefined && { maxTokens: defaultModel.maxTokens }),
      ...(defaultModel.topP !== undefined && { topP: defaultModel.topP }),
      systemMessage: defaultModel.systemMessage || options.defaultSystemMessage,
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
export { MAX_CONCURRENT_AGENTS };
