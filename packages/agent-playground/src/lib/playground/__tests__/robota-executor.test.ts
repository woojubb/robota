import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundExecutor } from '../robota-executor';
import type { IPlaygroundAgentConfig, IPlaygroundTool } from '../robota-executor';

const sdkMocks = vi.hoisted(() => ({
  robotaInstances: [] as Array<{
    config: {
      name: string;
      defaultModel: { provider: string; model: string };
      tools: unknown[];
    };
    run: ReturnType<typeof vi.fn>;
    runStream: ReturnType<typeof vi.fn>;
    updateTools: ReturnType<typeof vi.fn>;
    getConfiguration: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const providerMocks = vi.hoisted(() => ({
  openAiConfigs: [] as unknown[],
  anthropicConfigs: [] as unknown[],
  remoteExecutorConfigs: [] as unknown[],
}));

const toolMocks = vi.hoisted(() => {
  class MockFunctionTool {
    readonly schema: unknown;
    readonly handler: (params: unknown, context?: unknown) => Promise<unknown>;

    constructor(
      schema: unknown,
      handler: (params: unknown, context?: unknown) => Promise<unknown>,
    ) {
      this.schema = schema;
      this.handler = handler;
    }
  }

  return { MockFunctionTool };
});

vi.mock('@robota-sdk/agent-core', () => ({
  Robota: vi.fn(
    (config: {
      name: string;
      defaultModel: { provider: string; model: string };
      tools: unknown[];
    }) => {
      const instance = {
        config,
        run: vi.fn(async (prompt: string) => `response:${prompt}`),
        runStream: vi.fn(async function* (prompt: string) {
          yield `stream:${prompt}`;
        }),
        updateTools: vi.fn(async () => ({ version: 2 })),
        getConfiguration: vi.fn(() => ({
          version: 1,
          tools: [],
          updatedAt: 123,
        })),
        getHistory: vi.fn(() => []),
        destroy: vi.fn(async () => undefined),
      };
      sdkMocks.robotaInstances.push(instance);
      return instance;
    },
  ),
  SilentLogger: sdkMocks.logger,
}));

vi.mock('@robota-sdk/agent-provider-openai', () => ({
  OpenAIProvider: vi.fn((config: unknown) => {
    providerMocks.openAiConfigs.push(config);
    return { provider: 'openai', config };
  }),
}));

vi.mock('@robota-sdk/agent-provider-anthropic', () => ({
  AnthropicProvider: vi.fn((config: unknown) => {
    providerMocks.anthropicConfigs.push(config);
    return { provider: 'anthropic', config };
  }),
}));

vi.mock('@robota-sdk/agent-remote-client', () => ({
  RemoteExecutor: vi.fn((config: unknown) => {
    providerMocks.remoteExecutorConfigs.push(config);
    return { kind: 'remote-executor', config };
  }),
}));

vi.mock('@robota-sdk/agent-tools', () => ({
  FunctionTool: toolMocks.MockFunctionTool,
}));

function createExecutor(): PlaygroundExecutor {
  return new PlaygroundExecutor('ws://api.example.test/ws', 'token-1', {
    eventService: {},
    logger: sdkMocks.logger,
  });
}

function createConfig(tools: IPlaygroundTool[] = []): IPlaygroundAgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    aiProviders: [],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    tools,
  };
}

describe('PlaygroundExecutor', () => {
  beforeEach(() => {
    sdkMocks.robotaInstances.length = 0;
    providerMocks.openAiConfigs.length = 0;
    providerMocks.anthropicConfigs.length = 0;
    providerMocks.remoteExecutorConfigs.length = 0;
    sdkMocks.logger.debug.mockClear();
    sdkMocks.logger.error.mockClear();
  });

  it('creates agents with remote provider executors and normalized tools', async () => {
    const tool: IPlaygroundTool = {
      name: 'echo',
      description: 'Echo input',
      execute: vi.fn(async (params) => params),
    };
    const executor = createExecutor();

    await executor.createAgent(createConfig([tool]));

    expect(providerMocks.remoteExecutorConfigs).toEqual([
      {
        serverUrl: 'http://api.example.test/api/v1/remote',
        userApiKey: 'token-1',
        timeout: 30000,
        enableWebSocket: false,
      },
    ]);
    expect(providerMocks.openAiConfigs).toHaveLength(1);
    expect(providerMocks.anthropicConfigs).toHaveLength(1);
    expect(sdkMocks.robotaInstances).toHaveLength(1);
    expect(sdkMocks.robotaInstances[0]?.config).toMatchObject({
      name: 'Test Agent',
      defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
    });
    expect(sdkMocks.robotaInstances[0]?.config.tools[0]).toBeInstanceOf(toolMocks.MockFunctionTool);
    expect(executor.getPlaygroundStatistics().uiInteractions).toBe(1);
  });

  it('returns successful run results and records execution metrics', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    const result = await executor.run('hello');

    expect(sdkMocks.robotaInstances[0]?.run).toHaveBeenCalledWith('hello');
    expect(result).toMatchObject({
      success: true,
      response: 'response:hello',
      uiError: undefined,
    });
    expect(executor.getPlaygroundStatistics()).toMatchObject({
      totalChatExecutions: 1,
      agentModeExecutions: 1,
      errorCount: 0,
    });
  });

  it('returns UI-classified failures when no agent is configured', async () => {
    const executor = createExecutor();

    const result = await executor.run('hello');

    expect(result).toMatchObject({
      success: false,
      response: 'Execution failed',
      uiError: {
        kind: 'recoverable',
        message: 'No agent configured for execution',
      },
    });
    expect(result.error?.message).toBe('No agent configured for execution');
  });

  it('executes direct prompts with optional chunks', async () => {
    const onChunk = vi.fn();
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    const result = await executor.execute('direct', onChunk);

    expect(sdkMocks.robotaInstances[0]?.run).toHaveBeenCalledWith('direct');
    expect(onChunk).toHaveBeenCalledWith('response:direct');
    expect(result).toMatchObject({
      success: true,
      response: 'response:direct',
    });
  });

  it('updates and reads agent tool configuration', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    const result = await executor.updateAgentTools('agent-1', [
      {
        name: 'later',
        description: 'Later tool',
        execute: vi.fn(async () => 'ok'),
      },
    ]);
    const configuration = await executor.getAgentConfiguration('agent-1');

    expect(result).toEqual({ version: 2 });
    expect(sdkMocks.robotaInstances[0]?.updateTools).toHaveBeenCalledWith([
      expect.any(toolMocks.MockFunctionTool),
    ]);
    expect(configuration).toEqual({
      version: 1,
      tools: [],
      updatedAt: 123,
    });
  });

  it('rejects remote provider creation without server URL and auth token', async () => {
    const executor = new PlaygroundExecutor('', '', {
      eventService: {},
      logger: sdkMocks.logger,
    });

    await expect(executor.createAgent(createConfig())).rejects.toThrow(
      'Server URL and auth token required for remote executor',
    );
  });

  it('disposes the current agent and clears history resources', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.dispose();

    expect(sdkMocks.robotaInstances[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(sdkMocks.logger.debug).toHaveBeenCalledWith('PlaygroundHistoryPlugin disposed');
  });
});
