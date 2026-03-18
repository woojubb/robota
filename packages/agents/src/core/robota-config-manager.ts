/**
 * Configuration and tool management delegate for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import type { IAgentConfig, IExecutionContextInjection } from '../interfaces/agent';
import type { IToolWithEventService } from '../abstracts/abstract-tool';
import type { AbstractTool } from '../abstracts/abstract-tool';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { Tools } from '../managers/tool-manager';
import type { IEventService } from '../interfaces/event-service';
import type { ILogger } from '../utils/logger';
import type { IToolExecutionContext, TToolParameters } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';
import { ConfigurationError } from '../utils/errors';
import { AGENT_EVENTS } from '../agents/constants';

/** Agent statistics metadata type */
export type TAgentStatsMetadata = Record<string, string | number | boolean | Date | string[]>;

/**
 * Validates the agent configuration format.
 * @internal
 */
export function validateAgentConfig(config: IAgentConfig): void {
  if (!config.name) {
    throw new ConfigurationError('Agent name is required', { component: 'Robota' });
  }

  if (!config.aiProviders || config.aiProviders.length === 0) {
    throw new ConfigurationError('At least one AI provider is required', { component: 'Robota' });
  }

  if (!config.defaultModel) {
    throw new ConfigurationError('Default model configuration is required', {
      component: 'Robota',
    });
  }

  if (!config.defaultModel.provider || !config.defaultModel.model) {
    throw new ConfigurationError('Default model must specify both provider and model', {
      component: 'Robota',
    });
  }

  const providerNames = config.aiProviders.map((p) => p.name);
  const duplicates = providerNames.filter((name, index) => providerNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new ConfigurationError(`Duplicate AI provider names: ${duplicates.join(', ')}`, {
      component: 'Robota',
      duplicates,
    });
  }

  if (!providerNames.includes(config.defaultModel.provider)) {
    throw new ConfigurationError(
      `Default provider '${config.defaultModel.provider}' not found in AI providers list. Available: ${providerNames.join(', ')}`,
      {
        component: 'Robota',
        defaultProvider: config.defaultModel.provider,
        availableProviders: providerNames,
      },
    );
  }
}

/**
 * Manages model/tool/config updates on behalf of a Robota instance.
 * @internal
 */
export class RobotaConfigManager {
  constructor(
    private readonly logger: ILogger,
    private readonly getAIProviders: () => AIProviders,
    private readonly getTools: () => Tools,
    private readonly getEventService: () => IEventService | undefined,
    private readonly isReady: () => boolean,
    private readonly ensureReady: () => Promise<void>,
    private readonly getConfig: () => IAgentConfig,
    private readonly setConfig: (c: IAgentConfig) => void,
    private readonly getConfigVersion: () => number,
    private readonly bumpConfigVersion: () => number,
    private readonly getConfigUpdatedAt: () => number,
    private readonly setConfigUpdatedAt: (t: number) => void,
    private readonly emitAgentEvent: (eventType: string, data: Record<string, unknown>) => void,
  ) {}

  /** Update tools for this agent instance. */
  async updateTools(next: Array<IToolWithEventService>): Promise<{ version: number }> {
    await this.ensureReady();

    if (!Array.isArray(next)) {
      throw new ConfigurationError('updateTools: next must be an array of tools');
    }

    const registry = this.getTools().getRegistry();
    registry.clear();

    const toolNames: string[] = [];
    const eventService = this.getEventService();
    for (const tool of next) {
      if (eventService) {
        tool.setEventService(eventService);
      }
      const toolExecutor = async (
        parameters: TToolParameters,
        context?: IToolExecutionContext,
      ): Promise<TUniversalValue> => {
        if (!context) {
          throw new Error('[ROBOTA] Missing ToolExecutionContext for tool execution');
        }
        const result = await tool.execute(parameters, context);
        return result.data;
      };
      this.getTools().addTool(tool.schema, toolExecutor);
      const nm = tool.schema.name;
      if (typeof nm === 'string' && nm.length > 0) toolNames.push(nm);
    }

    const config = this.getConfig();
    config.tools = next;
    this.setConfig(config);
    const version = this.bumpConfigVersion();
    this.setConfigUpdatedAt(Date.now());

    this.emitAgentEvent(AGENT_EVENTS.CONFIG_UPDATED, {
      parameters: {
        tools: toolNames,
        systemMessage: config.defaultModel.systemMessage,
        provider: config.defaultModel.provider,
        model: config.defaultModel.model,
        temperature: config.defaultModel.temperature,
        maxTokens: config.defaultModel.maxTokens,
      },
      metadata: { version },
    });

    return { version };
  }

  /** Update configuration partially. Currently supports tools. */
  async updateConfiguration(patch: Partial<IAgentConfig>): Promise<{ version: number }> {
    if (patch.tools) {
      return this.updateTools(patch.tools);
    }
    throw new ConfigurationError('updateConfiguration: only tools patch is supported at this time');
  }

  /** Read-only configuration overview for UI. */
  async getConfiguration(): Promise<{
    version: number;
    tools: Array<{ name: string; parameters?: string[] }>;
    updatedAt: number;
    metadata?: TAgentStatsMetadata;
  }> {
    await this.ensureReady();
    const schemas = this.getTools().getTools();
    const tools = schemas.map((s) => ({
      name: s.name,
      parameters: (() => {
        const params = s.parameters as { properties?: Record<string, object> } | undefined;
        const props = params?.properties;
        return props && typeof props === 'object' ? Object.keys(props) : undefined;
      })(),
    }));
    return {
      version: this.getConfigVersion(),
      tools,
      updatedAt: this.getConfigUpdatedAt(),
      metadata: undefined,
    };
  }

  /** Set the current model configuration (complete replacement). */
  setModel(modelConfig: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemMessage?: string;
  }): void {
    if (!modelConfig.provider || !modelConfig.model) {
      throw new ConfigurationError('Both provider and model are required', { component: 'Robota' });
    }

    if (!this.isReady()) {
      throw new ConfigurationError(
        'Agent must be fully initialized before changing model configuration',
        { component: 'Robota' },
      );
    }

    const aiProviders = this.getAIProviders();
    const availableProviders = aiProviders.getProviderNames();
    if (!availableProviders.includes(modelConfig.provider)) {
      throw new ConfigurationError(
        `AI Provider '${modelConfig.provider}' not found. Available: ${availableProviders.join(', ')}`,
        { component: 'Robota', provider: modelConfig.provider, availableProviders },
      );
    }

    aiProviders.setCurrentProvider(modelConfig.provider, modelConfig.model);

    const config = this.getConfig();
    this.setConfig({
      ...config,
      defaultModel: {
        ...config.defaultModel,
        provider: modelConfig.provider,
        model: modelConfig.model,
        ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
        ...(modelConfig.maxTokens !== undefined && { maxTokens: modelConfig.maxTokens }),
        ...(modelConfig.topP !== undefined && { topP: modelConfig.topP }),
        ...(modelConfig.systemMessage !== undefined && {
          systemMessage: modelConfig.systemMessage,
        }),
      },
    });

    this.logger.debug('Model configuration updated', modelConfig);
  }

  /** Get the current model configuration. */
  getModel(): {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemMessage?: string;
  } {
    if (!this.isReady()) {
      throw new ConfigurationError(
        'Agent must be fully initialized before getting model configuration',
        { component: 'Robota' },
      );
    }

    const currentProviderInfo = this.getAIProviders().getCurrentProvider();
    if (!currentProviderInfo) {
      throw new ConfigurationError('No provider is currently set', { component: 'Robota' });
    }

    const config = this.getConfig();
    return {
      provider: currentProviderInfo.provider,
      model: currentProviderInfo.model,
      ...(config.defaultModel.temperature !== undefined && {
        temperature: config.defaultModel.temperature,
      }),
      ...(config.defaultModel.maxTokens !== undefined && {
        maxTokens: config.defaultModel.maxTokens,
      }),
      ...(config.defaultModel.topP !== undefined && { topP: config.defaultModel.topP }),
      ...(config.defaultModel.systemMessage !== undefined && {
        systemMessage: config.defaultModel.systemMessage,
      }),
    };
  }

  /** Register a new tool for function calling. */
  registerTool(tool: AbstractTool, tools: Tools): void {
    if (tools.hasTool(tool.schema.name)) {
      throw new Error(
        `[STRICT-POLICY][EMITTER-CONTRACT] Duplicate tool registration attempted: ${tool.schema.name}. ` +
          `Tool registration flow must provide a single authoritative registration path.`,
      );
    }

    const toolExecutor = async (
      parameters: TToolParameters,
      context?: IToolExecutionContext,
    ): Promise<TUniversalValue> => {
      if (!context) {
        throw new Error('[ROBOTA] Missing ToolExecutionContext for tool execution');
      }
      const result = await tool.execute(parameters, context);
      return result.data;
    };
    tools.addTool(tool.schema, toolExecutor);
    this.logger.debug('Tool registered', { toolName: tool.schema.name });
  }
}
