/**
 * Async initialization logic for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import type { IAgentConfig } from '../interfaces/agent';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { Tools } from '../managers/tool-manager';
import type { AgentFactory } from '../managers/agent-factory';
import type { ConversationHistory } from '../managers/conversation-history-manager';
import type { ModuleRegistry } from '../managers/module-registry';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { ExecutionService } from '../services/execution-service';
import { CacheKeyBuilder, MemoryCacheStorage, ExecutionCacheService } from '../services/cache';
import type { IEventService } from '../interfaces/event-service';
import { AbstractTool } from '../abstracts/abstract-tool';
import type { ILogger } from '../utils/logger';
import type { IToolExecutionContext, TToolParameters } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Context required for async initialization.
 * @internal
 */
export interface IRobotaInitContext {
  config: IAgentConfig;
  aiProviders: AIProviders;
  tools: Tools;
  agentFactory: AgentFactory;
  conversationHistory: ConversationHistory;
  moduleRegistry: ModuleRegistry;
  eventEmitter: EventEmitterPlugin;
  eventService: IEventService;
  logger: ILogger;
}

/**
 * Performs the full async initialization of a Robota instance.
 * Returns the created ExecutionService.
 * @internal
 */
export async function performAsyncInitialization(
  ctx: IRobotaInitContext,
): Promise<ExecutionService> {
  const {
    config,
    aiProviders,
    tools,
    agentFactory,
    conversationHistory,
    moduleRegistry,
    eventEmitter,
    eventService,
    logger,
  } = ctx;

  logger.debug('Starting Robota initialization with independent managers');

  // Initialize all instance-specific managers
  await Promise.all([aiProviders.initialize(), tools.initialize(), agentFactory.initialize()]);

  // Register AI providers
  if (config.aiProviders) {
    for (const provider of config.aiProviders) {
      aiProviders.addProvider(provider.name, provider);
    }
  }

  // Set current provider from defaultModel
  if (config.defaultModel) {
    aiProviders.setCurrentProvider(config.defaultModel.provider, config.defaultModel.model);
  }

  // Register modules if provided
  if (config.modules) {
    for (const module of config.modules) {
      await moduleRegistry.registerModule(module, {
        autoInitialize: true,
        validateDependencies: true,
      });
    }
    logger.debug('Modules registered and initialized', {
      moduleCount: config.modules.length,
      moduleNames: config.modules.map((m) => m.name),
    });
  }

  // Register tools
  if (config.tools) {
    for (const tool of config.tools) {
      if (tool instanceof AbstractTool && eventService) {
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
      tools.addTool(tool.schema, toolExecutor);
      logger.debug('Tool registered during initialization', { toolName: tool.schema.name });
    }
  }

  // Build cache service if cache config is provided
  let cacheService: ExecutionCacheService | undefined;
  if (config.cache?.enabled) {
    const cacheStorage = new MemoryCacheStorage({
      maxEntries: config.cache.maxEntries,
      ttlMs: config.cache.ttlMs,
    });
    cacheService = new ExecutionCacheService(cacheStorage, new CacheKeyBuilder());
  }

  const executionService = new ExecutionService(
    aiProviders,
    tools,
    conversationHistory,
    eventService,
    config.executionContext,
    cacheService,
  );

  // Register plugins with ExecutionService
  if (config.plugins) {
    for (const plugin of config.plugins) {
      executionService.registerPlugin(plugin);
      if (plugin.subscribeToModuleEvents) {
        await plugin.subscribeToModuleEvents(eventEmitter);
        logger.debug('Plugin subscribed to module events', { pluginName: plugin.name });
      }
    }
  }

  logger.debug('Robota initialization completed successfully with independent managers');
  return executionService;
}

/**
 * Mutable init state passed to performDoAsyncInit.
 */
export interface IRobotaInitState {
  ctx: IRobotaInitContext;
  setExecutionService: (svc: ExecutionService) => void;
  setFullyInitialized: (v: boolean) => void;
}

/**
 * Wraps performAsyncInitialization with the standard error handling pattern
 * from the Robota class, setting executionService and isFullyInitialized on success.
 */
export async function performDoAsyncInit(state: IRobotaInitState): Promise<void> {
  try {
    const svc = await performAsyncInitialization(state.ctx);
    state.setExecutionService(svc);
    state.setFullyInitialized(true);
  } catch (error) {
    state.ctx.logger.error('Robota initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
