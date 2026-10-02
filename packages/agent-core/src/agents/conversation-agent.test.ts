import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConversationAgent } from '../core/conversation-agent';
import type { IAgentConfig, IRunOptions } from '../interfaces/agent';
import { AbstractAgent } from '../abstracts/abstract-agent';
import type { IAgent } from '../interfaces/agent';
import { AbstractPlugin } from '../abstracts/abstract-plugin';
import { AbstractTool as BaseTool } from '../abstracts/abstract-tool';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import type { IToolSchema, IChatOptions } from '../interfaces/provider';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../interfaces/tool';
import type { TUniversalMessage } from '../interfaces/messages';

import { ConfigurationError } from '../utils/errors';

// Mock AI Provider for testing
class MockAIProvider extends AbstractAIProvider {
  readonly name = 'mock-provider';
  readonly version = '1.0.0';

  constructor() {
    super();
  }

  async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    return {
      id: 'test-id',
      role: 'assistant',
      content: 'Mock response',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield {
      id: 'test-id',
      role: 'assistant',
      content: 'Mock response',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

// Second Mock AI Provider for multi-provider testing
class MockAIProvider2 extends AbstractAIProvider {
  readonly name = 'mock-provider-2';
  readonly version = '1.0.0';

  constructor() {
    super();
  }

  async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    return {
      id: 'test-id',
      role: 'assistant',
      content: 'Mock response from provider 2',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield {
      id: 'test-id',
      role: 'assistant',
      content: 'Mock response from provider 2',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

// Mock Tool for testing
class MockTool extends BaseTool {
  override get schema(): IToolSchema {
    return {
      name: 'mock-tool',
      description: 'Mock tool for testing',
      parameters: {
        type: 'object' as const,
        properties: {
          input: { type: 'string' as const },
        },
      },
    };
  }

  protected override async executeImpl(
    parameters: TToolParameters,
    _context: IToolExecutionContext,
  ): Promise<IToolResult> {
    const inputValue = parameters.input;
    const inputText = typeof inputValue === 'string' ? inputValue : 'no input';

    return {
      success: true,
      data: `Mock tool executed with: ${inputText}`,
    };
  }
}

// Mock Plugin for testing
class MockPlugin extends AbstractPlugin {
  override readonly name = 'mock-plugin';
  override readonly version = '1.0.0';

  override async beforeRun(input: string, _options?: IRunOptions): Promise<void> {
    // Mock hook implementation
  }

  override async afterRun(input: string, response: string, _options?: IRunOptions): Promise<void> {
    // Mock hook implementation
  }
}

describe('ConversationAgent Class - New Configuration API', () => {
  let mockProvider: MockAIProvider;
  let mockProvider2: MockAIProvider2;
  let mockTool: MockTool;
  let mockPlugin: MockPlugin;
  let config: IAgentConfig;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    mockProvider2 = new MockAIProvider2();
    mockTool = new MockTool();
    mockPlugin = new MockPlugin();

    config = {
      name: 'Test ConversationAgent',
      aiProviders: [mockProvider],
      defaultModel: {
        provider: 'mock-provider',
        model: 'mock-model',
        temperature: 0.7,
      },
      tools: [mockTool],
      plugins: [mockPlugin],
      logging: {
        level: 'silent',
        enabled: false,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('New Constructor Format', () => {
    it('should create instance with new configuration format', () => {
      const agent = new ConversationAgent(config);

      expect(agent).toBeInstanceOf(AbstractAgent);
      expect(agent).toBeInstanceOf(ConversationAgent);
      expect(agent.name).toBe('Test ConversationAgent');
    });

    it('should validate required fields', () => {
      expect(() => new ConversationAgent({} as IAgentConfig)).toThrow(ConfigurationError);

      expect(
        () =>
          new ConversationAgent({
            name: 'Test',
            aiProviders: [],
            defaultModel: {
              provider: 'test',
              model: 'test',
            },
          }),
      ).toThrow(ConfigurationError);
    });

    it('should validate AI provider existence', () => {
      expect(
        () =>
          new ConversationAgent({
            name: 'Test',
            aiProviders: [mockProvider],
            defaultModel: {
              provider: 'non-existent-provider',
              model: 'test-model',
            },
          }),
      ).toThrow(ConfigurationError);
    });

    it('should validate duplicate AI provider names', () => {
      const duplicateProvider = new MockAIProvider();

      expect(
        () =>
          new ConversationAgent({
            name: 'Test',
            aiProviders: [mockProvider, duplicateProvider],
            defaultModel: {
              provider: 'mock-provider',
              model: 'test-model',
            },
          }),
      ).toThrow(ConfigurationError);
    });

    it('should support multiple AI providers', () => {
      const multiProviderConfig: IAgentConfig = {
        name: 'Multi Provider Test',
        aiProviders: [mockProvider, mockProvider2],
        defaultModel: {
          provider: 'mock-provider',
          model: 'mock-model',
        },
      };

      const agent = new ConversationAgent(multiProviderConfig);
      expect(agent.name).toBe('Multi Provider Test');
    });
  });

  describe('Model Management - setModel() and getModel()', () => {
    it('should set and get model configuration', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent

      agent.setModel({
        provider: 'mock-provider',
        model: 'new-model',
        temperature: 0.9,
        maxTokens: 2000,
      });

      const currentModel = agent.getModel();
      expect(currentModel.provider).toBe('mock-provider');
      expect(currentModel.model).toBe('new-model');
      expect(currentModel.temperature).toBe(0.9);
      expect(currentModel.maxTokens).toBe(2000);
    });

    it('should validate provider exists when setting model', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent

      expect(() =>
        agent.setModel({
          provider: 'non-existent-provider',
          model: 'test-model',
        }),
      ).toThrow(ConfigurationError);
    });

    it('should switch between multiple providers', async () => {
      const multiProviderConfig: IAgentConfig = {
        name: 'Multi Provider Test',
        aiProviders: [mockProvider, mockProvider2],
        defaultModel: {
          provider: 'mock-provider',
          model: 'mock-model',
        },
      };

      const agent = new ConversationAgent(multiProviderConfig);
      await agent.run('initialize'); // Initialize the agent

      // Initially should be mock-provider
      expect(agent.getModel().provider).toBe('mock-provider');

      // Switch to mock-provider-2
      agent.setModel({
        provider: 'mock-provider-2',
        model: 'new-model',
      });

      expect(agent.getModel().provider).toBe('mock-provider-2');
      expect(agent.getModel().model).toBe('new-model');
    });

    it('TC-01 (PRESET-013): setModel effort is written to defaultModel.effort', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent

      agent.setModel({
        provider: 'mock-provider',
        model: 'mock-model',
        effort: 'high',
      });

      expect(agent.getConfig().defaultModel.effort).toBe('high');
    });

    it('should preserve other model settings when switching providers', async () => {
      const multiProviderConfig: IAgentConfig = {
        name: 'Multi Provider Test',
        aiProviders: [mockProvider, mockProvider2],
        defaultModel: {
          provider: 'mock-provider',
          model: 'mock-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      };

      const agent = new ConversationAgent(multiProviderConfig);
      await agent.run('initialize'); // Initialize the agent

      agent.setModel({
        provider: 'mock-provider-2',
        model: 'new-model',
        temperature: 0.9,
        maxTokens: 2000,
        topP: 0.95,
      });

      const currentModel = agent.getModel();
      expect(currentModel.provider).toBe('mock-provider-2');
      expect(currentModel.model).toBe('new-model');
      expect(currentModel.temperature).toBe(0.9);
      expect(currentModel.maxTokens).toBe(2000);
      expect(currentModel.topP).toBe(0.95);
    });
  });

  describe('Basic Architecture', () => {
    it('should extend AbstractAgent and implement IAgent', () => {
      const agent = new ConversationAgent(config);

      expect(agent).toBeInstanceOf(AbstractAgent);
      expect(agent).toBeInstanceOf(ConversationAgent);

      // Check IAgent implementation
      expect(typeof agent.run).toBe('function');
      expect(typeof agent.runStream).toBe('function');
      expect(typeof agent.getHistory).toBe('function');
      expect(typeof agent.clearHistory).toBe('function');
    });

    it('should create instance-specific managers (no singletons)', async () => {
      const agent1 = new ConversationAgent(config);
      const agent2 = new ConversationAgent({ ...config, name: 'Test ConversationAgent 2' });

      // Each instance should have independent managers
      expect(agent1).not.toBe(agent2);
      expect(agent1.name).not.toBe(agent2.name);

      // Initialize both to get stats
      await agent1.run('test');
      await agent2.run('test');

      // Verify independent conversation IDs
      const stats1 = agent1.getStats();
      const stats2 = agent2.getStats();
      expect(stats1.conversationId).not.toBe(stats2.conversationId);
    });

    it('should generate unique conversation ID', async () => {
      const agent1 = new ConversationAgent(config);
      const agent2 = new ConversationAgent(config);

      // Initialize both to get stats
      await agent1.run('test');
      await agent2.run('test');

      const stats1 = agent1.getStats();
      const stats2 = agent2.getStats();

      expect(stats1.conversationId).not.toBe(stats2.conversationId);
      expect(stats1.conversationId).toMatch(/^conv_\d+_[a-z0-9]+$/);
    });
  });

  describe('Manager Integration', () => {
    it('should register AI providers correctly', async () => {
      const agent = new ConversationAgent(config);

      // Simple test run
      const response = await agent.run('test');
      expect(response).toBe('Mock response');

      const stats = agent.getStats();
      expect(stats.providers).toContain('mock-provider');
      expect(stats.currentProvider).toBe('mock-provider');
    });

    it('should maintain conversation history', async () => {
      const agent = new ConversationAgent(config);

      await agent.run('Hello');

      const history = agent.getHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].content).toBe('Hello');
    });

    it('should clear history when requested', async () => {
      const agent = new ConversationAgent(config);

      await agent.run('Hello');
      expect(agent.getHistory().length).toBeGreaterThan(0);

      agent.clearHistory();
      expect(agent.getHistory()).toHaveLength(0);
    });
  });

  describe('Configuration Management', () => {
    it('should return current configuration', () => {
      const agent = new ConversationAgent(config);

      const currentConfig = agent.getConfig();
      expect(currentConfig.name).toBe('Test ConversationAgent');
      expect(currentConfig.defaultModel.model).toBe('mock-model');
    });

    it('should reflect model changes in configuration', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent

      agent.setModel({
        provider: 'mock-provider',
        model: 'new-model',
        temperature: 0.8,
        maxTokens: 2000,
      });

      const currentConfig = agent.getConfig();
      expect(currentConfig.defaultModel.model).toBe('new-model');
      expect(currentConfig.defaultModel.temperature).toBe(0.8);
      expect(currentConfig.defaultModel.maxTokens).toBe(2000);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide comprehensive stats after initialization', async () => {
      const agent = new ConversationAgent(config);

      // Initialize first by running
      await agent.run('test');

      const stats = agent.getStats();

      expect(stats).toHaveProperty('name');
      expect(stats).toHaveProperty('version');
      expect(stats).toHaveProperty('conversationId');
      expect(stats).toHaveProperty('providers');
      expect(stats).toHaveProperty('currentProvider');
      expect(stats).toHaveProperty('tools');
      expect(stats).toHaveProperty('plugins');
      expect(stats).toHaveProperty('historyLength');
      expect(stats).toHaveProperty('uptime');

      expect(stats.providers).toBeInstanceOf(Array);
      expect(stats.tools).toBeInstanceOf(Array);
      expect(stats.plugins).toBeInstanceOf(Array);
      expect(typeof stats.uptime).toBe('number');
    });

    it('should track uptime correctly', async () => {
      const agent = new ConversationAgent(config);

      // Initialize first
      await agent.run('test');

      const stats1 = agent.getStats();
      expect(stats1.uptime).toBeGreaterThanOrEqual(0);

      // Wait a bit more to ensure time passes
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats2 = agent.getStats();
      expect(stats2.uptime).toBeGreaterThan(stats1.uptime);
    });
  });

  describe('Resource Management', () => {
    it('should properly cleanup resources on destroy', async () => {
      const agent = new ConversationAgent(config);

      // Initialize first
      await agent.run('test');

      await agent.destroy();

      // Should not throw errors after destruction
      expect(() => agent.getConfig()).not.toThrow();
    });

    it('should handle multiple destroy calls safely', async () => {
      // HARNESS-052. This asserted `expect(true).toBe(true)` — it could only have caught a
      // synchronous throw, so a second destroy that re-ran the whole cleanup chain (double-disposing
      // every plugin) would have kept it green. Idempotency is the claim, so idempotency is what is
      // measured: the terminal-state guard in ConversationAgent.destroy() must short-circuit the second call.
      const agent = new ConversationAgent(config);
      const pluginDispose = vi.spyOn(mockPlugin, 'dispose');

      // Initialize first
      await agent.run('test');

      const first = await agent.destroy();
      const second = await agent.destroy();

      expect(first.errors).toEqual([]);
      expect(second.errors).toEqual([]);
      // The cleanup chain ran exactly once across both calls — this goes RED if the
      // `if (this.destroyed) return` guard is removed.
      expect(pluginDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty AI providers array', () => {
      expect(
        () =>
          new ConversationAgent({
            name: 'Test',
            aiProviders: [],
            defaultModel: {
              provider: 'test',
              model: 'test',
            },
          }),
      ).toThrow(ConfigurationError);
    });

    it('should handle missing required model fields', () => {
      expect(
        () =>
          new ConversationAgent({
            name: 'Test',
            aiProviders: [mockProvider],
            defaultModel: {
              provider: 'mock-provider',
            } as any,
          }),
      ).toThrow(ConfigurationError);
    });

    it('should handle setModel with missing required fields', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent

      expect(() =>
        agent.setModel({
          provider: 'mock-provider',
        } as any),
      ).toThrow(ConfigurationError);
    });

    it('should preserve original config when setModel fails', async () => {
      const agent = new ConversationAgent(config);
      await agent.run('initialize'); // Initialize the agent
      const originalModel = agent.getModel();

      expect(() =>
        agent.setModel({
          provider: 'non-existent-provider',
          model: 'test-model',
        }),
      ).toThrow(ConfigurationError);

      // Original model should be preserved
      const currentModel = agent.getModel();
      expect(currentModel).toEqual(originalModel);
    });
  });
});
