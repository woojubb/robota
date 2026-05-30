import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createInteractiveRuntime } from '../createInteractiveRuntime.js';
import { MockInteractionChannel } from './MockInteractionChannel.js';

import type { IInteractiveSession } from '../../interactive/i-interactive-session.js';
import type { ICommandModule } from '../../command-api/command-module.js';
import type { ICommandListEntry } from '../../commands/index.js';
import type { IInteractiveSessionEvents, TInteractiveEventName } from '../../interactive/types.js';

type Handler = IInteractiveSessionEvents[TInteractiveEventName];

function createMockSession(overrides: Partial<IInteractiveSession> = {}): IInteractiveSession & {
  emitEvent<E extends TInteractiveEventName>(
    event: E,
    ...args: Parameters<IInteractiveSessionEvents[E]>
  ): void;
} {
  const listeners: Partial<Record<TInteractiveEventName, Handler[]>> = {};

  const session: IInteractiveSession = {
    isInitialized: true,
    submit: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 0,
      usedTokens: 0,
      maxTokens: 0,
      remainingPercentage: 100,
    }),
    getSession: vi.fn().mockReturnValue({ getSessionId: () => 'test-id' }),
    getCwd: vi.fn().mockReturnValue('/tmp'),
    executeCommand: vi.fn().mockResolvedValue(null),
    listCommands: vi.fn().mockReturnValue([] as ICommandListEntry[]),
    on: vi.fn((event: TInteractiveEventName, handler: Handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(handler);
    }),
    off: vi.fn((event: TInteractiveEventName, handler: Handler) => {
      const arr = listeners[event];
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
      }
    }),
    listBackgroundTasks: vi.fn().mockReturnValue([]),
    getBackgroundTask: vi.fn().mockReturnValue(undefined),
    cancelBackgroundTask: vi.fn().mockResolvedValue(undefined),
    closeBackgroundTask: vi.fn().mockResolvedValue(undefined),
    sendBackgroundTask: vi.fn().mockResolvedValue(undefined),
    readBackgroundTaskLog: vi.fn().mockResolvedValue({ entries: [], cursor: null }),
    listBackgroundJobGroups: vi.fn().mockReturnValue([]),
    getBackgroundJobGroup: vi.fn().mockReturnValue(undefined),
    createBackgroundJobGroup: vi.fn().mockReturnValue({ groupId: 'g1', jobs: [] }),
    waitBackgroundJobGroup: vi.fn().mockResolvedValue({ groupId: 'g1', jobs: [] }),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ files: [] }),
    listAgentDefinitions: vi.fn().mockReturnValue([]),
    listAgentJobs: vi.fn().mockReturnValue([]),
    spawnAgentJob: vi.fn().mockResolvedValue({ jobId: 'j1' }),
    sendAgentJob: vi.fn().mockResolvedValue(undefined),
    cancelAgentJob: vi.fn().mockResolvedValue(undefined),
    closeAgentJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return Object.assign(session, {
    emitEvent<E extends TInteractiveEventName>(
      event: E,
      ...args: Parameters<IInteractiveSessionEvents[E]>
    ): void {
      const handlers = listeners[event] ?? [];
      for (const h of handlers) {
        (h as (...a: unknown[]) => void)(...args);
      }
    },
  });
}

function makeCommandModule(
  name: string,
  hints?: ICommandModule['interactionHints'],
): ICommandModule {
  return {
    name,
    interactionHints: hints,
  };
}

describe('createInteractiveRuntime', () => {
  let channel: MockInteractionChannel;
  let session: ReturnType<typeof createMockSession>;

  beforeEach(() => {
    channel = new MockInteractionChannel();
    session = createMockSession();
  });

  it('Given runtime started When channel.start() called Then channel.started is true', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });

    await runtime.start();

    expect(channel.started).toBe(true);
  });

  it('Given commands registered When started Then channel receives available commands', async () => {
    vi.mocked(session.listCommands).mockReturnValue([
      { name: 'help', description: 'Show help' },
      { name: 'exit', description: 'Exit' },
    ]);

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    expect(channel.availableCommands).toEqual([
      { name: 'help', description: 'Show help' },
      { name: 'exit', description: 'Exit' },
    ]);
  });

  it('Given user message submitted Then session.submit called and user-message event written', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('hello world');

    expect(session.submit).toHaveBeenCalledWith('hello world');
    expect(channel.events[0]).toEqual({ type: 'user-message', text: 'hello world' });
    expect(channel.busyState).toBe(true);
  });

  it('Given slash command with no hint When submitted Then executeCommand called directly', async () => {
    vi.mocked(session.executeCommand).mockResolvedValue({
      message: 'ok',
      success: true,
    });
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('/help');

    expect(session.executeCommand).toHaveBeenCalledWith('help', '');
    expect(channel.events[0]).toEqual({ type: 'command-result', name: 'help', output: 'ok' });
  });

  it('Given slash command with pick hint When submitted Then requestAction called and arg resolved', async () => {
    channel.setActionResponse({ type: 'pick', item: { label: 'Plan', value: 'plan' } });
    vi.mocked(session.executeCommand).mockResolvedValue({ message: 'switched', success: true });

    const mod = makeCommandModule('mode', {
      mode: {
        type: 'pick',
        getItems: () => [{ label: 'Plan', value: 'plan' }],
      },
    });

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [mod],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('/mode');

    expect(channel.requestAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pick', id: 'mode' }),
    );
    expect(session.executeCommand).toHaveBeenCalledWith('mode', 'plan');
  });

  it('Given slash command with confirm hint cancelled When submitted Then executeCommand not called', async () => {
    channel.setActionResponse({ type: 'cancelled' });

    const mod = makeCommandModule('exit', {
      exit: { type: 'confirm', message: 'Exit?' },
    });

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [mod],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('/exit');

    expect(session.executeCommand).not.toHaveBeenCalled();
  });

  it('Given slash command with args already present When submitted Then no requestAction, direct execute', async () => {
    channel.setActionResponse({ type: 'cancelled' });
    vi.mocked(session.executeCommand).mockResolvedValue({ message: 'ok', success: true });

    const mod = makeCommandModule('mode', {
      mode: {
        type: 'pick',
        getItems: () => [{ label: 'Plan', value: 'plan' }],
      },
    });

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [mod],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('/mode plan');

    expect(channel.requestAction).not.toHaveBeenCalled();
    expect(session.executeCommand).toHaveBeenCalledWith('mode', 'plan');
  });

  it('Given unknown command executed When null returned Then error event written', async () => {
    vi.mocked(session.executeCommand).mockResolvedValue(null);

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    await channel.simulateSubmit('/unknown');

    expect(channel.events[0]).toMatchObject({ type: 'error' });
  });

  it('Given text_delta event When emitted Then assistant-chunk written', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    session.emitEvent('text_delta', 'hello ');
    session.emitEvent('text_delta', 'world');

    expect(channel.events).toContainEqual({ type: 'assistant-chunk', chunk: 'hello ' });
    expect(channel.events).toContainEqual({ type: 'assistant-chunk', chunk: 'world' });
  });

  it('Given complete event When emitted Then assistant-done written and busy cleared', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();
    channel.busyState = true;

    session.emitEvent('text_delta', 'hi');
    session.emitEvent('complete', {
      response: 'hi',
      history: [],
      toolSummaries: [],
      contextState: { usedPercentage: 0, usedTokens: 0, maxTokens: 0, remainingPercentage: 100 },
    });

    expect(channel.events).toContainEqual({ type: 'assistant-done', fullText: 'hi' });
    expect(channel.busyState).toBe(false);
  });

  it('Given error event When emitted Then error written and busy cleared', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();
    channel.busyState = true;

    const err = new Error('oops');
    session.emitEvent('error', err);

    expect(channel.events).toContainEqual({ type: 'error', error: err });
    expect(channel.busyState).toBe(false);
  });

  it('Given runtime stopped Then channel.stop called and events unwired', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();
    await runtime.stop();

    expect(channel.stopped).toBe(true);
    expect(session.off).toHaveBeenCalledTimes(6);
  });

  it('Given user message submitted When complete emitted Then setBusy called true then false', async () => {
    const busyCalls: boolean[] = [];
    const originalSetBusy = channel.setBusy.bind(channel);
    vi.spyOn(channel, 'setBusy').mockImplementation((v) => {
      busyCalls.push(v);
      originalSetBusy(v);
    });

    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    const submitPromise = channel.simulateSubmit('hello');
    session.emitEvent('complete', {
      response: 'hi',
      history: [],
      toolSummaries: [],
      contextState: { usedPercentage: 0, usedTokens: 0, maxTokens: 0, remainingPercentage: 100 },
    });
    await submitPromise;

    expect(busyCalls).toEqual([true, false]);
  });

  it('Given tool_start event When emitted Then tool-call event written', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    session.emitEvent('tool_start', {
      toolName: 'bash',
      executionId: 'exec-1',
      firstArg: 'ls',
      isRunning: true,
    });

    expect(channel.events).toContainEqual({
      type: 'tool-call',
      id: 'exec-1',
      name: 'bash',
      args: 'ls',
    });
  });

  it('Given tool_end event When emitted Then tool-result event written', async () => {
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      _testSession: session,
    });
    await runtime.start();

    session.emitEvent('tool_end', {
      toolName: 'bash',
      executionId: 'exec-1',
      firstArg: 'ls',
      isRunning: false,
      result: 'success',
      toolResultData: 'file.txt',
    });

    expect(channel.events).toContainEqual({
      type: 'tool-result',
      id: 'exec-1',
      name: 'bash',
      result: 'file.txt',
    });
  });
});
