import { describe, it, expect, vi } from 'vitest';
import { callPluginHook, type TPluginWithHooks } from './plugin-hook-dispatcher';
import type { ILogger } from '../utils/logger';

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createMockPlugin(overrides: Partial<TPluginWithHooks> = {}): TPluginWithHooks {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    category: 'monitoring' as any,
    priority: 0 as any,
    getStatus: vi.fn().mockReturnValue({ name: 'test-plugin', enabled: true, initialized: true }),
    initialize: vi.fn(),
    dispose: vi.fn(),
    beforeRun: vi.fn(),
    afterRun: vi.fn(),
    onError: vi.fn(),
    beforeProviderCall: vi.fn(),
    afterProviderCall: vi.fn(),
    ...overrides,
  } as any;
}

describe('callPluginHook', () => {
  const logger = createMockLogger();

  it('calls beforeRun on plugins with input', async () => {
    const plugin = createMockPlugin();
    await callPluginHook([plugin], 'beforeRun', { input: 'hello' }, logger);
    expect(plugin.beforeRun).toHaveBeenCalledWith('hello', undefined);
  });

  it('calls afterRun on plugins with input and response', async () => {
    const plugin = createMockPlugin();
    await callPluginHook([plugin], 'afterRun', { input: 'hello', response: 'world' }, logger);
    expect(plugin.afterRun).toHaveBeenCalledWith('hello', 'world', undefined);
  });

  it('calls beforeProviderCall with messages', async () => {
    const plugin = createMockPlugin();
    const messages = [
      {
        id: 'msg-1',
        role: 'user' as const,
        content: 'test',
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ];
    await callPluginHook([plugin], 'beforeProviderCall', { messages }, logger);
    expect(plugin.beforeProviderCall).toHaveBeenCalledWith(messages);
  });

  it('calls afterProviderCall with messages and responseMessage', async () => {
    const plugin = createMockPlugin();
    const messages = [
      {
        id: 'msg-1',
        role: 'user' as const,
        content: 'test',
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ];
    const responseMessage = {
      id: 'msg-2',
      role: 'assistant' as const,
      content: 'reply',
      state: 'complete' as const,
      timestamp: new Date(),
    };
    await callPluginHook([plugin], 'afterProviderCall', { messages, responseMessage }, logger);
    expect(plugin.afterProviderCall).toHaveBeenCalledWith(messages, responseMessage);
  });

  it('calls onError with error', async () => {
    const plugin = createMockPlugin();
    const error = new Error('test error');
    await callPluginHook([plugin], 'onError', { error }, logger);
    expect(plugin.onError).toHaveBeenCalled();
  });

  it('skips unknown hook names without error', async () => {
    const plugin = createMockPlugin();
    await expect(callPluginHook([plugin], 'unknownHook', {}, logger)).resolves.toBeUndefined();
  });

  it('continues executing remaining plugins when one throws', async () => {
    const failPlugin = createMockPlugin({
      beforeRun: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const successPlugin = createMockPlugin();
    await callPluginHook([failPlugin, successPlugin], 'beforeRun', { input: 'test' }, logger);
    expect(successPlugin.beforeRun).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not call beforeRun when input is missing', async () => {
    const plugin = createMockPlugin();
    await callPluginHook([plugin], 'beforeRun', {}, logger);
    expect(plugin.beforeRun).not.toHaveBeenCalled();
  });

  it('calls onError with execution context fields', async () => {
    const plugin = createMockPlugin();
    const error = new Error('err');
    await callPluginHook(
      [plugin],
      'onError',
      {
        error,
        executionContext: { executionId: 'exec-1', sessionId: 'sess-1', userId: 'user-1' },
      },
      logger,
    );
    expect(plugin.onError).toHaveBeenCalled();
    const callArgs = (plugin.onError as any).mock.calls[0];
    expect(callArgs[0]).toBe(error);
    expect(callArgs[1].executionId).toBe('exec-1');
    expect(callArgs[1].sessionId).toBe('sess-1');
    expect(callArgs[1].userId).toBe('user-1');
  });
});

describe('PLG-020 (issue #2460): execution-level hooks are dispatched', () => {
  const logger = createMockLogger();
  const executionContext = { executionId: 'exec-1', sessionId: 'sess-1' };
  const executionResult = {
    response: 'ok',
    duration: 5,
    tokensUsed: 7,
    success: true,
    toolCalls: [{ name: 'Read' }],
  };

  it('beforeExecution receives ids and messages as an IPluginExecutionContext', async () => {
    const plugin = createMockPlugin({ beforeExecution: vi.fn() });
    const messages = [{ role: 'user', content: 'hi' }] as any;
    await callPluginHook([plugin], 'beforeExecution', { messages, executionContext }, logger);
    expect(plugin.beforeExecution).toHaveBeenCalledWith({
      executionId: 'exec-1',
      sessionId: 'sess-1',
      messages,
    });
  });

  it('afterExecution and afterConversation receive the run result', async () => {
    const plugin = createMockPlugin({ afterExecution: vi.fn(), afterConversation: vi.fn() });
    await callPluginHook([plugin], 'afterExecution', { executionContext, executionResult }, logger);
    await callPluginHook(
      [plugin],
      'afterConversation',
      { executionContext, executionResult },
      logger,
    );
    expect(plugin.afterExecution).toHaveBeenCalledWith(
      { executionId: 'exec-1', sessionId: 'sess-1' },
      executionResult,
    );
    expect(plugin.afterConversation).toHaveBeenCalledWith(
      { executionId: 'exec-1', sessionId: 'sess-1' },
      executionResult,
    );
  });

  it('afterToolExecution fires only when a tool ran', async () => {
    const plugin = createMockPlugin({ afterToolExecution: vi.fn() });
    await callPluginHook(
      [plugin],
      'afterToolExecution',
      { executionContext, executionResult: { ...executionResult, toolCalls: [] } },
      logger,
    );
    expect(plugin.afterToolExecution).not.toHaveBeenCalled();
    await callPluginHook(
      [plugin],
      'afterToolExecution',
      { executionContext, executionResult },
      logger,
    );
    expect(plugin.afterToolExecution).toHaveBeenCalledTimes(1);
  });

  it('onMessageAdded receives the appended message', async () => {
    const plugin = createMockPlugin({ onMessageAdded: vi.fn() });
    const message = { role: 'assistant', content: 'hello' } as any;
    await callPluginHook([plugin], 'onMessageAdded', { message }, logger);
    expect(plugin.onMessageAdded).toHaveBeenCalledWith(message);
    await callPluginHook([plugin], 'onMessageAdded', {}, logger);
    expect(plugin.onMessageAdded).toHaveBeenCalledTimes(1);
  });
});
