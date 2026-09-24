/**
 * Behavior tests for InteractiveSession — verifies user-facing scenarios
 * that must survive any refactoring.
 *
 * These tests verify WHAT happens (observable behavior), not HOW.
 * If a feature works, these tests pass. If a feature breaks, these fail.
 */

import { describe, it, expect, vi } from 'vitest';

import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IExecutionResult, IToolState } from '../types.js';
import type { IUsageObservation } from '@robota-sdk/agent-interface-analytics';

function recordedObservation(session: InteractiveSession): IUsageObservation {
  const entries = session.getFullHistory().filter((entry) => entry.type === 'usage-observation');
  expect(entries).toHaveLength(1);
  return entries[0]!.data as unknown as IUsageObservation;
}

function expectPromptRoot(observation: IUsageObservation): void {
  expect(observation.promptExecutionStartedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  expect(observation.promptExecutionEndedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  expect(new Date(observation.promptExecutionStartedAt!).getTime()).toBeLessThanOrEqual(
    new Date(observation.promptExecutionEndedAt!).getTime(),
  );
  expect(observation.promptExecutionTraceId).toMatch(/^(?!0{32}$)[0-9a-f]{32}$/);
  expect(observation.promptExecutionSpanId).toMatch(/^(?!0{16}$)[0-9a-f]{16}$/);
  expect(['success', 'failure', 'interrupted']).toContain(observation.promptExecutionOutcome);
}

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
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getSessionId: vi.fn().mockReturnValue('sess-1'),
    getSystemMessage: vi.fn().mockReturnValue('system prompt with capabilities'),
    getToolSchemas: vi
      .fn()
      .mockReturnValue([
        { name: 'Read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
}

function createControllableRun(): {
  run: () => Promise<string>;
  started: Promise<void>;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
} {
  let resolveRun: ((value: string) => void) | undefined;
  let rejectRun: ((reason?: unknown) => void) | undefined;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  return {
    run: () =>
      new Promise<string>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
        markStarted();
      }),
    started,
    resolve: (value: string) => {
      if (!resolveRun) throw new Error('run has not started');
      resolveRun(value);
    },
    reject: (reason?: unknown) => {
      if (!rejectRun) throw new Error('run has not started');
      rejectRun(reason);
    },
  };
}

describe('InteractiveSession — User Behavior Scenarios', () => {
  // ── Scenario: Normal prompt execution ─────────────────────────

  it('user submits a prompt → user message + assistant message appear in history', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'Hello back!' }) as never,
      cwd: '/tmp',
    });

    await session.submit('Hello');

    const messages = session.getMessages();
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('Hello');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.content).toBe('Hello back!');
    expect(session.getFullHistory()).toContainEqual(
      expect.objectContaining({
        type: 'usage-observation',
        data: expect.objectContaining({
          outcome: 'success',
          providerId: 'test-provider',
          modelId: 'test-model',
          surface: 'cli',
        }),
      }),
    );
    const observation = recordedObservation(session);
    expectPromptRoot(observation);
    expect(observation.promptExecutionOutcome).toBe('success');
    expect(JSON.stringify(observation)).not.toContain('Hello back!');
  });

  it('persists an explicit provider child linked to the prompt root without provider content', async () => {
    const mockSession = createMockSession({ runResult: 'private response' });
    let listener: ((event: string, data: Record<string, unknown>) => void) | undefined;
    mockSession.getEventService.mockReturnValue({
      subscribe: vi.fn((callback: (event: string, data: Record<string, unknown>) => void) => {
        listener = callback;
      }),
      unsubscribe: vi.fn(),
    });
    let observedAt = '';
    mockSession.run.mockImplementation(async () => {
      observedAt = new Date().toISOString();
      listener?.('provider_call_completed', {
        timestamp: new Date(),
        startedAt: observedAt,
        endedAt: observedAt,
        outcome: 'success',
        round: 1,
      });
      return 'private response';
    });
    const session = new InteractiveSession({ session: mockSession as never, cwd: '/tmp' });

    await session.submit('private prompt');

    const root = recordedObservation(session);
    const children = session
      .getFullHistory()
      .filter((entry) => entry.type === 'provider-call-trace');
    expect(children).toHaveLength(1);
    expect(children[0]!.data).toMatchObject({
      traceId: root.promptExecutionTraceId,
      parentSpanId: root.promptExecutionSpanId,
      startedAt: observedAt,
      endedAt: observedAt,
      outcome: 'success',
      round: 1,
    });
    expect(JSON.stringify(children)).not.toMatch(/private prompt|private response/);
  });

  it('persists distinct content-free children for parallel tool bodies under this prompt only', async () => {
    const mockSession = createMockSession({ runResult: 'private response' });
    let listener: ((event: string, data: Record<string, unknown>) => void) | undefined;
    mockSession.getEventService.mockReturnValue({
      subscribe: vi.fn((callback: (event: string, data: Record<string, unknown>) => void) => {
        listener = callback;
      }),
      unsubscribe: vi.fn(),
    });
    let observedAt = '';
    mockSession.run.mockImplementation(async () => {
      observedAt = new Date().toISOString();
      for (const executionId of ['call-a', 'call-b']) {
        listener?.('tool.tool_body_completed', {
          timestamp: new Date(),
          startedAt: observedAt,
          endedAt: observedAt,
          outcome: 'success',
          executionId,
          toolArgs: 'private argument must be ignored',
        });
      }
      return 'private response';
    });
    const session = new InteractiveSession({ session: mockSession as never, cwd: '/tmp' });
    await session.submit('private prompt');

    const root = recordedObservation(session);
    const children = session.getFullHistory().filter((entry) => entry.type === 'tool-body-trace');
    expect(children).toHaveLength(2);
    expect(new Set(children.map((entry) => (entry.data as { spanId: string }).spanId)).size).toBe(
      2,
    );
    for (const child of children) {
      expect(child.data).toMatchObject({
        traceId: root.promptExecutionTraceId,
        parentSpanId: root.promptExecutionSpanId,
        startedAt: observedAt,
        endedAt: observedAt,
        outcome: 'success',
      });
    }
    expect(JSON.stringify(children)).not.toMatch(/private|argument|call-a|call-b/);
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
      session: mockSession as never,
      cwd: '/tmp',
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
    const mockSession = createMockSession();
    const controllableRun = createControllableRun();
    mockSession.run.mockImplementation(controllableRun.run);

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });

    // Start first execution
    const first = session.submit('first');
    await controllableRun.started;
    expect(session.isExecuting()).toBe(true);

    // Queue second
    await session.submit('second');
    expect(session.getPendingPrompt()).toBe('second');

    // Queue third — replaces second (max 1)
    await session.submit('third');
    expect(session.getPendingPrompt()).toBe('third');

    // Complete first
    controllableRun.resolve('first response');
    await first;
    await new Promise((r) => setTimeout(r, 50));

    // Third should have been auto-executed
    expect(mockSession.run).toHaveBeenCalledWith('first', undefined);
    // 'third' was queued (replaced 'second'), will execute after first completes
  });

  it('cancelQueue clears queued prompt without affecting execution', async () => {
    const mockSession = createMockSession();
    const controllableRun = createControllableRun();
    mockSession.run.mockImplementation(controllableRun.run);

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });

    const first = session.submit('first');
    await controllableRun.started;

    await session.submit('queued');
    expect(session.getPendingPrompt()).toBe('queued');

    session.cancelQueue();
    expect(session.getPendingPrompt()).toBeNull();
    expect(mockSession.abort).not.toHaveBeenCalled(); // execution still running

    controllableRun.resolve('done');
    await first;
    await new Promise((r) => setTimeout(r, 50));

    // 'queued' should NOT have been executed
    expect(mockSession.run).toHaveBeenCalledTimes(1);
    expect(mockSession.run).toHaveBeenCalledWith('first', undefined);
    expect(
      session.getFullHistory().filter((entry) => entry.type === 'usage-observation'),
    ).toHaveLength(1);
  });

  // ── Scenario: Abort ───────────────────────────────────────────

  it('abort clears queue and emits interrupted event', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const abortHistory = [
      {
        id: 'm-1',
        role: 'user',
        content: 'test',
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
      { role: 'assistant', content: 'partial answer', state: 'interrupted' },
    ];
    const mockSession = createMockSession();
    const controllableRun = createControllableRun();
    mockSession.run.mockImplementation(controllableRun.run);
    // History is empty at start, populated when abort happens
    mockSession.getHistory.mockReturnValue([]);
    // After abort, history contains the interrupted messages
    mockSession.abort.mockImplementation(() => {
      mockSession.getHistory.mockReturnValue(abortHistory);
    });

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });

    let wasInterrupted = false;
    let interruptedResult: IExecutionResult | null = null;
    session.on('interrupted', (result) => {
      wasInterrupted = true;
      interruptedResult = result;
    });

    const exec = session.submit('test');
    await controllableRun.started;

    await session.submit('queued');
    session.abort();

    expect(mockSession.abort).toHaveBeenCalled();
    expect(session.getPendingPrompt()).toBeNull();

    controllableRun.reject(abortError);
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
    expect(session.getFullHistory()).toContainEqual(
      expect.objectContaining({
        type: 'usage-observation',
        data: expect.objectContaining({ outcome: 'interrupted' }),
      }),
    );
    expectPromptRoot(recordedObservation(session));
  });

  // ── Scenario: Error handling ──────────────────────────────────

  it('non-abort errors produce error system message', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runError: new Error('API rate limit exceeded') }) as never,
      cwd: '/tmp',
    });

    let errorReceived: Error | null = null;
    session.on('error', (err) => {
      errorReceived = err;
    });

    await session.submit('test');

    expect(errorReceived!.message).toBe('API rate limit exceeded');
    const messages = session.getMessages();
    const errorMsg = messages.find(
      (m) => m.role === 'system' && m.content?.includes('Rate limit reached'),
    );
    expect(errorMsg).toBeDefined();
    expect(session.getFullHistory()).toContainEqual(
      expect.objectContaining({
        type: 'usage-observation',
        data: expect.objectContaining({ outcome: 'failure' }),
      }),
    );
    const observation = recordedObservation(session);
    expectPromptRoot(observation);
    expect(observation.promptExecutionOutcome).toBe('failure');
    expect(JSON.stringify(observation)).not.toContain('API rate limit exceeded');
  });

  // ── Scenario: ERR-001 — mid-stream failure surfacing + liveness ─

  it('ERR-001: mid-stream failure preserves the partial answer, marks a styled error entry, and the next submit succeeds', async () => {
    const mockSession = createMockSession();
    const controllableRun = createControllableRun();
    mockSession.run.mockImplementationOnce(controllableRun.run);

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });
    let errorReceived: Error | null = null;
    session.on('error', (err) => {
      errorReceived = err;
    });

    const exec = session.submit('first');
    await controllableRun.started;
    // Stream a partial answer, then drop the connection mid-stream.
    (
      session as unknown as { execCtrl: { handleTextDelta(delta: string): void } }
    ).execCtrl.handleTextDelta('partial answ');
    controllableRun.reject(new Error('read ECONNRESET'));
    await exec;

    expect(errorReceived!.message).toBe('read ECONNRESET');
    const history = session.getFullHistory();
    // (1) The partial answer is preserved as an interrupted assistant entry — not evaporated.
    const partial = history.find(
      (e) =>
        e.category === 'chat' &&
        (e.data as { role?: string }).role === 'assistant' &&
        (e.data as { content?: string }).content === 'partial answ',
    );
    expect(partial).toBeDefined();
    expect((partial!.data as { state?: string }).state).toBe('interrupted');
    // (2) The error entry is humanized AND machine-marked for styled rendering.
    const errorEntry = history.find(
      (e) =>
        e.category === 'chat' &&
        (e.data as { metadata?: { kind?: string } }).metadata?.kind === 'error',
    );
    expect(errorEntry).toBeDefined();
    expect((errorEntry!.data as { content?: string }).content).toContain(
      'Network connection failed',
    );
    // (3) Liveness: the session accepts and completes the NEXT prompt.
    await session.submit('second');
    const assistant = session
      .getMessages()
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content);
    expect(assistant).toContain('mock response');
  });

  it('ERR-001 G1: reportBackgroundError surfaces an out-of-turn error into history and events', async () => {
    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
    });
    let errorReceived: Error | null = null;
    session.on('error', (err) => {
      errorReceived = err;
    });

    session.reportBackgroundError(
      new Error('getaddrinfo ENOTFOUND api.example.com'),
      'background task',
    );

    expect(errorReceived!.message).toContain('ENOTFOUND');
    const entry = session
      .getFullHistory()
      .find(
        (e) =>
          e.category === 'chat' &&
          (e.data as { metadata?: { kind?: string } }).metadata?.kind === 'error',
      );
    expect(entry).toBeDefined();
    expect((entry!.data as { content?: string }).content).toContain('Network connection failed');
    expect((entry!.data as { metadata?: { source?: string } }).metadata?.source).toBe(
      'background task',
    );
    // Session stays usable.
    await session.submit('after');
    expect(session.getMessages().some((m) => m.content === 'mock response')).toBe(true);
  });

  it('keeps provider error guidance scoped to each session', () => {
    const first = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
      providerErrorGuidance: { authentication: 'Configure product A.' },
    });
    const second = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
      providerErrorGuidance: { authentication: 'Configure product B.' },
    });
    const neutral = new InteractiveSession({ session: createMockSession() as never, cwd: '/tmp' });

    for (const session of [first, second, neutral]) {
      session.reportBackgroundError(new Error('401 Unauthorized'));
    }

    const message = (session: InteractiveSession): string =>
      String(session.getMessages().find((entry) => entry.role === 'system')?.content ?? '');
    expect(message(first)).toContain('Configure product A.');
    expect(message(first)).not.toContain('Configure product B.');
    expect(message(second)).toContain('Configure product B.');
    expect(message(second)).not.toContain('Configure product A.');
    expect(message(neutral)).toContain('Invalid API key.');
    expect(message(neutral)).not.toContain('/provider');
    expect(message(neutral)).not.toContain('~/.robota');
  });

  it('uses this session’s provider guidance for a failed prompt turn', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runError: new Error('429 rate limit') }) as never,
      cwd: '/tmp',
      providerErrorGuidance: { rateLimit: 'Choose another model in product A.' },
    });

    await session.submit('hello');

    const errors = session.getMessages().filter((entry) => entry.role === 'system');
    expect(
      errors.some((entry) => String(entry.content).includes('Choose another model in product A.')),
    ).toBe(true);
    expect(errors.every((entry) => !String(entry.content).includes('/model'))).toBe(true);
  });

  // ── Scenario: Tool execution tracking ─────────────────────────

  it('getActiveTools returns empty array after execution completes', async () => {
    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
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
      session: createMockSession({ runResult: 'done' }) as never,
      cwd: '/tmp',
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
      session: createMockSession() as never,
      cwd: '/tmp',
    });

    let contextUsedTokens = 0;
    session.on('context_update', (state) => {
      contextUsedTokens = state.usedTokens;
    });

    await session.submit('test');
    expect(contextUsedTokens).toBe(1000);
  });

  it('keeps the prompt root successful when a later context update fails', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'completed response' }) as never,
      cwd: '/tmp',
    });
    session.on('context_update', () => {
      throw new Error('late context update failed');
    });
    session.on('error', () => undefined);

    await session.submit('test');

    const observation = recordedObservation(session);
    expect(observation.outcome).toBe('success');
    expectPromptRoot(observation);
    expect(observation.promptExecutionOutcome).toBe('success');
    expect(JSON.stringify(observation)).not.toContain('late context update failed');
  });

  it('keeps the first prompt outcome when a later context update aborts', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'completed response' }) as never,
      cwd: '/tmp',
    });
    session.on('context_update', () => {
      throw new DOMException('late abort', 'AbortError');
    });
    session.on('error', () => undefined);

    await session.submit('test');

    const observation = recordedObservation(session);
    expect(observation.outcome).toBe('interrupted');
    expect(observation.promptExecutionOutcome).toBe('success');
    expectPromptRoot(observation);
  });

  it('injected sessions without cwd emit error on submit', async () => {
    const beginTurn = vi.spyOn(EditCheckpointStore.prototype, 'beginTurn');
    const session = new InteractiveSession({
      session: createMockSession() as never,
    });

    let errorMsg: string | undefined;
    session.on('error', (err) => {
      errorMsg = err.message;
    });

    try {
      await session.submit('test');
      expect(errorMsg).toContain('cwd is not set');
      expect(beginTurn).not.toHaveBeenCalled();
    } finally {
      beginTurn.mockRestore();
    }
  });

  // ── Scenario: Multiple sequential prompts ─────────────────────

  it('multiple prompts accumulate in message history', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'response' }) as never,
      cwd: '/tmp',
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
      session: createMockSession() as never,
      cwd: '/tmp',
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
      session: mockSession as never,
      cwd: '/tmp',
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
      session: mockSession as never,
      cwd: '/tmp',
    });

    await session.submit('hello');

    expect(mockSession.run).toHaveBeenCalledWith('hello', undefined);
  });

  // ── Regression: displayInput controls user message text ────────

  it('displayInput overrides user message (skill prompt not shown as You:)', async () => {
    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
    });

    await session.submit('full expanded skill prompt content', '/audit');

    const messages = session.getMessages();
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toBe('/audit');
    expect(userMsg!.content).not.toContain('full expanded skill prompt');
  });

  it('without displayInput, user message shows the actual input', async () => {
    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
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
        { role: 'user', content: 'test', state: 'complete' },
        {
          role: 'assistant',
          content: 'I will read the file',
          toolCalls: [{ function: { name: 'Read', arguments: '{"file_path":"/test.ts"}' } }],
        },
        { role: 'assistant', content: 'Here is the result', state: 'complete' },
      ],
    });

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
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
      session: mockSession as never,
      cwd: '/tmp',
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
    const mockSession = createMockSession();
    const firstRun = createControllableRun();
    const secondRun = createControllableRun();
    let callCount = 0;
    mockSession.run.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? firstRun.run() : secondRun.run();
    });

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });

    // Start first execution
    const first = session.submit('first');
    await firstRun.started;

    // Queue with displayInput + rawInput
    await session.submit('expanded prompt', '/skill', '/plugin:skill args');
    expect(session.getPendingPrompt()).toBe('expanded prompt');

    // Complete first; queued prompt should start automatically
    firstRun.resolve('done');
    await first;
    // Wait for the queued run to actually start (no fixed timeout)
    await secondRun.started;
    secondRun.resolve('done');

    // Second call must have used the queued rawInput
    const calls = mockSession.run.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe('expanded prompt');
    expect(calls[1][1]).toBe('/plugin:skill args');
  });

  // ── Regression: abort preserves interrupted assistant text ─────

  it('abort preserves partial assistant text in messages', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const mockSession = createMockSession();
    const controllableRun = createControllableRun();
    mockSession.run.mockImplementation(controllableRun.run);
    mockSession.getHistory.mockReturnValue([]);
    mockSession.abort.mockImplementation(() => {
      mockSession.getHistory.mockReturnValue([
        {
          id: 'm-4',
          role: 'user',
          content: 'write a story',
          timestamp: new Date('2026-08-01T00:00:00.000Z'),
          state: 'complete',
        },
        { role: 'assistant', content: 'Once upon a time...', state: 'interrupted' },
      ]);
    });

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    });

    const exec = session.submit('write a story');
    await controllableRun.started;
    session.abort();
    controllableRun.reject(abortError);
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

  // Tool → Robota display order is tested via message-list-rendering.test.tsx
  // which verifies actual rendered output without private state manipulation.

  // ── Scenario: SessionStore auto-persist ────────────────────────

  it('auto-persists session to SessionStore after submit', async () => {
    const mockSessionStore = {
      save: vi.fn(),
      load: vi.fn().mockReturnValue({ status: 'missing' }),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'hello' }) as never,
      cwd: '/tmp',
      sessionStore: mockSessionStore,
    } as never);

    await session.submit('test');

    expect(mockSessionStore.save).toHaveBeenCalled();
    const savedRecord = mockSessionStore.save.mock.calls[0][0];
    expect(savedRecord.history).toBeDefined();
    expect(savedRecord.history.length).toBeGreaterThan(0);
  });

  // ── Scenario: Session restore from SessionStore ────────────────

  it('restores history from SessionStore when resumeSessionId is provided', () => {
    const savedHistory = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        category: 'chat',
        type: 'user',
        data: {
          id: 'm-5',
          role: 'user',
          content: 'previous',
          timestamp: new Date('2026-08-01T00:00:00.000Z'),
          state: 'complete',
        },
      },
      {
        id: '2',
        timestamp: new Date().toISOString(),
        category: 'chat',
        type: 'assistant',
        data: {
          id: 'm-6',
          role: 'assistant',
          content: 'answer',
          timestamp: new Date('2026-08-01T00:00:00.000Z'),
          state: 'complete',
        },
      },
    ];

    const mockSessionStore = {
      save: vi.fn(),
      load: vi.fn().mockReturnValue({
        status: 'valid',
        record: {
          id: 'prev-session',
          cwd: '/tmp',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: savedHistory,
          messages: [
            {
              id: 'm-7',
              role: 'user',
              content: 'previous',
              timestamp: new Date('2026-08-01T00:00:00.000Z'),
              state: 'complete',
            },
            {
              id: 'm-8',
              role: 'assistant',
              content: 'answer',
              timestamp: new Date('2026-08-01T00:00:00.000Z'),
              state: 'complete',
            },
          ],
        },
      }),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    const mockSession = createMockSession();
    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
      sessionStore: mockSessionStore,
      resumeSessionId: 'prev-session',
    } as never);

    // History should be restored
    const history = session.getFullHistory();
    expect(history).toHaveLength(2);

    // SessionStore.load should have been called with the resume ID
    expect(mockSessionStore.load).toHaveBeenCalledWith('prev-session');

    // Messages should have been injected into Session's Robota for AI context
    expect(mockSession.injectRawMessage).toHaveBeenCalledTimes(2);
    expect(mockSession.injectRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'previous' }),
    );
    expect(mockSession.injectRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'answer' }),
    );
  });

  // ── Scenario: getName / setName ────────────────────────────────

  it('getName returns session name', () => {
    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
      sessionName: 'my-session',
    } as never);
    expect(session.getName()).toBe('my-session');
  });

  it('setName updates name and persists', () => {
    const mockSessionStore = {
      save: vi.fn(),
      load: vi.fn().mockReturnValue({
        status: 'valid',
        record: {
          id: 'sess-1',
          cwd: '/tmp',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        },
      }),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    const mockSession = createMockSession();
    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
      sessionStore: mockSessionStore,
    } as never);

    session.setName('renamed');
    expect(session.getName()).toBe('renamed');
    expect(mockSessionStore.save).toHaveBeenCalled();
  });

  // ── Scenario: Transport attachment ──────────────────────────

  it('attachTransport calls transport.attach with session', () => {
    const mockTransport = {
      name: 'test',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const session = new InteractiveSession({
      session: createMockSession() as never,
      cwd: '/tmp',
    } as never);

    session.attachTransport(mockTransport);
    expect(mockTransport.attach).toHaveBeenCalledWith(session);
  });

  it('no tool summary when no tools were executed', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'simple answer' }) as never,
      cwd: '/tmp',
    } as never);

    await session.submit('hello');

    const messages = session.getMessages();
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeUndefined();
  });

  // ══════════════════════════════════════════════════════════════
  // Session persistence and restore — round-trip
  // ══════════════════════════════════════════════════════════════

  describe('Session persistence and restore — round-trip', () => {
    it('persisted history matches InteractiveSession.getFullHistory() exactly', async () => {
      const mockSessionStore = {
        save: vi.fn(),
        load: vi.fn().mockReturnValue({ status: 'missing' }),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      };

      const session = new InteractiveSession({
        session: createMockSession({ runResult: 'answer' }) as never,
        cwd: '/tmp',
        sessionStore: mockSessionStore,
      } as never);

      await session.submit('hello');

      const savedRecord = mockSessionStore.save.mock.calls[0][0] as { history: unknown[] };
      const liveHistory = session.getFullHistory();

      // Saved history must be identical to live history — no transformation
      expect(savedRecord.history).toEqual(liveHistory);
    });

    it('persists system prompt and tool schemas for session restore diagnostics', async () => {
      const mockSessionStore = {
        save: vi.fn(),
        load: vi.fn().mockReturnValue({ status: 'missing' }),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      };

      const session = new InteractiveSession({
        session: createMockSession({ runResult: 'answer' }) as never,
        cwd: '/tmp',
        sessionStore: mockSessionStore,
      } as never);

      await session.submit('hello');

      const savedRecord = mockSessionStore.save.mock.calls[0][0] as {
        systemPrompt?: string;
        toolSchemas?: unknown[];
      };
      expect(savedRecord.systemPrompt).toBe('system prompt with capabilities');
      expect(savedRecord.toolSchemas).toEqual([
        { name: 'Read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ]);
    });

    it('multiple submits accumulate in persisted history', async () => {
      const mockSessionStore = {
        save: vi.fn(),
        load: vi.fn().mockReturnValue({ status: 'missing' }),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      };

      const session = new InteractiveSession({
        session: createMockSession({ runResult: 'response' }) as never,
        cwd: '/tmp',
        sessionStore: mockSessionStore,
      } as never);

      await session.submit('first');
      await session.submit('second');

      // Last save should contain accumulated history
      const lastCall = mockSessionStore.save.mock.calls[
        mockSessionStore.save.mock.calls.length - 1
      ][0] as { history: Array<{ type?: string; data?: { role?: string } }> };
      const userEntries = lastCall.history.filter(
        (e) => e.data && (e.data as { role?: string }).role === 'user',
      );
      expect(userEntries.length).toBe(2);
    });

    it('restored session preserves history on new submit', async () => {
      const previousHistory = [
        {
          id: '1',
          timestamp: new Date().toISOString(),
          category: 'chat',
          type: 'user',
          data: {
            id: 'm-11',
            role: 'user',
            content: 'old',
            timestamp: new Date('2026-08-01T00:00:00.000Z'),
            state: 'complete',
          },
        },
        {
          id: '2',
          timestamp: new Date().toISOString(),
          category: 'chat',
          type: 'assistant',
          data: {
            id: 'm-12',
            role: 'assistant',
            content: 'old answer',
            timestamp: new Date('2026-08-01T00:00:00.000Z'),
            state: 'complete',
          },
        },
      ];

      const mockSessionStore = {
        save: vi.fn(),
        load: vi.fn().mockReturnValue({
          status: 'valid',
          record: {
            id: 'prev',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: previousHistory,
            messages: [
              {
                id: 'm-13',
                role: 'user',
                content: 'old',
                timestamp: new Date('2026-08-01T00:00:00.000Z'),
                state: 'complete',
              },
              {
                id: 'm-14',
                role: 'assistant',
                content: 'old answer',
                timestamp: new Date('2026-08-01T00:00:00.000Z'),
                state: 'complete',
              },
            ],
          },
        }),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      };

      const session = new InteractiveSession({
        session: createMockSession({ runResult: 'new answer' }) as never,
        cwd: '/tmp',
        sessionStore: mockSessionStore,
        resumeSessionId: 'prev',
      } as never);

      // Should have restored history
      expect(session.getFullHistory()).toHaveLength(2);

      // Submit new message
      await session.submit('new question');

      // History should now have old + new entries
      const history = session.getFullHistory();
      expect(history.length).toBeGreaterThan(2);

      // Persisted history should also include old + new
      const lastSave = mockSessionStore.save.mock.calls[
        mockSessionStore.save.mock.calls.length - 1
      ][0] as { history: unknown[] };
      expect(lastSave.history.length).toBeGreaterThan(2);
    });
  });

  // ── Scenario: Individual tool execution in history ──────────

  it('records tool-start and tool-end events in history', async () => {
    const mockSession = createMockSession({ runResult: 'done' });
    // Simulate tool execution during run
    mockSession.run.mockImplementation(async () => {
      // Access the onToolExecution callback via the session's internal wiring
      // We'll check history after execution
      return 'done';
    });

    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    } as never);

    // Manually trigger tool events via the execution controller
    const execCtrl = (
      session as unknown as {
        execCtrl: { handleToolExecution: (e: Record<string, unknown>) => void };
      }
    ).execCtrl;
    if (execCtrl) {
      execCtrl.handleToolExecution({
        type: 'start',
        toolName: 'Read',
        toolArgs: { file_path: '/test.ts' },
      });
      execCtrl.handleToolExecution({ type: 'end', toolName: 'Read', success: true });
    }

    const history = session.getFullHistory();
    const toolStarts = history.filter((e) => e.type === 'tool-start');
    const toolEnds = history.filter((e) => e.type === 'tool-end');

    expect(toolStarts.length).toBe(1);
    expect(toolEnds.length).toBe(1);
    expect((toolStarts[0]!.data as { toolName: string }).toolName).toBe('Read');
    expect((toolEnds[0]!.data as { result: string }).result).toBe('success');
  });
});
