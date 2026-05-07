import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider, IEventService, TUniversalMessage } from '@robota-sdk/agent-core';
import { FunctionTool } from '@robota-sdk/agent-tools';

import { createToolFromCard } from './tool-card-adapter';
import { normalizeTools } from './tool-normalization';
import type { IAgentConfigurationSnapshot, IToolCard } from './types';
import type { IPlaygroundAgentConfig, IPlaygroundTool } from '../robota-executor-types';

export class PlaygroundAgentSession {
  private currentAgent?: Robota;
  private agentRegistry: Map<string, Robota> = new Map();
  private agentToolsRegistry: Map<string, FunctionTool[]> = new Map();

  constructor(private readonly eventService: IEventService) {}

  createAgent(config: IPlaygroundAgentConfig, aiProviders: IAIProvider[]): void {
    const normalizedTools = normalizeTools(config.tools || []);
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
  }

  async updateAgentTools(agentId: string, tools: IPlaygroundTool[]): Promise<{ version: number }> {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('updateAgentTools: invalid agentId');
    }

    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`updateAgentTools: agent not found for id ${agentId}`);
    }

    const normalizedTools = normalizeTools(tools);
    const result = await agent.updateTools(normalizedTools);
    this.agentToolsRegistry.set(agentId, normalizedTools);
    return result;
  }

  async getAgentConfiguration(agentId: string): Promise<IAgentConfigurationSnapshot> {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('getAgentConfiguration: invalid agentId');
    }

    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`getAgentConfiguration: agent not found for id ${agentId}`);
    }

    return agent.getConfiguration();
  }

  async updateAgentToolsFromCard(
    agentId: string,
    card: IToolCard,
    aiProviders: IAIProvider[],
  ): Promise<{ version: number }> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`agent not found: ${agentId}`);
    }

    const newTool = createToolFromCard(card, this.eventService, aiProviders);
    const existing = this.agentToolsRegistry.get(agentId) || [];
    const nextTools = [...existing, newTool];
    const result = await agent.updateTools(nextTools);
    this.agentToolsRegistry.set(agentId, nextTools);
    return result;
  }

  async runPrompt(prompt: string, missingAgentMessage: string): Promise<string> {
    if (!this.currentAgent) {
      throw new Error(missingAgentMessage);
    }

    return this.currentAgent.run(prompt);
  }

  async *streamPrompt(prompt: string): AsyncIterable<string> {
    if (!this.currentAgent) {
      throw new Error('No agent configured for streaming execution');
    }

    for await (const chunk of this.currentAgent.runStream(prompt)) {
      yield chunk;
    }
  }

  getHistory(): TUniversalMessage[] {
    return this.currentAgent ? this.currentAgent.getHistory() : [];
  }

  async disposeCurrentAgent(): Promise<void> {
    if (!this.currentAgent) {
      return;
    }

    await this.currentAgent.destroy();
    this.currentAgent = undefined;
  }
}
