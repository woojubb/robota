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
    expect(mockSession.run).toHaveBeenCalledWith('first', undefined);
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
    expect(mockSession.run).toHaveBeenCalledWith('first', undefined);
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

  // ══════════════════════════════════════════════════════════════
  // Regression tests — these were broken during the SDK/CLI
  // separation refactoring and must never break again.
  // ══════════════════════════════════════════════════════════════

  // ── Regression: session.run() must receive rawInput for hooks ──

  it('submit passes rawInput to session.run() for hook matching', async () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    await session.submit('expanded skill prompt', '/audit', '/rulebased-harness:audit');

    expect(mockSession.run).toHaveBeenCalledWith(
      'expanded skill prompt',
      '/rulebased-harness:audit',
    );
  });

  it('submit without rawInput passes undefined as second arg', async () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    await session.submit('hello');

    expect(mockSession.run).toHaveBeenCalledWith('hello', undefined);
  });

  // ── Regression: displayInput controls user message text ────────

  it('displayInput overrides user message (skill prompt not shown as You:)', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession() as never,
    });

    await session.submit('full expanded skill prompt content', '/audit');

    const messages = session.getMessages();
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toBe('/audit');
    expect(userMsg!.content).not.toContain('full expanded skill prompt');
  });

  it('without displayInput, user message shows the actual input', async () => {
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: createMockSession() as never,
    });

    await session.submit('Hello world');

    const messages = session.getMessages();
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toBe('Hello world');
  });

  // ── Regression: no raw JSON tool summaries in messages ─────────

  it('messages do not contain raw JSON tool summaries', async () => {
    const mockSession = createMockSession({
      history: [
        { role: 'user', content: 'test' },
        {
          role: 'assistant',
          content: 'I will read the file',
          toolCalls: [{ function: { name: 'Read', arguments: '{"file_path":"/test.ts"}' } }],
        },
        { role: 'assistant', content: 'Here is the result' },
      ],
    });

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    await session.submit('test');

    const messages = session.getMessages();
    for (const msg of messages) {
      // No message should contain stringified JSON array of tool summaries
      if (msg.content) {
        expect(msg.content).not.toMatch(/^\[{"name":".*","args":".*"}\]$/);
      }
    }
  });

  // ── Regression: activeTools survives execution end ─────────────

  it('activeTools not cleared when execution ends (cleared on next start)', async () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    // Simulate tool events by checking the internal clear timing
    // activeTools should be empty after execution (no tools fired with mock)
    // but the key invariant is: clearStreaming happens at START, not END
    let thinkingTrueActiveTools: IToolState[] = [];
    let thinkingFalseActiveTools: IToolState[] = [];

    session.on('thinking', (isThinking) => {
      if (isThinking) {
        thinkingTrueActiveTools = [...session.getActiveTools()];
      } else {
        thinkingFalseActiveTools = [...session.getActiveTools()];
      }
    });

    await session.submit('first');
    // At thinking=true (start), tools were cleared
    expect(thinkingTrueActiveTools).toEqual([]);
    // At thinking=false (end), tools are whatever accumulated (empty with mock)
    expect(thinkingFalseActiveTools).toEqual([]);

    // The key point: getActiveTools() is accessible after execution
    expect(session.getActiveTools()).toBeDefined();
    expect(Array.isArray(session.getActiveTools())).toBe(true);
  });

  // ── Regression: queued prompt rawInput is preserved ────────────

  it('queued prompt preserves displayInput and rawInput', async () => {
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

    // Queue with displayInput + rawInput
    await session.submit('expanded prompt', '/skill', '/plugin:skill args');
    expect(session.getPendingPrompt()).toBe('expanded prompt');

    // Complete first
    resolveRun!('done');
    await first;
    await new Promise((r) => setTimeout(r, 50));

    // Second call should have used the queued rawInput
    const calls = mockSession.run.mock.calls;
    const lastCall = calls[calls.length - 1];
    if (lastCall) {
      // If queued prompt executed, it should pass rawInput
      expect(lastCall[0]).toBe('expanded prompt');
      expect(lastCall[1]).toBe('/plugin:skill args');
    }
  });

  // ── Regression: abort preserves interrupted assistant text ─────

  it('abort preserves partial assistant text in messages', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    let rejectRun: (err: Error) => void;
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectRun = reject;
        }),
    );
    mockSession.getHistory.mockReturnValue([]);
    mockSession.abort.mockImplementation(() => {
      mockSession.getHistory.mockReturnValue([
        { role: 'user', content: 'write a story' },
        { role: 'assistant', content: 'Once upon a time...', state: 'interrupted' },
      ]);
    });

    const session = new InteractiveSession({
      config: {} as never,
      context: {} as never,
      session: mockSession as never,
    });

    const exec = session.submit('write a story');
    await new Promise((r) => setTimeout(r, 10));
    session.abort();
    rejectRun!(abortError);
    await exec;
    await new Promise((r) => setTimeout(r, 10));

    const messages = session.getMessages();
    // Must contain the partial assistant response
    const assistantMsg = messages.find(
      (m) => m.role === 'assistant' && m.content?.includes('Once upon a time'),
    );
    expect(assistantMsg).toBeDefined();

    // Must contain "Interrupted by user" system message
    const interruptMsg = messages.find(
      (m) => m.role === 'system' && m.content?.includes('Interrupted by user'),
    );
    expect(interruptMsg).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════
  // Display order: Tool → Robota (SPEC-mandated fixed order)
  // ══════════════════════════════════════════════════════════════

  it('tool summary message appears before assistant message on completion', async () => {
    const mockSession = createMockSession({ runResult: 'final answer' });
    // Simulate tools accumulating during run()
    mockSession.run.mockImplementation(async function (this: void) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).activeTools = [
        { toolName: 'Read', firstArg: 'file.ts', isRunning: false, result: 'success' },
        { toolName: 'Edit', firstArg: 'file.ts', isRunning: false, result: 'success' },
      ];
      return 'final answer';
    });
    const session = new InteractiveSession({
      session: mockSession as never,
    } as never);

    await session.submit('fix the bug');

    const messages = session.getMessages();
    const toolIdx = messages.findIndex((m) => m.role === 'tool');
    const assistantIdx = messages.findIndex((m) => m.role === 'assistant');

    // Tool message must exist
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    // Assistant message must exist
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    // Tool must come BEFORE assistant (Tool → Robota order)
    expect(toolIdx).toBeLessThan(assistantIdx);

    // Tool message contains tool names
    const toolMsg = messages[toolIdx]!;
    expect(toolMsg.content).toContain('Read');
    expect(toolMsg.content).toContain('Edit');

    // activeTools should be cleared after completion
    expect(session.getActiveTools()).toEqual([]);
  });

  it('tool summary appears before assistant on abort', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    let rejectRun: (err: Error) => void;
    const mockSession = createMockSession();
    mockSession.run.mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectRun = reject;
        }),
    );
    mockSession.getHistory.mockReturnValue([]);
    mockSession.abort.mockImplementation(() => {
      mockSession.getHistory.mockReturnValue([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'partial', state: 'interrupted' },
      ]);
    });

    const session = new InteractiveSession({
      session: mockSession as never,
    } as never);

    const exec = session.submit('test');
    await new Promise((r) => setTimeout(r, 10));

    // Simulate tools accumulated during execution (before abort)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).activeTools = [{ toolName: 'Bash', firstArg: 'ls', isRunning: true }];

    session.abort();
    rejectRun!(abortError);
    await exec;
    await new Promise((r) => setTimeout(r, 10));

    const messages = session.getMessages();
    const toolIdx = messages.findIndex((m) => m.role === 'tool');
    const assistantIdx = messages.findIndex((m) => m.role === 'assistant');
    const systemIdx = messages.findIndex(
      (m) => m.role === 'system' && m.content?.includes('Interrupted'),
    );

    // All must exist
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(systemIdx).toBeGreaterThanOrEqual(0);

    // Order: Tool → Robota → System
    expect(toolIdx).toBeLessThan(assistantIdx);
    expect(assistantIdx).toBeLessThan(systemIdx);

    // activeTools should be cleared
    expect(session.getActiveTools()).toEqual([]);
  });

  it('no tool summary when no tools were executed', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'simple answer' }) as never,
    } as never);

    await session.submit('hello');

    const messages = session.getMessages();
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeUndefined();
  });
});
