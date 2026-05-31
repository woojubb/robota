/**
 * Integration tests for TuiInteractionChannel lifecycle:
 * session event wiring, handleInput roundtrip, onChange propagation.
 *
 * No Ink rendering, no PTY — pure TypeScript.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@robota-sdk/agent-framework', async () => {
  const actual = await vi.importActual<typeof import('@robota-sdk/agent-framework')>(
    '@robota-sdk/agent-framework',
  );
  return {
    ...actual,
    InteractiveSession: vi.fn().mockImplementation(() => {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      return {
        getFullHistory: vi.fn().mockReturnValue([]),
        setName: vi.fn(),
        getName: vi.fn().mockReturnValue(undefined),
        getPermissionMode: vi.fn().mockReturnValue('default'),
        isInitialized: false,
        on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        off: vi.fn(),
        emit: (event: string, ...args: unknown[]) => {
          (handlers.get(event) ?? []).forEach((h) => h(...args));
        },
        submit: vi.fn().mockResolvedValue(undefined),
        executeCommand: vi.fn().mockResolvedValue(null),
        getPendingPrompt: vi.fn().mockReturnValue(null),
        abort: vi.fn(),
        cancelQueue: vi.fn(),
        getContextState: vi.fn().mockReturnValue({
          usedPercentage: 0,
          usedTokens: 0,
          maxTokens: 100_000,
        }),
        getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
        shutdown: vi.fn().mockResolvedValue(undefined),
        sendAgentJob: vi.fn().mockResolvedValue(undefined),
        readExecutionWorkspaceDetail: vi.fn().mockResolvedValue({}),
      };
    }),
    CommandRegistry: vi.fn().mockImplementation(() => ({
      addModule: vi.fn(),
    })),
  };
});

import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IExecutionResult, IInteractiveSession } from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockSession = {
  getFullHistory: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function getMockSession(channel: TuiInteractionChannel): MockSession {
  return (channel as unknown as { interactiveSession: MockSession }).interactiveSession;
}

function emitSessionEvent(channel: TuiInteractionChannel, event: string, ...args: unknown[]): void {
  getMockSession(channel).emit(event, ...args);
}

function makeMockTransportRegistry(): {
  registry: ITransportRegistryView<IInteractiveSession>;
  startAll: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
} {
  const startAll = vi.fn().mockResolvedValue(undefined);
  const stopAll = vi.fn().mockResolvedValue(undefined);
  return {
    registry: { startAll, stopAll } as unknown as ITransportRegistryView<IInteractiveSession>,
    startAll,
    stopAll,
  };
}

function makeChannel(opts?: {
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
}): TuiInteractionChannel {
  return new TuiInteractionChannel({
    cwd: '/tmp/test',
    provider: {} as IAIProvider,
    ...opts,
  });
}

const MOCK_RESULT = {
  contextState: { usedPercentage: 10, usedTokens: 1_000, maxTokens: 100_000 },
  response: 'Hello!',
} as unknown as IExecutionResult;

const MOCK_TOOL = {
  toolName: 'bash',
  isRunning: true,
  input: '{}',
  startTime: Date.now(),
} as unknown as Parameters<
  InstanceType<typeof TuiInteractionChannel>['stateManager']['onToolStart']
>[0];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Group A: channel.start() / channel.stop() lifecycle ───────────────────────

describe('Group A — channel.start() / channel.stop() lifecycle', () => {
  it('A1: text_delta after start() updates stateManager.streamingText', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'text_delta', 'Hello!');

    expect(channel.stateManager.streamingText).toBe('Hello!');
    await channel.stop();
  });

  it('A2: complete after start() clears streaming state and updates contextState', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'text_delta', 'streaming...');
    emitSessionEvent(channel, 'complete', MOCK_RESULT);

    expect(channel.stateManager.streamingText).toBe('');
    expect(channel.stateManager.contextState.percentage).toBe(10);
    expect(channel.stateManager.contextState.usedTokens).toBe(1_000);
    await channel.stop();
  });

  it('A3: tool_start after start() adds entry to stateManager.activeTools', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'tool_start', MOCK_TOOL);

    expect(channel.stateManager.activeTools).toHaveLength(1);
    expect(channel.stateManager.activeTools[0]).toMatchObject({ toolName: 'bash' });
    await channel.stop();
  });

  it('A4: error after start() clears stateManager.streamingText', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'text_delta', 'partial...');
    emitSessionEvent(channel, 'error');

    expect(channel.stateManager.streamingText).toBe('');
    await channel.stop();
  });

  it('A5: calling start() twice does not duplicate subscriptions', async () => {
    const channel = makeChannel();
    await channel.start();
    await channel.start(); // second call is a no-op (sessionStarted guard)

    emitSessionEvent(channel, 'text_delta', 'hi');

    expect(channel.stateManager.streamingText).toBe('hi'); // not 'hihi'
    await channel.stop();
  });

  it('A6: stop() calls transportRegistry.stopAll exactly once', async () => {
    const { registry, stopAll } = makeMockTransportRegistry();
    const channel = makeChannel({ transportRegistry: registry });
    await channel.start();
    await channel.stop();

    expect(stopAll).toHaveBeenCalledOnce();
  });
});

// ── Group B: handleInput() AI-response roundtrip ──────────────────────────────

describe('Group B — handleInput() roundtrip', () => {
  it('B1: handleInput("hello") calls session.submit with "hello"', async () => {
    const channel = makeChannel();
    await channel.start();

    await channel.handleInput('hello');

    const mockSession = getMockSession(channel);
    expect(mockSession.submit).toHaveBeenCalledWith('hello');
    await channel.stop();
  });

  it('B2: text_delta + complete syncs history to stateManager', async () => {
    const channel = makeChannel();
    const mockSession = getMockSession(channel);
    const historyEntry = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi!' }],
      timestamp: Date.now(),
    };
    mockSession.getFullHistory.mockReturnValue([historyEntry]);
    await channel.start();

    await channel.handleInput('hello');
    emitSessionEvent(channel, 'text_delta', 'Hi!');
    expect(channel.stateManager.streamingText).toBe('Hi!');

    emitSessionEvent(channel, 'complete', MOCK_RESULT);
    expect(channel.stateManager.streamingText).toBe('');
    expect(channel.stateManager.history).toHaveLength(1);

    await channel.stop();
  });

  it('B3: handleInput("/help") calls executeCommand, not session.submit', async () => {
    const channel = makeChannel();
    await channel.start();

    await channel.handleInput('/help');

    const mockSession = getMockSession(channel);
    expect(mockSession.submit).not.toHaveBeenCalled();
    expect(mockSession.executeCommand).toHaveBeenCalledWith('help', '');
    await channel.stop();
  });

  it('B4: handleInput("hello") triggers channel.onChange at least once', async () => {
    const channel = makeChannel();
    const onChange = vi.fn();
    channel.onChange = onChange;
    await channel.start();
    onChange.mockClear();

    await channel.handleInput('hello');
    emitSessionEvent(channel, 'text_delta', 'hey');

    expect(onChange).toHaveBeenCalled();
    await channel.stop();
  });
});

// ── Group C: onChange propagation invariant ───────────────────────────────────

describe('Group C — onChange propagation invariant', () => {
  it('C1: session event after start() causes channel.onChange to fire', async () => {
    const channel = makeChannel();
    const onChange = vi.fn();
    channel.onChange = onChange;
    await channel.start();
    onChange.mockClear();

    // tool_start calls notify() directly (not debounced), so onChange fires immediately
    emitSessionEvent(channel, 'tool_start', MOCK_TOOL);

    expect(onChange).toHaveBeenCalled();
    await channel.stop();
  });

  it('C2: channel.onChange does not fire for events before start()', () => {
    const channel = makeChannel();
    const onChange = vi.fn();
    channel.onChange = onChange;
    // Do NOT call channel.start() — handlers not registered yet
    emitSessionEvent(channel, 'text_delta', 'hello'); // no-op: no handlers

    expect(onChange).not.toHaveBeenCalled();
  });

  it('C3: channel.onChange does not fire for events after stop()', async () => {
    const channel = makeChannel();
    const onChange = vi.fn();
    channel.onChange = onChange;
    await channel.start();
    await channel.stop(); // sets this.onChange = null
    onChange.mockClear();

    emitSessionEvent(channel, 'text_delta', 'hello');

    expect(onChange).not.toHaveBeenCalled();
  });
});
