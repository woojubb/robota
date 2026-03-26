const RANDOM_ID_BASE = 36;
const RANDOM_ID_LENGTH = 9;

/**
 * PlaygroundExecutor - Manages Robota Agent execution in the browser
 */

const randomUUID = (): string => crypto.randomUUID();
import { Robota } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IEventService,
  IExecutor,
  IToolExecutionContext,
  IToolSchema,
  TLoggerData,
  TToolParameters,
  TUniversalMessage,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { FunctionTool } from '@robota-sdk/agent-tools';
import {
  PlaygroundHistoryPlugin,
  type IVisualizationData,
} from './plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from './plugins/playground-statistics-plugin';
import type {
  IPlaygroundAction,
  IPlaygroundMetrics,
  IPlaygroundExecutionResult as IPlaygroundStatisticsExecutionResult,
} from '../../types/playground-statistics';
import { SilentLogger, type ILogger } from '@robota-sdk/agent-core';
import { PlaygroundWebSocketClient } from './websocket-client';
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';
import { ToolRegistry } from '../../tools/catalog';

export type {
  IPlaygroundTool,
  IPlaygroundPlugin,
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  TPlaygroundMode,
  TPlaygroundUiErrorKind,
  IPlaygroundUiError,
  IVisualizationData,
  IConversationEvent,
} from './robota-executor-types';

import type {
  IPlaygroundTool,
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  TPlaygroundMode,
  IPlaygroundToolHookFlags,
} from './robota-executor-types';
import { toPlaygroundUiError } from './robota-executor-types';

export class PlaygroundExecutor {
  private mode: 'agent' = 'agent';
  private currentAgent?: Robota;
  private agentRegistry: Map<string, Robota> = new Map();
  private agentToolsRegistry: Map<string, FunctionTool[]> = new Map();
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
    this.historyPlugin = new PlaygroundHistoryPlugin({
      maxEvents: 1000,
      enableVisualization: true,
      logger: this.logger,
    });
    this.statisticsPlugin = new PlaygroundStatisticsPlugin({
      enabled: true,
      collectUIMetrics: true,
      collectBlockMetrics: true,
      trackResponseTime: true,
      trackExecutionDetails: true,
      maxEntries: 1000,
      slowExecutionThreshold: 3000,
      errorRateThreshold: 10,
    });
    this.eventService = options.eventService;
  }

  async createAgent(config: IPlaygroundAgentConfig): Promise<void> {
    const aiProviders = this.createProvidersWithExecutor();
    const normalizedTools = this.normalizeTools(config.tools || []);
    const rootAgentId = config.id || config.name;
    this.currentAgent = new Robota({
      name: config.name,
      aiProviders,
      defaultModel: config.defaultModel,
      tools: normalizedTools,
      eventService: this.eventService,
    });
    this.agentRegistry.set(rootAgentId, this.currentAgent);
    this.agentToolsRegistry.set(rootAgentId, normalizedTools);
    this.setMode('agent');
    await this.statisticsPlugin.recordUIInteraction('agent_create', {
      agentName: config.name,
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
    });
  }

  async updateAgentTools(agentId: string, tools: IPlaygroundTool[]): Promise<{ version: number }> {
    if (!agentId || typeof agentId !== 'string')
      throw new Error('updateAgentTools: invalid agentId');
    const agent = this.agentRegistry.get(agentId);
    if (!agent) throw new Error(`updateAgentTools: agent not found for id ${agentId}`);
    const normalizedTools = this.normalizeTools(tools);
    const result = await agent.updateTools(normalizedTools);
    this.agentToolsRegistry.set(agentId, normalizedTools);
    return result;
  }

  async getAgentConfiguration(agentId: string): Promise<{
    version: number;
    tools: Array<{ name: string; parameters?: string[] }>;
    updatedAt: number;
    metadata?: Record<string, unknown>;
  }> {
    if (!agentId || typeof agentId !== 'string')
      throw new Error('getAgentConfiguration: invalid agentId');
    const agent = this.agentRegistry.get(agentId);
    if (!agent) throw new Error(`getAgentConfiguration: agent not found for id ${agentId}`);
    return agent.getConfiguration();
  }

  async updateAgentToolsFromCard(
    agentId: string,
    card: { id: string; name: string; description?: string },
  ): Promise<{ version: number }> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) throw new Error(`agent not found: ${agentId}`);
    const typedToolRegistry = ToolRegistry as Record<
      string,
      ((eventService: IEventService, aiProviders: IAIProvider[]) => FunctionTool) | undefined
    >;
    const factory = typedToolRegistry[card.id];
    if (typeof factory !== 'function') throw new Error(`Unknown tool id: ${card.id}`);
    const newTool = factory(this.eventService, this.createProvidersWithExecutor());
    const existing = this.agentToolsRegistry.get(agentId) || [];
    const result = await agent.updateTools([...existing, newTool]);
    this.agentToolsRegistry.set(agentId, [...existing, newTool]);
    return result;
  }

  async run(prompt: string): Promise<IPlaygroundExecutorResult> {
    const startTime = Date.now();
    const request: TUniversalMessage[] = [
      {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ];
    try {
      const result = await this.executeChat(request);
      const duration = Date.now() - startTime;
      const executionResult: IPlaygroundExecutorResult = {
        success: true,
        response: result.content || 'No response',
        duration,
        visualizationData: this.getVisualizationData(),
        uiError: undefined,
      };
      await this.recordStats({ success: true, duration, streaming: false });
      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const executionResult: IPlaygroundExecutorResult = {
        success: false,
        response: 'Execution failed',
        duration,
        error: error instanceof Error ? error : new Error(String(error)),
        visualizationData: this.getVisualizationData(),
        uiError: toPlaygroundUiError(error instanceof Error ? error : String(error)),
      };
      await this.recordStats({
        success: false,
        duration,
        streaming: false,
        error: error instanceof Error ? error.message : String(error),
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
      if (!this.currentAgent) throw new Error('No active agent to execute prompt');
      const result = await this.currentAgent.run(prompt);
      const duration = Date.now() - startTime;
      if (onChunk) onChunk(result);
      return {
        success: true,
        response: result,
        duration,
        visualizationData: this.getVisualizationData(),
        uiError: undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Playground execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        response: 'Execution failed',
        duration,
        error: error instanceof Error ? error : new Error(String(error)),
        visualizationData: this.getVisualizationData(),
        uiError: toPlaygroundUiError(error instanceof Error ? error : String(error)),
      };
    }
  }

  async *runStream(prompt: string): AsyncGenerator<string, IPlaygroundExecutorResult> {
    const startTime = Date.now();
    const request: TUniversalMessage[] = [
      {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ];
    try {
      let fullResponse = '';
      for await (const chunk of this.executeChatStream(request)) {
        fullResponse += chunk.content || '';
      }
      yield fullResponse;
      const duration = Date.now() - startTime;
      const executionResult: IPlaygroundExecutorResult = {
        success: true,
        response: fullResponse,
        duration,
        visualizationData: this.getVisualizationData(),
      };
      await this.recordStats({ success: true, duration, streaming: true });
      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const executionResult: IPlaygroundExecutorResult = {
        success: false,
        response: 'Streaming execution failed',
        duration,
        error: error instanceof Error ? error : new Error(String(error)),
        visualizationData: this.getVisualizationData(),
      };
      await this.recordStats({
        success: false,
        duration,
        streaming: true,
        error: error instanceof Error ? error.message : String(error),
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
    if (this.mode === 'agent' && this.currentAgent) return this.currentAgent.getHistory();
    return [];
  }

  clearHistory(): void {
    this.historyPlugin.clearEvents();
  }

  async dispose(): Promise<void> {
    try {
      if (this.currentAgent) {
        await this.currentAgent.destroy();
        this.currentAgent = undefined;
      }
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
    if (this.websocketClient) this.websocketClient.updateAuth(userId, sessionId, authToken);
  }

  isWebSocketConnected(): boolean {
    return this.websocketClient ? this.websocketClient.getStatus().connected : false;
  }

  getLastExecutionId(): string | null {
    return 'agent-execution-' + Date.now();
  }

  // ===== Private Helpers =====

  private async executeChat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
    if (this.mode === 'agent' && this.currentAgent) {
      const prompt = messages[0].content || '';
      const result = await this.currentAgent.run(prompt);
      return {
        id: randomUUID(),
        role: 'assistant' as const,
        content: result,
        state: 'complete' as const,
        timestamp: new Date(),
      };
    }
    throw new Error('No agent configured for execution');
  }

  private async *executeChatStream(
    messages: TUniversalMessage[],
  ): AsyncIterable<TUniversalMessage> {
    if (this.mode === 'agent' && this.currentAgent) {
      const prompt = messages[0].content || '';
      let fullResponse = '';
      for await (const chunk of this.currentAgent.runStream(prompt)) fullResponse += chunk;
      yield {
        id: randomUUID(),
        role: 'assistant' as const,
        content: fullResponse,
        state: 'complete' as const,
        timestamp: new Date(),
      };
    } else {
      throw new Error('No agent configured for streaming execution');
    }
  }

  private async recordStats(opts: {
    success: boolean;
    duration: number;
    streaming: boolean;
    error?: string;
  }): Promise<void> {
    await this.statisticsPlugin.recordPlaygroundExecution({
      success: opts.success,
      duration: opts.duration,
      provider: 'openai',
      model: 'gpt-4',
      mode: this.mode || 'agent',
      streaming: opts.streaming,
      timestamp: new Date(),
      error: opts.error,
    });
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`;
  }

  private createRemoteExecutor(): IExecutor {
    if (!this.serverUrl || !this.authToken)
      throw new Error('Server URL and auth token required for remote executor');
    const apiUrl = this.serverUrl.replace(/\/ws$/, '').replace(/^ws/, 'http') + '/api/v1/remote';
    return new RemoteExecutor({
      serverUrl: apiUrl,
      userApiKey: this.authToken,
      timeout: 30000,
      enableWebSocket: false,
    });
  }

  private createProvidersWithExecutor(): IAIProvider[] {
    const remoteExecutor = this.createRemoteExecutor();
    return [
      new OpenAIProvider({ executor: remoteExecutor, model: 'gpt-4o-mini' }),
      new AnthropicProvider({ executor: remoteExecutor }),
    ];
  }

  private normalizeTools(tools: IPlaygroundTool[]): FunctionTool[] {
    return tools.map((tool) =>
      tool instanceof FunctionTool ? tool : this.buildFunctionTool(tool),
    );
  }

  private buildFunctionTool(tool: IPlaygroundTool): FunctionTool {
    const schema: IToolSchema = {
      name: tool.name,
      description: tool.description || `Playground tool: ${tool.name}`,
      parameters: {
        type: 'object',
        properties: { value: { type: 'string', description: 'Value to echo' } },
      },
    };
    return new FunctionTool(
      schema,
      async (params: TToolParameters, context?: IToolExecutionContext): Promise<TUniversalValue> =>
        tool.execute(params),
    );
  }

  private setMode(mode: TPlaygroundMode): void {
    this.mode = mode;
  }
}
