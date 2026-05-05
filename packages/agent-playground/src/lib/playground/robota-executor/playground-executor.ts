import { SilentLogger } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IEventService,
  TUniversalMessage,
  TUniversalValue,
  ILogger,
} from '@robota-sdk/agent-core';

import { PlaygroundAgentSession } from './agent-session';
import { createAssistantMessage, createUserMessage } from './execution-messages';
import {
  createFailureResult,
  createSuccessResult,
  getExecutionErrorMessage,
} from './executor-results';
import { createHistoryPlugin, createStatisticsPlugin } from './plugin-factory';
import { createProvidersWithExecutor } from './remote-providers';
import { recordExecutionStats } from './statistics-recorder';
import type { IAgentConfigurationSnapshot, IToolCard } from './types';
import {
  PlaygroundHistoryPlugin,
  type IVisualizationData,
} from '../plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from '../plugins/playground-statistics-plugin';
import { PlaygroundWebSocketClient } from '../websocket-client';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  IPlaygroundTool,
  TPlaygroundMode,
} from '../robota-executor-types';
import type { IPlaygroundAction, IPlaygroundMetrics } from '../../../types/playground-statistics';

export class PlaygroundExecutor {
  private mode: 'agent' = 'agent';
  private agentSession: PlaygroundAgentSession;
  private historyPlugin: PlaygroundHistoryPlugin;
  private statisticsPlugin: PlaygroundStatisticsPlugin;
  private eventService: IEventService;
  private websocketClient?: PlaygroundWebSocketClient;
  private readonly logger: ILogger;

  constructor(
    private serverUrl: string,
    private authToken: string,
    options: { eventService: IEventService; logger?: ILogger },
  ) {
    this.logger = options.logger || SilentLogger;
    this.historyPlugin = createHistoryPlugin(this.logger);
    this.statisticsPlugin = createStatisticsPlugin();
    this.eventService = options.eventService;
    this.agentSession = new PlaygroundAgentSession(this.eventService);
  }

  async createAgent(config: IPlaygroundAgentConfig): Promise<void> {
    const aiProviders = this.createProvidersWithExecutor();
    this.agentSession.createAgent(config, aiProviders);
    this.setMode('agent');
    await this.statisticsPlugin.recordUIInteraction('agent_create', {
      agentName: config.name,
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
    });
  }

  async updateAgentTools(agentId: string, tools: IPlaygroundTool[]): Promise<{ version: number }> {
    return this.agentSession.updateAgentTools(agentId, tools);
  }

  async getAgentConfiguration(agentId: string): Promise<IAgentConfigurationSnapshot> {
    return this.agentSession.getAgentConfiguration(agentId);
  }

  async updateAgentToolsFromCard(agentId: string, card: IToolCard): Promise<{ version: number }> {
    return this.agentSession.updateAgentToolsFromCard(
      agentId,
      card,
      this.createProvidersWithExecutor(),
    );
  }

  async run(prompt: string): Promise<IPlaygroundExecutorResult> {
    const startTime = Date.now();
    const request = [createUserMessage(prompt)];

    try {
      const result = await this.executeChat(request);
      const duration = Date.now() - startTime;
      const executionResult = createSuccessResult({
        response: result.content || 'No response',
        duration,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: true,
        duration,
        streaming: false,
      });
      return executionResult;
    } catch (error) {
      const executionError = error instanceof Error ? error : String(error);
      const duration = Date.now() - startTime;
      const executionResult = createFailureResult({
        response: 'Execution failed',
        duration,
        error: executionError,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: false,
        duration,
        streaming: false,
        error: getExecutionErrorMessage(executionError),
      });
      return executionResult;
    }
  }

  async execute(
    prompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<IPlaygroundExecutorResult> {
    const startTime = Date.now();
    try {
      const result = await this.agentSession.runPrompt(prompt, 'No active agent to execute prompt');
      const duration = Date.now() - startTime;
      if (onChunk) {
        onChunk(result);
      }

      return createSuccessResult({
        response: result,
        duration,
        visualizationData: this.getVisualizationData(),
        includeUiError: true,
      });
    } catch (error) {
      const executionError = error instanceof Error ? error : String(error);
      const duration = Date.now() - startTime;
      this.logger.error('Playground execution failed', {
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

  async *runStream(prompt: string): AsyncGenerator<string, IPlaygroundExecutorResult> {
    const startTime = Date.now();
    const request = [createUserMessage(prompt)];

    try {
      let fullResponse = '';
      for await (const chunk of this.executeChatStream(request)) {
        fullResponse += chunk.content || '';
      }

      yield fullResponse;
      const duration = Date.now() - startTime;
      const executionResult = createSuccessResult({
        response: fullResponse,
        duration,
        visualizationData: this.getVisualizationData(),
      });
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: true,
        duration,
        streaming: true,
      });
      return executionResult;
    } catch (error) {
      const executionError = error instanceof Error ? error : String(error);
      const duration = Date.now() - startTime;
      const executionResult = createFailureResult({
        response: 'Streaming execution failed',
        duration,
        error: executionError,
        visualizationData: this.getVisualizationData(),
      });
      await recordExecutionStats(this.statisticsPlugin, this.mode, {
        success: false,
        duration,
        streaming: true,
        error: getExecutionErrorMessage(executionError),
      });
      return executionResult;
    }
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
    return this.mode === 'agent' ? this.agentSession.getHistory() : [];
  }

  clearHistory(): void {
    this.historyPlugin.clearEvents();
  }

  async dispose(): Promise<void> {
    try {
      await this.agentSession.disposeCurrentAgent();
      if (this.websocketClient) {
        await this.websocketClient.disconnect();
        this.websocketClient = undefined;
      }
      await this.historyPlugin.dispose();
    } catch (error) {
      throw new Error(
        `Error during PlaygroundExecutor disposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  updateAuth(userId: string, sessionId: string, authToken: string): void {
    if (this.websocketClient) {
      this.websocketClient.updateAuth(userId, sessionId, authToken);
    }
  }

  isWebSocketConnected(): boolean {
    return this.websocketClient ? this.websocketClient.getStatus().connected : false;
  }

  getLastExecutionId(): string | null {
    return 'agent-execution-' + Date.now();
  }

  private async executeChat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
    const prompt = messages[0]?.content || '';
    const result = await this.agentSession.runPrompt(prompt, 'No agent configured for execution');
    return createAssistantMessage(result);
  }

  private async *executeChatStream(
    messages: TUniversalMessage[],
  ): AsyncIterable<TUniversalMessage> {
    const prompt = messages[0]?.content || '';
    let fullResponse = '';
    for await (const chunk of this.agentSession.streamPrompt(prompt)) {
      fullResponse += chunk;
    }
    yield createAssistantMessage(fullResponse);
  }

  private createProvidersWithExecutor(): IAIProvider[] {
    return createProvidersWithExecutor(this.serverUrl, this.authToken);
  }

  private setMode(mode: TPlaygroundMode): void {
    this.mode = mode;
  }
}
