import { IAgentConfig, IAssistantMessage, IExecutionContextInjection } from '../interfaces/agent';
import { ToolExecutionService } from './tool-execution-service';
import type { IAIProviderManager, IToolManager } from '../interfaces/manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { createLogger, type ILogger } from '../utils/logger';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IEventService } from '../interfaces/event-service';
import type { ExecutionCacheService } from './cache/execution-cache-service';

// Re-export constants for public API compatibility
export { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from './execution-constants';

import {
  type IExecutionRoundState,
  type IExecutionContext,
  type IExecutionResult,
  type IExecutionServicePluginStats,
} from './execution-types';
import { ExecutionEventEmitter } from './execution-event-emitter';
import { callPluginHook, type TPluginWithHooks } from './plugin-hook-dispatcher';
import { TMetadata } from '../interfaces/types';
import { executeStream as executeStreamFn } from './execution-stream';
import {
  resolveProviderAndTools,
  validateProvider,
  initializeConversationStore,
  handleExecutionError,
  generateExecutionId,
  requireConversationId,
} from './execution-service-helpers';
import { runExecutionLoop, finalizeExecution } from './execution-pipeline';

/**
 * Service that orchestrates the entire execution pipeline.
 * Coordinates AI provider execution, tool execution service, and plugin lifecycle.
 * Uses centralized conversation history management.
 */
export class ExecutionService {
  private toolExecutionService: ToolExecutionService;
  private aiProviders: IAIProviderManager;
  private tools: IToolManager;
  private conversationHistory: ConversationHistory;
  private plugins: TPluginWithHooks[] = [];
  private logger: ILogger;
  private eventEmitter: ExecutionEventEmitter;
  private cacheService?: ExecutionCacheService;

  constructor(
    aiProviders: IAIProviderManager,
    tools: IToolManager,
    conversationHistory: ConversationHistory,
    eventService?: IEventService,
    executionContext?: IExecutionContextInjection,
    cacheService?: ExecutionCacheService,
  ) {
    this.toolExecutionService = new ToolExecutionService(tools);
    this.aiProviders = aiProviders;
    this.tools = tools;
    this.conversationHistory = conversationHistory;
    this.plugins = [];
    this.logger = createLogger('ExecutionService');
    if (!eventService) {
      throw new Error('[EXECUTION] EventService is required');
    }
    this.eventEmitter = new ExecutionEventEmitter(eventService, this.logger, executionContext);
    this.cacheService = cacheService;
  }

  /** Register a plugin */
  registerPlugin(plugin: TPluginWithHooks): void {
    const pluginPriority = plugin.priority ?? 0;
    const insertIndex = this.plugins.findIndex((p) => (p.priority ?? 0) < pluginPriority);
    if (insertIndex === -1) {
      this.plugins.push(plugin);
    } else {
      this.plugins.splice(insertIndex, 0, plugin);
    }
    this.logger.debug('Plugin registered', {
      pluginName: plugin.name,
      priority: pluginPriority,
      hasBeforeRun: typeof plugin.beforeRun,
      hasAfterRun: typeof plugin.afterRun,
      hasBeforeProviderCall: typeof plugin.beforeProviderCall,
      hasAfterProviderCall: typeof plugin.afterProviderCall,
    });
  }

  /** Remove a plugin */
  removePlugin(pluginName: string): boolean {
    const index = this.plugins.findIndex((p) => p.name === pluginName);
    if (index !== -1) {
      this.plugins.splice(index, 1);
      this.logger.debug('Plugin removed', { pluginName });
      return true;
    }
    return false;
  }

  /** Get a plugin by name */
  getPlugin(pluginName: string): TPluginWithHooks | undefined {
    return this.plugins.find((p) => p.name === pluginName);
  }

  /** Get all registered plugins */
  getPlugins(): TPluginWithHooks[] {
    return [...this.plugins];
  }

  /** Execute the full pipeline with centralized history management */
  async execute(
    input: string,
    messages: TUniversalMessage[],
    config: IAgentConfig,
    context?: Partial<IExecutionContext>,
  ): Promise<IExecutionResult> {
    const executionId = generateExecutionId();
    const startTime = new Date();
    const conversationId = requireConversationId(context, 'execute');

    const fullContext: IExecutionContext = {
      messages,
      config,
      startTime,
      executionId,
      conversationId,
      ...(context?.sessionId && { sessionId: context.sessionId }),
      ...(context?.userId && { userId: context.userId }),
      ...(context?.metadata && { metadata: context.metadata }),
      ...(context?.signal && { signal: context.signal }),
    };

    this.eventEmitter.prepareOwnerPathBases(conversationId);

    this.logger.debug('Starting execution pipeline', {
      executionId,
      conversationId,
      messageCount: messages.length,
      hasContext: !!context,
    });

    const resolved = resolveProviderAndTools(this.aiProviders, this.tools, config);
    this.eventEmitter.emitExecutionStartEvent(
      input,
      config,
      messages,
      resolved,
      conversationId,
      executionId,
    );

    const conversationStore = initializeConversationStore(
      this.conversationHistory,
      conversationId,
      messages,
      config,
      executionId,
    );

    try {
      conversationStore.addUserMessage(input, { executionId });
      this.eventEmitter.emitUserMessageEvent(input, conversationId, executionId);

      await callPluginHook(
        this.plugins,
        'beforeRun',
        {
          input,
          ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {}),
        },
        this.logger,
      );

      validateProvider(resolved);

      const roundState: IExecutionRoundState = {
        toolsExecuted: [],
        currentRound: 0,
        runningAssistantCount: 0,
        lastTrackedAssistantMessage: undefined,
        cumulativeInputTokens: 0,
      };

      for (const msg of conversationStore.getMessages()) {
        if (msg.role === 'assistant') {
          roundState.runningAssistantCount++;
          roundState.lastTrackedAssistantMessage = msg as IAssistantMessage;
        }
      }

      await runExecutionLoop(
        conversationStore,
        conversationId,
        executionId,
        fullContext,
        config,
        resolved,
        roundState,
        context?.signal,
        {
          toolExecutionService: this.toolExecutionService,
          plugins: this.plugins,
          logger: this.logger,
          eventEmitter: this.eventEmitter,
          cacheService: this.cacheService,
        },
      );

      return finalizeExecution(
        input,
        conversationStore,
        executionId,
        startTime,
        roundState,
        conversationId,
        context?.signal?.aborted ?? false,
        context,
        this.plugins,
        this.logger,
        this.eventEmitter,
      );
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort'));
      if (isAbortError) {
        return {
          response: '',
          messages: conversationStore.getMessages(),
          executionId,
          duration: Date.now() - startTime.getTime(),
          toolsExecuted: [],
          success: true,
          interrupted: true,
        };
      }
      await handleExecutionError(
        error,
        fullContext,
        startTime,
        conversationId,
        executionId,
        this.plugins,
        this.logger,
        this.eventEmitter,
      );
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        response: `Error: ${errMsg}`,
        messages: [],
        tokensUsed: 0,
        toolsExecuted: [],
        duration: Date.now() - startTime.getTime(),
        executionId,
        success: false,
      };
    } finally {
      this.eventEmitter.resetOwnerPathBases();
    }
  }

  /** Execute with streaming response */
  async *executeStream(
    input: string,
    messages: TUniversalMessage[],
    config: IAgentConfig,
    context?: Partial<IExecutionContext>,
  ): AsyncGenerator<{ chunk: string; isComplete: boolean }> {
    yield* executeStreamFn(input, messages, config, context, {
      aiProviders: this.aiProviders,
      tools: this.tools,
      conversationHistory: this.conversationHistory,
      toolExecutionService: this.toolExecutionService,
      plugins: this.plugins,
      logger: this.logger,
      eventEmitter: this.eventEmitter,
      generateExecutionId: () => generateExecutionId(),
    });
  }

  /** Get execution statistics from plugins */
  async getStats(): Promise<IExecutionServicePluginStats> {
    return {
      pluginCount: this.plugins.length,
      pluginNames: this.plugins.map((p) => p.name),
      historyStats: this.conversationHistory.getStats(),
    };
  }

  /** Clear all plugins */
  clearPlugins(): void {
    this.plugins = [];
    this.logger.debug('All plugins cleared');
  }
}
