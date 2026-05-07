import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPlaygroundState } from '../../contexts/playground-context';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
} from '../../lib/playground/robota-executor';
import { useRobotaExecution } from '../use-robota-execution';

const playgroundMocks = vi.hoisted(() => ({
  state: {
    executor: null,
    isInitialized: true,
    isExecuting: false,
    mode: 'agent',
    currentAgentConfig: null,
    agentConfigs: [],
    conversationHistory: [],
    lastExecutionResult: null,
    isWebSocketConnected: false,
    serverUrl: '',
    authToken: null,
    userId: null,
    sessionId: null,
    isLoading: false,
    error: null,
    visualizationData: null,
    executionStats: {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      lastExecutionTime: null,
      blockCreations: 0,
      uiInteractions: 0,
      streamingExecutions: 0,
      agentModeExecutions: 0,
      successRate: 100,
    },
    toolItems: [],
    addedToolsByAgent: {},
  },
  createAgent: vi.fn(async () => undefined),
  executePrompt: vi.fn(async (prompt: string) => ({
    success: true,
    response: `response:${prompt}`,
    duration: 100,
  })),
  executeStreamPrompt: vi.fn(async (prompt: string, onChunk: (chunk: string) => void) => {
    onChunk('hel');
    onChunk('lo');
    return {
      success: true,
      response: `stream:${prompt}`,
      duration: 120,
    };
  }),
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../contexts/playground-context', () => ({
  usePlaygroundState: () => playgroundMocks.state,
  usePlaygroundActions: () => ({
    createAgent: playgroundMocks.createAgent,
    executePrompt: playgroundMocks.executePrompt,
    executeStreamPrompt: playgroundMocks.executeStreamPrompt,
  }),
}));

vi.mock('../../lib/web-logger', () => ({
  WebLogger: loggerMocks,
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

function createState(overrides: Partial<IPlaygroundState> = {}): IPlaygroundState {
  return {
    executor: null,
    isInitialized: true,
    isExecuting: false,
    mode: 'agent',
    currentAgentConfig: agentConfig,
    agentConfigs: [agentConfig],
    conversationHistory: [],
    lastExecutionResult: null,
    isWebSocketConnected: false,
    serverUrl: '',
    authToken: null,
    userId: null,
    sessionId: null,
    isLoading: false,
    error: null,
    visualizationData: null,
    executionStats: {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      lastExecutionTime: null,
      blockCreations: 0,
      uiInteractions: 0,
      streamingExecutions: 0,
      agentModeExecutions: 0,
      successRate: 100,
    },
    toolItems: [],
    addedToolsByAgent: {},
    ...overrides,
  };
}

function result(overrides: Partial<IPlaygroundExecutorResult> = {}): IPlaygroundExecutorResult {
  return {
    success: true,
    response: 'ok',
    duration: 100,
    ...overrides,
  };
}

function resetMocks(overrides: Partial<IPlaygroundState> = {}): void {
  Object.assign(playgroundMocks.state, createState(overrides));
  playgroundMocks.createAgent.mockClear();
  playgroundMocks.executePrompt.mockClear();
  playgroundMocks.executePrompt.mockImplementation(async (prompt: string) => ({
    success: true,
    response: `response:${prompt}`,
    duration: 100,
  }));
  playgroundMocks.executeStreamPrompt.mockClear();
  playgroundMocks.executeStreamPrompt.mockImplementation(
    async (prompt: string, onChunk: (chunk: string) => void) => {
      onChunk('hel');
      onChunk('lo');
      return {
        success: true,
        response: `stream:${prompt}`,
        duration: 120,
      };
    },
  );
  loggerMocks.debug.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.error.mockClear();
}

describe('useRobotaExecution', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns derived execution state and configuration helpers', () => {
    const { result: hook } = renderHook(() => useRobotaExecution());

    expect(hook.current).toMatchObject({
      executionState: 'idle',
      isExecuting: false,
      isStreaming: false,
      canExecute: true,
      currentAgentConfig: agentConfig,
      currentMode: 'agent',
      totalExecutions: 0,
      successRate: 0,
    });

    expect(hook.current.getDefaultAgentConfig()).toMatchObject({
      name: 'New Agent',
      defaultModel: {
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
      tools: [],
      plugins: [],
    });
    expect(
      hook.current.validateConfiguration({ ...agentConfig, name: '', aiProviders: [] }),
    ).toEqual({
      isValid: false,
      errors: ['Name is required', 'At least one AI provider is required'],
    });
  });

  it('blocks prompt execution when the playground is not ready', async () => {
    resetMocks({ isInitialized: false });
    const { result: hook } = renderHook(() => useRobotaExecution());

    await expect(hook.current.executePrompt('run')).rejects.toThrow(
      'Cannot execute: executor not ready or already running',
    );

    expect(playgroundMocks.executePrompt).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith('executePrompt blocked', {
      error: 'Cannot execute: executor not ready or already running',
    });
  });

  it('creates agents and records creation failures', async () => {
    const { result: hook } = renderHook(() => useRobotaExecution());

    await act(async () => {
      await hook.current.createAgent(agentConfig);
    });

    expect(playgroundMocks.createAgent).toHaveBeenCalledWith(agentConfig);
    expect(hook.current.executionState).toBe('idle');
    expect(hook.current.lastError).toBeNull();

    const createError = new Error('create failed');
    playgroundMocks.createAgent.mockRejectedValueOnce(createError);

    await act(async () => {
      await expect(hook.current.createAgent(agentConfig)).rejects.toThrow('create failed');
    });

    expect(hook.current.executionState).toBe('error');
    expect(hook.current.lastError).toBe(createError);
    expect(hook.current.errorCount).toBe(1);
    expect(loggerMocks.error).toHaveBeenCalledWith('createAgent error', {
      error: 'create failed',
    });
  });

  it('executes prompts and retries the last prompt', async () => {
    const { result: hook } = renderHook(() => useRobotaExecution());

    let promptResult: IPlaygroundExecutorResult | undefined;
    await act(async () => {
      promptResult = await hook.current.executePrompt('run this');
    });

    expect(promptResult).toMatchObject({
      success: true,
      response: 'response:run this',
    });
    expect(hook.current.executionState).toBe('completed');

    await act(async () => {
      await hook.current.retryLastExecution();
    });

    expect(playgroundMocks.executePrompt).toHaveBeenNthCalledWith(1, 'run this');
    expect(playgroundMocks.executePrompt).toHaveBeenNthCalledWith(2, 'run this');
  });

  it('streams prompt chunks into local streaming state', async () => {
    const onChunk = vi.fn();
    const { result: hook } = renderHook(() => useRobotaExecution());

    let streamResult: IPlaygroundExecutorResult | undefined;
    await act(async () => {
      streamResult = await hook.current.executeStreamPrompt('stream this', onChunk);
    });

    expect(streamResult).toMatchObject({
      response: 'stream:stream this',
    });
    expect(hook.current.executionState).toBe('completed');
    expect(hook.current.streamingResponse).toBe('hello');
    expect(onChunk).toHaveBeenNthCalledWith(1, 'hel');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo');

    act(() => {
      hook.current.clearStreamingResponse();
    });

    expect(hook.current.streamingResponse).toBe('');
  });

  it('collects context execution results and calculates history metrics', async () => {
    const { result: hook, rerender } = renderHook(() => useRobotaExecution());

    act(() => {
      playgroundMocks.state.lastExecutionResult = result({
        success: true,
        response: 'first',
        duration: 100,
      });
      rerender();
    });

    await waitFor(() => {
      expect(hook.current.executionHistory).toHaveLength(1);
    });

    act(() => {
      playgroundMocks.state.lastExecutionResult = result({
        success: false,
        response: 'second',
        duration: 300,
        error: new Error('failed'),
      });
      rerender();
    });

    await waitFor(() => {
      expect(hook.current.executionHistory).toHaveLength(2);
    });

    expect(hook.current).toMatchObject({
      totalExecutions: 2,
      averageExecutionTime: 200,
      successRate: 50,
      errorCount: 1,
    });
    expect(hook.current.lastError?.message).toBe('failed');

    act(() => {
      playgroundMocks.state.lastExecutionResult = null;
      hook.current.clearExecutionHistory();
      rerender();
    });

    expect(hook.current.executionHistory).toEqual([]);
    expect(hook.current.errorCount).toBe(0);
  });
});
