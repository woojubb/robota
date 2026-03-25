/**
 * Tests for InteractiveSession — event-driven session wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractiveSession } from '../interactive-session.js';
import type { IToolState, IExecutionResult } from '../types.js';

// Minimal mock Session that satisfies InteractiveSession's needs
function createMockSession(options?: {
  runResult?: string;
  runError?: Error;
  history?: Array<{ role: string; content?: string; toolCalls?: unknown[] }>;
}) {
  const history = options?.history ?? [];
  return {
    run: vi.fn().mockImplementation(async () => {
      if (options?.runError) throw options.runError;
      return options?.runResult ?? 'mock response';
    }),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue(history),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 10000,
    }),
  };
}

describe('InteractiveSession', () => {
  it('emits thinking and complete events on submit', async () => {
    const mockSession = createMockSession({ runResult: 'hello world' });
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const thinkingStates: boolean[] = [];
    let completedResult: IExecutionResult | null = null;

    session.on('thinking', (isThinking) => thinkingStates.push(isThinking));
    session.on('complete', (result) => {
      completedResult = result;
    });

    await session.submit('hello');

    expect(thinkingStates).toEqual([true, false]);
    expect(completedResult).not.toBeNull();
    expect(completedResult!.response).toBe('hello world');
    expect(mockSession.run).toHaveBeenCalledWith('hello', undefined);
  });

  it('adds user message to messages on submit', async () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    await session.submit('test prompt');

    const messages = session.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('test prompt');
    expect(messages[1]!.role).toBe('assistant');
  });

  it('queues prompt when already executing', async () => {
    let resolveRun: (value: string) => void;
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    // Start first execution
    const first = session.submit('first');
    await new Promise((r) => setTimeout(r, 10));

    expect(session.isExecuting()).toBe(true);

    // Submit second — should be queued
    await session.submit('second');
    expect(session.getPendingPrompt()).toBe('second');

    // Complete first execution
    resolveRun!('first response');
    await first;

    // Wait for queued prompt to auto-execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSession.run).toHaveBeenCalledWith('first', undefined);
    // second may or may not have executed depending on timing
  });

  it('cancelQueue clears pending without aborting', async () => {
    let resolveRun: (value: string) => void;
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const first = session.submit('first');
    await new Promise((r) => setTimeout(r, 10));

    await session.submit('queued');
    expect(session.getPendingPrompt()).toBe('queued');

    session.cancelQueue();
    expect(session.getPendingPrompt()).toBeNull();
    expect(mockSession.abort).not.toHaveBeenCalled();

    resolveRun!('done');
    await first;
  });

  it('abort calls session.abort and clears queue', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    let rejectRun: (err: Error) => void;
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectRun = reject;
        }),
    );

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    let interrupted = false;
    session.on('interrupted', () => {
      interrupted = true;
    });

    const execution = session.submit('prompt');
    await new Promise((r) => setTimeout(r, 10));

    await session.submit('queued');
    session.abort();

    expect(mockSession.abort).toHaveBeenCalled();
    expect(session.getPendingPrompt()).toBeNull();

    rejectRun!(abortError);
    await execution;
    await new Promise((r) => setTimeout(r, 10));

    expect(interrupted).toBe(true);
  });

  it('emits error event on non-abort errors', async () => {
    const mockSession = createMockSession({
      runError: new Error('API failure'),
    });

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    let errorMsg = '';
    session.on('error', (err) => {
      errorMsg = err.message;
    });

    await session.submit('test');

    expect(errorMsg).toBe('API failure');
    const messages = session.getMessages();
    const lastMsg = messages[messages.length - 1]!;
    expect(lastMsg.role).toBe('system');
    expect(lastMsg.content).toContain('API failure');
  });

  it('off removes event listener', async () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const calls: boolean[] = [];
    const handler = (isThinking: boolean): void => {
      calls.push(isThinking);
    };

    session.on('thinking', handler);
    await session.submit('first');
    expect(calls.length).toBe(2);

    session.off('thinking', handler);
    await session.submit('second');
    expect(calls.length).toBe(2); // no new calls
  });

  it('getSession returns underlying session', () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    expect(session.getSession()).toBe(mockSession);
  });

  it('getContextState delegates to session', () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const state = session.getContextState();
    expect(state.usedTokens).toBe(1000);
    expect(mockSession.getContextState).toHaveBeenCalled();
  });
});
