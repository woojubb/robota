import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  IConversationEvent,
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  IVisualizationData,
} from '../../lib/playground/robota-executor';
import {
  PlaygroundProvider,
  usePlayground,
  usePlaygroundActions,
  usePlaygroundState,
} from '../playground-context';

const executorMocks = vi.hoisted(() => {
  interface IExecutorConstruction {
    serverUrl: string;
    authToken: string;
    options: object;
  }

  const instances: MockPlaygroundExecutor[] = [];
  const constructionState = {
    throwOnConstruct: false,
  };

  class MockPlaygroundExecutor {
    readonly construction: IExecutorConstruction;
    readonly createAgent = vi.fn(async () => undefined);
    readonly run = vi.fn(async () => ({
      success: true,
      response: 'run-response',
      duration: 42,
    }));
    readonly execute = vi.fn(async (_prompt: string, onChunk: (chunk: string) => void) => {
      onChunk('stream-chunk');
      return {
        success: true,
        response: 'stream-response',
        duration: 55,
      };
    });
    readonly clearHistory = vi.fn();
    readonly updateAuth = vi.fn();
    readonly dispose = vi.fn(async () => undefined);
    readonly isWebSocketConnected = vi.fn(() => false);
    readonly getVisualizationData = vi.fn(() => ({ events: [], agents: [] }));
    readonly getPlaygroundEvents = vi.fn(() => []);
    readonly recordPlaygroundAction = vi.fn(async () => undefined);
    readonly getHistory = vi.fn(() => []);

    constructor(serverUrl: string, authToken: string, options: object) {
      if (constructionState.throwOnConstruct) {
        throw new Error('constructor failed');
      }
      this.construction = { serverUrl, authToken, options };
      instances.push(this);
    }
  }

  return {
    MockPlaygroundExecutor,
    constructionState,
    instances,
  };
});

const eventServiceMocks = vi.hoisted(() => ({
  DefaultEventService: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('../../lib/playground/robota-executor', () => ({
  PlaygroundExecutor: executorMocks.MockPlaygroundExecutor,
}));

vi.mock('@robota-sdk/agent-event-service', () => ({
  DefaultEventService: eventServiceMocks.DefaultEventService,
}));

vi.mock('@robota-sdk/agent-core', () => ({
  SilentLogger: loggerMocks,
}));

const agentConfig: IPlaygroundAgentConfig = {
  id: 'agent-1',
  name: 'Planner',
  aiProviders: [],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o-mini',
  },
  tools: [],
  plugins: [],
};

const conversationEvent: IConversationEvent = {
  id: 'event-1',
  type: 'assistant_response',
  content: 'hello',
  timestamp: new Date('2026-05-05T00:00:00.000Z'),
  parentEventId: undefined,
  childEventIds: [],
  executionLevel: 0,
  executionPath: 'basic',
  metadata: {},
};

const visualizationData: IVisualizationData = {
  events: [conversationEvent],
  agents: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <PlaygroundProvider defaultServerUrl="ws://playground.example.test">
      {children}
    </PlaygroundProvider>
  );
}

async function renderPlayground() {
  const hook = renderHook(
    () => ({
      state: usePlaygroundState(),
      actions: usePlaygroundActions(),
    }),
    { wrapper },
  );

  await waitFor(() => expect(hook.result.current.state.isInitialized).toBe(true));
  return hook;
}

function latestExecutor() {
  const executor = executorMocks.instances.at(-1);
  if (!executor) {
    throw new Error('Expected a mock executor instance');
  }
  return executor;
}

describe('PlaygroundProvider', () => {
  beforeEach(() => {
    executorMocks.instances.length = 0;
    executorMocks.constructionState.throwOnConstruct = false;
    eventServiceMocks.DefaultEventService.mockClear();
    loggerMocks.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires playground hooks to be rendered below the provider', () => {
    expect(() => renderHook(() => usePlaygroundState())).toThrow(
      'usePlaygroundState must be used within a PlaygroundProvider',
    );
    expect(() => renderHook(() => usePlaygroundActions())).toThrow(
      'usePlaygroundActions must be used within a PlaygroundProvider',
    );
  });

  it('initializes an executor from the default server URL and exposes split contexts', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();

    expect(executor.construction.serverUrl).toBe('ws://playground.example.test');
    expect(executor.construction.authToken).toBe('dev.playground.token');
    expect(eventServiceMocks.DefaultEventService).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.serverUrl).toBe('ws://playground.example.test');
    expect(hook.result.current.actions.getConnectionStatus()).toEqual({
      connected: false,
      url: 'ws://playground.example.test',
    });

    act(() => {
      hook.unmount();
    });

    expect(executor.dispose).toHaveBeenCalledTimes(1);
  });

  it('records constructor failures in provider state', async () => {
    executorMocks.constructionState.throwOnConstruct = true;

    const hook = renderHook(() => usePlaygroundState(), { wrapper });

    await waitFor(() => expect(hook.result.current.error).toBe('constructor failed'));
    expect(hook.result.current.isInitialized).toBe(false);
  });

  it('creates agents and stores the current agent configuration', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();

    await act(async () => {
      await hook.result.current.actions.createAgent(agentConfig);
    });

    expect(executor.createAgent).toHaveBeenCalledWith(agentConfig);
    expect(hook.result.current.state.currentAgentConfig).toBe(agentConfig);
    expect(hook.result.current.state.agentConfigs).toEqual([agentConfig]);
    expect(hook.result.current.state.isLoading).toBe(false);
  });

  it('returns an error result and stores error state when prompt execution fails', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();
    executor.run.mockRejectedValueOnce(new Error('run failed'));

    let result: IPlaygroundExecutorResult | null = null;
    await act(async () => {
      result = await hook.result.current.actions.executePrompt('hello');
    });

    expect(result).toMatchObject({
      success: false,
      response: 'Execution failed',
      duration: 0,
      uiError: {
        kind: 'recoverable',
        message: 'run failed',
      },
    });
    expect(hook.result.current.state.error).toBe('run failed');
    expect(hook.result.current.state.isExecuting).toBe(false);
  });

  it('executes prompts, records truncated prompt metadata, and updates history data', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();
    executor.getPlaygroundEvents.mockReturnValueOnce([conversationEvent]);
    executor.getVisualizationData.mockReturnValueOnce(visualizationData);
    const longPrompt = 'x'.repeat(120);

    await act(async () => {
      await hook.result.current.actions.executePrompt(longPrompt);
    });

    expect(executor.run).toHaveBeenCalledWith(longPrompt);
    expect(executor.recordPlaygroundAction).toHaveBeenCalledWith('chat_send', {
      prompt: 'x'.repeat(100),
      mode: 'agent',
    });
    expect(hook.result.current.state.conversationHistory).toEqual([conversationEvent]);
    expect(hook.result.current.state.visualizationData).toEqual(visualizationData);
    expect(hook.result.current.state.lastExecutionResult).toMatchObject({
      success: true,
      response: 'run-response',
    });
  });

  it('streams prompt chunks through the executor action', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();
    const chunks: string[] = [];

    const result = await act(async () =>
      hook.result.current.actions.executeStreamPrompt('stream prompt', (chunk) => {
        chunks.push(chunk);
      }),
    );

    expect(executor.execute).toHaveBeenCalledWith('stream prompt', expect.any(Function));
    expect(chunks).toEqual(['stream-chunk']);
    expect(result).toMatchObject({
      success: true,
      response: 'stream-response',
    });
  });

  it('updates auth, tool overlays, and clears executor history', async () => {
    const hook = await renderPlayground();
    const executor = latestExecutor();

    await act(async () => {
      await hook.result.current.actions.executePrompt('hello');
    });

    act(() => {
      hook.result.current.actions.setAuth('user-1', 'session-1', 'token-1');
      hook.result.current.actions.setToolItems([{ id: 'tool-1', name: 'Tool One' }]);
      hook.result.current.actions.addToolToAgentOverlay('agent-1', 'tool-1');
      hook.result.current.actions.clearHistory();
    });

    expect(executor.updateAuth).toHaveBeenCalledWith('user-1', 'session-1', 'token-1');
    expect(executor.clearHistory).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({
      userId: 'user-1',
      sessionId: 'session-1',
      authToken: 'token-1',
      conversationHistory: [],
      lastExecutionResult: null,
      toolItems: [{ id: 'tool-1', name: 'Tool One' }],
      addedToolsByAgent: { 'agent-1': ['tool-1'] },
    });
  });

  it('keeps the deprecated combined hook value available', async () => {
    const hook = renderHook(() => usePlayground(), { wrapper });

    await waitFor(() => expect(hook.result.current.state.isInitialized).toBe(true));

    expect(hook.result.current.state.serverUrl).toBe('ws://playground.example.test');
    expect(typeof hook.result.current.executePrompt).toBe('function');
  });
});
