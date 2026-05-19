import { SilentLogger } from '@robota-sdk/agent-core';
import type {
  IEventService,
  TUniversalMessage,
  TUniversalValue,
  ILogger,
} from '@robota-sdk/agent-core';

import {
  createFailureResult,
  createSuccessResult,
  getExecutionErrorMessage,
} from './executor-results';
import { createHistoryPlugin, createStatisticsPlugin } from './plugin-factory';
import { recordExecutionStats } from './statistics-recorder';
import type { IAgentConfigurationSnapshot, IToolCard } from './types';
import {
  PlaygroundHistoryPlugin,
  type IVisualizationData,
} from '../plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from '../plugins/playground-statistics-plugin';
import { createSession, sseSessionSubmit, destroySession } from './sse-client';
import type { IRestoredMessage } from './sse-client';
import { mapSseEventToConversationEvent } from './event-mapper';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  IPlaygroundTool,
  TPlaygroundMode,
} from '../robota-executor-types';
import type { IPlaygroundAction, IPlaygroundMetrics } from '../../../types/playground-statistics';

interface ILocalAgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  systemPrompt?: string;
  toolIds: string[];
}

export class PlaygroundExecutor {
  private readonly mode: 'agent' = 'agent';
  private readonly historyPlugin: PlaygroundHistoryPlugin;
  private readonly statisticsPlugin: PlaygroundStatisticsPlugin;
  private readonly eventService: IEventService;
  private readonly logger: ILogger;
  private localConfig: ILocalAgentConfig | null = null;
  private sessionId: string | null = null;
  private restoredMessages: IRestoredMessage[] = [];

  constructor(
    private serverUrl: string,
    _authToken: string,
    options: { eventService: IEventService; logger?: ILogger },
  ) {
    this.logger = options.logger ?? SilentLogger;
    this.historyPlugin = createHistoryPlugin(this.logger);
    this.statisticsPlugin = createStatisticsPlugin();
    this.eventService = options.eventService;
  }

  async createAgent(config: IPlaygroundAgentConfig): Promise<void> {
    if (this.sessionId) {
      const oldSessionId = this.sessionId;
      this.sessionId = null;
      void destroySession(this.serverUrl, this.localConfig?.apiKey, oldSessionId);
    }

    this.localConfig = {
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
      apiKey: config.apiKey,
      systemPrompt: config.defaultModel.systemMessage ?? config.systemMessage,
      toolIds: [],
    };
    this.historyPlugin.clearEvents();
    await this.statisticsPlugin.recordUIInteraction('agent_create', {
      agentName: config.name,
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
    });

    const skills = config.skills?.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      skillMdContent: s.skillMdContent,
    }));

    const sessionResponse = await createSession(this.serverUrl, this.localConfig.apiKey, {
      provider: this.localConfig.provider,
      model: this.localConfig.model,
      systemPrompt: this.localConfig.systemPrompt,
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(config.resumeSessionId ? { resumeSessionId: config.resumeSessionId } : {}),
    });
    this.sessionId = sessionResponse.sessionId;
    this.restoredMessages = sessionResponse.messages ?? [];
  }

  popRestoredMessages(): IRestoredMessage[] {
    const msgs = this.restoredMessages;
    this.restoredMessages = [];
    return msgs;
  }

  async updateAgentTools(
    _agentId: string,
    _tools: IPlaygroundTool[],
  ): Promise<{ version: number }> {
    return { version: Date.now() };
  }

  async getAgentConfiguration(_agentId: string): Promise<IAgentConfigurationSnapshot> {
    return {
      version: 1,
      tools: (this.localConfig?.toolIds ?? []).map((id) => ({ name: id })),
      updatedAt: Date.now(),
    };
  }

  async updateAgentToolsFromCard(_agentId: string, card: IToolCard): Promise<{ version: number }> {
    if (!this.localConfig) throw new Error('No agent configured. Call createAgent first.');
    if (!this.localConfig.toolIds.includes(card.id)) {
      this.localConfig.toolIds.push(card.id);
    }
    return { version: Date.now() };
  }

  async run(prompt: string): Promise<IPlaygroundExecutorResult> {
    if (!this.localConfig) {
      return createFailureResult({
        response: 'No agent configured',
        duration: 0,
        error: new Error('No agent configured. Call createAgent first.'),
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    }

    if (!this.sessionId) {
      const sessionResponse = await createSession(this.serverUrl, this.localConfig.apiKey, {
        provider: this.localConfig.provider,
        model: this.localConfig.model,
        systemPrompt: this.localConfig.systemPrompt,
      });
      this.sessionId = sessionResponse.sessionId;
    }

    const startTime = Date.now();
    const textAccumulator = { value: '' };
    const taskTextAccumulators = new Map<string, string>();
    const sessionId = this.sessionId;
    const { apiKey } = this.localConfig;

    try {
      this.historyPlugin.recordEvent({
        id: crypto.randomUUID(),
        type: 'user_message',
        timestamp: new Date(),
        content: prompt,
      });

      const stream = sseSessionSubmit(this.serverUrl, apiKey, sessionId, prompt);

      for await (const sseEvent of stream) {
        const conversationEvent = mapSseEventToConversationEvent(
          sseEvent,
          textAccumulator,
          taskTextAccumulators,
        );
        if (conversationEvent) {
          this.historyPlugin.recordEvent(conversationEvent);
        }
        if (sseEvent.type === 'error') {
          throw new Error(sseEvent.data.message);
        }
      }

      const response = textAccumulator.value || 'No response';
      const duration = Date.now() - startTime;
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: true,
        duration,
        streaming: true,
      });

      return createSuccessResult({
        response,
        duration,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    } catch (error) {
      // allow-fallback: execution errors return IPlaygroundExecutorResult, not thrown
      const executionError = error instanceof Error ? error : String(error);
      const duration = Date.now() - startTime;
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: false,
        duration,
        streaming: false,
        error: getExecutionErrorMessage(executionError),
      });
      return createFailureResult({
        response: 'Execution failed',
        duration,
        error: executionError,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    }
  }

  async execute(
    prompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<IPlaygroundExecutorResult> {
    if (!this.localConfig || !this.sessionId) {
      return createFailureResult({
        response: 'No agent configured',
        duration: 0,
        error: new Error('No agent configured. Call createAgent first.'),
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    }

    const startTime = Date.now();
    const textAccumulator = { value: '' };
    const taskTextAccumulators = new Map<string, string>();
    const sessionId = this.sessionId;
    const { apiKey } = this.localConfig;

    try {
      const stream = sseSessionSubmit(this.serverUrl, apiKey, sessionId, prompt);

      for await (const sseEvent of stream) {
        if (sseEvent.type === 'text_delta') {
          onChunk?.(sseEvent.data.text);
        }
        const conversationEvent = mapSseEventToConversationEvent(
          sseEvent,
          textAccumulator,
          taskTextAccumulators,
        );
        if (conversationEvent) {
          this.historyPlugin.recordEvent(conversationEvent);
        }
        if (sseEvent.type === 'error') {
          throw new Error(sseEvent.data.message);
        }
      }

      const response = textAccumulator.value || 'No response';
      const duration = Date.now() - startTime;
      return createSuccessResult({
        response,
        duration,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    } catch (error) {
      // allow-fallback: execution errors return IPlaygroundExecutorResult, not thrown
      const executionError = error instanceof Error ? error : String(error);
      const duration = Date.now() - startTime;
      return createFailureResult({
        response: 'Execution failed',
        duration,
        error: executionError,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    }
  }

  async *runStream(prompt: string): AsyncGenerator<string, IPlaygroundExecutorResult> {
    const result = await this.execute(prompt);
    yield result.response;
    return result;
  }

  getPlaygroundStatistics(): IPlaygroundMetrics {
    return this.statisticsPlugin.getPlaygroundStats().metrics;
  }

  async recordPlaygroundAction(
    actionType: IPlaygroundAction['type'],
    metadata?: Record<string, TUniversalValue>,
  ): Promise<void> {
    await this.statisticsPlugin.recordUIInteraction(actionType, metadata);
  }

  async recordBlockCreation(
    blockType: string,
    metadata?: Record<string, TUniversalValue>,
  ): Promise<void> {
    await this.statisticsPlugin.recordBlockCreation(blockType, metadata);
  }

  getVisualizationData(): IVisualizationData {
    return this.historyPlugin.getVisualizationData();
  }

  getPlaygroundEvents() {
    return this.historyPlugin.getAllEvents();
  }

  getHistory(): TUniversalMessage[] {
    return [];
  }

  clearHistory(): void {
    if (this.sessionId) {
      const sessionId = this.sessionId;
      this.sessionId = null;
      void destroySession(this.serverUrl, this.localConfig?.apiKey, sessionId);
    }
    this.historyPlugin.clearEvents();
  }

  async dispose(): Promise<void> {
    if (this.sessionId) {
      const sessionId = this.sessionId;
      this.sessionId = null;
      await destroySession(this.serverUrl, this.localConfig?.apiKey, sessionId);
    }
    await this.historyPlugin.dispose();
  }

  updateAuth(_userId: string, _sessionId: string, _authToken: string): void {
    // SSE model is stateless; auth is per-request via X-Provider-API-Key
  }

  isWebSocketConnected(): boolean {
    return false;
  }

  getLastExecutionId(): string | null {
    return 'agent-execution-' + Date.now();
  }
}
