/**
 * Async initialization logic for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import { AbstractTool } from '../abstracts/abstract-tool';
import { AIProviders } from '../managers/ai-provider-manager';
import { CacheKeyBuilder, MemoryCacheStorage, ExecutionCacheService } from '../services/cache';
import { ExecutionService } from '../services/execution-service';

import type { IAgentConfig } from '../interfaces/agent';
import type { IEventService } from '../interfaces/event-service';
import type { IToolExecutionContext, TToolParameters } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';
import type { AgentFactory } from '../managers/agent-factory';
import type { ConversationHistory } from '../managers/conversation-history-manager';
import type { ModuleRegistry } from '../managers/module-registry';
import type { Tools } from '../managers/tool-manager';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { ILogger } from '../utils/logger';

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
 * Build the provider registry an agent's config describes, with its current model already selected
 * — CORE-047.
 *
 * Registration and selection are synchronous and derived entirely from config the constructor has
 * already passed through `validateAgentConfig`. They lived inside `performAsyncInitialization` only
 * because they were written next to work that genuinely is async (modules, plugins, the execution
 * service), and the cost of that placement was that `getModel()` / `setModel()` /
 * `swapDefaultProvider()` had to refuse until the agent had run a turn — you could not ask which
 * model you were using without first asking the model a question.
 *
 * Constructing and configuring in one function is the point: there is no intermediate state in which
 * an `AIProviders` exists without the config's providers in it, so "an agent knows which model it is
 * configured for from the moment it exists" is true by construction rather than by a flag a caller
 * has to reach. `Robota` calls it exactly once, from its CONSTRUCTOR;
 * `performAsyncInitialization` must not repeat the work, or a `setModel()` made before the first run
 * would be silently reverted to `config.defaultModel` when the run initializes.
 *
 * @internal
 */
export function createConfiguredProviders(config: IAgentConfig): AIProviders {
  const aiProviders = new AIProviders();
  if (config.aiProviders) {
    for (const provider of config.aiProviders) {
      aiProviders.addProvider(provider.name, provider);
    }
  }
  if (config.defaultModel) {
    aiProviders.setCurrentProvider(config.defaultModel.provider, config.defaultModel.model);
  }
  return aiProviders;
}

/**
 * Performs the full async initialization of a Robota instance.
 * Returns the created ExecutionService.
 * @internal
 */
async function performAsyncInitialization(ctx: IRobotaInitContext): Promise<ExecutionService> {
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

  // CORE-047: provider registration and current-model selection are NOT repeated here. The
  // constructor did them (`createConfiguredProviders`), and repeating them would revert a
  // `setModel()` made before the first run back to `config.defaultModel` at run time.

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

  // CMD-005: forward the injected "ask the user" port into tool execution contexts.
  if (config.ask) {
    executionService.setAskHandler(config.ask);
  }

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
