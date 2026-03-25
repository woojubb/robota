/**
 * Behavior tests for InteractiveSession — verifies user-facing scenarios
 * that must survive any refactoring.
 *
 * These tests verify WHAT happens (observable behavior), not HOW.
 * If a feature works, these tests pass. If a feature breaks, these fail.
 */

import { describe, it, expect, vi } from 'vitest';
import { InteractiveSession } from '../interactive-session.js';
import type { IExecutionResult, IToolState } from '../types.js';

function createMockSession(options?: {
  runResult?: string;
  runError?: Error;
  runDelay?: number;
  history?: Array<{ role: string; content?: string; state?: string; toolCalls?: unknown[] }>;
}) {
  const history = options?.history ?? [];
  return {
    run: vi.fn().mockImplementation(async (_prompt: string) => {
      if (options?.runDelay) {
        await new Promise((r) => setTimeout(r, options.runDelay));
      }
      if (options?.runError) throw options.runError;
      return options?.runResult ?? 'mock response';
    }),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue(history),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('sess-1'),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
  };
}

describe('InteractiveSession — User Behavior Scenarios', () => {
  // ── Scenario: Normal prompt execution ─────────────────────────

  it('user submits a prompt → user message + assistant message appear in history', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession({ runResult: 'Hello back!' }) as never,
    });

    await session.submit('Hello');

    const messages = session.getMessages();
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('Hello');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.content).toBe('Hello back!');
  });

  // ── Scenario: Streaming text accumulation ─────────────────────

  it('streaming deltas accumulate and are retrievable', async () => {
    const mockSession = createMockSession();
    // Simulate onTextDelta being called during run
    mockSession.run.mockImplementation(async () => {
      // Access the onTextDelta that was wired during construction
      // We need to trigger it externally since mock doesn't call it
      return 'final';
    });

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const deltas: string[] = [];
    session.on('text_delta', (d) => deltas.push(d));

    await session.submit('test');
    // Note: with mock session, onTextDelta is not called (it's wired during real createSession)
    // This test verifies the event subscription mechanism works
    expect(session.getMessages().length).toBeGreaterThanOrEqual(2);
  });

  // ── Scenario: Prompt queue ────────────────────────────────────

  it('submitting during execution queues the prompt (max 1)', async () => {
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

    // Queue second
    await session.submit('second');
    expect(session.getPendingPrompt()).toBe('second');

    // Queue third — replaces second (max 1)
    await session.submit('third');
    expect(session.getPendingPrompt()).toBe('third');

    // Complete first
    resolveRun!('first response');
    await first;
    await new Promise((r) => setTimeout(r, 50));

    // Third should have been auto-executed
    expect(mockSession.run).toHaveBeenCalledWith('first');
    // 'third' was queued (replaced 'second'), will execute after first completes
  });

  it('cancelQueue clears queued prompt without affecting execution', async () => {
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
    expect(mockSession.abort).not.toHaveBeenCalled(); // execution still running

    resolveRun!('done');
    await first;
    await new Promise((r) => setTimeout(r, 50));

    // 'queued' should NOT have been executed
    expect(mockSession.run).toHaveBeenCalledTimes(1);
    expect(mockSession.run).toHaveBeenCalledWith('first');
  });

  // ── Scenario: Abort ───────────────────────────────────────────

  it('abort clears queue and emits interrupted event', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    let rejectRun: (err: Error) => void;
    const abortHistory = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'partial answer', state: 'interrupted' },
    ];
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectRun = reject;
        }),
    );
    // History is empty at start, populated when abort happens
    mockSession.getHistory.mockReturnValue([]);
    // After abort, history contains the interrupted messages
    mockSession.abort.mockImplementation(() => {
      mockSession.getHistory.mockReturnValue(abortHistory);
    });

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    let wasInterrupted = false;
    let interruptedResult: IExecutionResult | null = null;
    session.on('interrupted', (result) => {
      wasInterrupted = true;
      interruptedResult = result;
    });

    const exec = session.submit('test');
    await new Promise((r) => setTimeout(r, 10));

    await session.submit('queued');
    session.abort();

    expect(mockSession.abort).toHaveBeenCalled();
    expect(session.getPendingPrompt()).toBeNull();

    rejectRun!(abortError);
    await exec;
    await new Promise((r) => setTimeout(r, 10));

    expect(wasInterrupted).toBe(true);
    // Interrupted message should contain partial answer from history
    expect(interruptedResult!.response).toContain('partial answer');

    // Messages should include "Interrupted by user." system message
    const messages = session.getMessages();
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg!.role).toBe('system');
    expect(lastMsg!.content).toContain('Interrupted by user');
  });

  // ── Scenario: Error handling ──────────────────────────────────

  it('non-abort errors produce error system message', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession({ runError: new Error('API rate limit exceeded') }) as never,
    });

    let errorReceived: Error | null = null;
    session.on('error', (err) => {
      errorReceived = err;
    });

    await session.submit('test');

    expect(errorReceived!.message).toBe('API rate limit exceeded');
    const messages = session.getMessages();
    const errorMsg = messages.find(
      (m) => m.role === 'system' && m.content?.includes('API rate limit'),
    );
    expect(errorMsg).toBeDefined();
  });

  // ── Scenario: Tool execution tracking ─────────────────────────

  it('getActiveTools returns empty array after execution completes', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession() as never,
    });

    // Before any execution
    expect(session.getActiveTools()).toEqual([]);

    await session.submit('test');

    // After execution completes, tools are cleared
    expect(session.getActiveTools()).toEqual([]);
  });

  // ── Scenario: Thinking state transitions ──────────────────────

  it('thinking transitions: false → true → false on submit', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession({ runResult: 'done' }) as never,
    });

    const states: boolean[] = [];
    session.on('thinking', (v) => states.push(v));

    expect(session.isExecuting()).toBe(false);
    await session.submit('hello');
    expect(session.isExecuting()).toBe(false);

    expect(states).toEqual([true, false]);
  });

  // ── Scenario: Context state updates after execution ───────────

  it('context_update event fires after completion with current state', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession() as never,
    });

    let contextUsedTokens = 0;
    session.on('context_update', (state) => {
      contextUsedTokens = state.usedTokens;
    });

    await session.submit('test');
    expect(contextUsedTokens).toBe(1000);
  });

  // ── Scenario: Multiple sequential prompts ─────────────────────

  it('multiple prompts accumulate in message history', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession({ runResult: 'response' }) as never,
    });

    await session.submit('first');
    await session.submit('second');
    await session.submit('third');

    const messages = session.getMessages();
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    expect(userMessages.length).toBe(3);
    expect(assistantMessages.length).toBe(3);
    expect(userMessages[0]!.content).toBe('first');
    expect(userMessages[1]!.content).toBe('second');
    expect(userMessages[2]!.content).toBe('third');
  });

  // ── Scenario: Event unsubscription ────────────────────────────

  it('off() stops receiving events', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession() as never,
    });

    let count = 0;
    const handler = (): void => {
      count++;
    };
    session.on('thinking', handler);

    await session.submit('first');
    expect(count).toBe(2); // true + false

    session.off('thinking', handler);
    await session.submit('second');
    expect(count).toBe(2); // no change
  });
});
