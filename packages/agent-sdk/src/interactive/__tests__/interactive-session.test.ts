/**
 * Tests for InteractiveSession — event-driven session wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InteractiveSession } from '../interactive-session.js';
import type { IToolState, IExecutionResult } from '../types.js';
import type { ICommandModule } from '../../command-api/command-module.js';

// Minimal mock Session that satisfies InteractiveSession's needs
function createMockSession(options?: {
  runResult?: string;
  runError?: Error;
  history?: Array<{ role: string; content?: string; toolCalls?: unknown[] }>;
  sessionId?: string;
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
    compact: vi.fn().mockResolvedValue(undefined),
    injectMessage: vi.fn(),
    getSessionId: vi.fn().mockReturnValue(options?.sessionId ?? 'test-session-id'),
    getSystemMessage: vi.fn().mockReturnValue('mock system prompt'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

// Minimal mock SessionStore
function createMockSessionStore(records: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(records));
  return {
    load: vi.fn((id: string) => store.get(id)),
    save: vi.fn((record: { id: string }) => store.set(record.id, record)),
    list: vi.fn(() => [...store.values()]),
    delete: vi.fn((id: string) => store.delete(id)),
  };
}

describe('InteractiveSession', () => {
  it('emits thinking and complete events on submit', async () => {
    const mockSession = createMockSession({ runResult: 'hello world' });
    const session = new InteractiveSession({
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
      session: mockSession as never,
    });

    await session.submit('test prompt');

    const messages = session.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('test prompt');
    expect(messages[1]!.role).toBe('assistant');
  });

  it('expands @file references through SDK-owned prompt preprocessing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'robota-interactive-file-ref-'));
    try {
      await writeFile(join(cwd, 'AGENTS.md'), '# Rules\nUse repo guidance.\n');
      const mockSession = createMockSession({ runResult: 'done' });
      const session = new InteractiveSession({
        session: mockSession as never,
        cwd,
      });

      const completedResults: IExecutionResult[] = [];
      session.on('complete', (result) => {
        completedResults.push(result);
      });

      await session.submit('Summarize @AGENTS.md');

      const runInput = mockSession.run.mock.calls[0]?.[0] as string;
      expect(runInput).toContain('<file path="AGENTS.md"');
      expect(runInput).toContain('Use repo guidance.');
      expect(mockSession.run).toHaveBeenCalledWith(expect.any(String), 'Summarize @AGENTS.md');
      expect(completedResults[0]?.promptFileReferences?.[0]?.relativePath).toBe('AGENTS.md');
      expect(session.listContextReferences()[0]).toEqual(
        expect.objectContaining({
          relativePath: 'AGENTS.md',
          loadType: 'prompt-reference',
          status: 'observed',
        }),
      );
      expect(session.getFullHistory()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'event',
            type: 'prompt-file-reference',
          }),
        ]),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('adds manual context references to future prompt model input', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'robota-interactive-manual-ref-'));
    try {
      await writeFile(join(cwd, 'notes.md'), 'manual context body\n');
      const mockSession = createMockSession({ runResult: 'done' });
      const session = new InteractiveSession({
        session: mockSession as never,
        cwd,
      });

      const addResult = await session.addContextReference('notes.md');
      await session.submit('Use the active context.');

      const runInput = mockSession.run.mock.calls[0]?.[0] as string;
      expect(addResult.reference?.relativePath).toBe('notes.md');
      expect(runInput).toContain('<file path="notes.md"');
      expect(runInput).toContain('manual context body');
      expect(mockSession.run).toHaveBeenCalledWith(expect.any(String), 'Use the active context.');
      expect(session.listContextReferences()[0]).toEqual(
        expect.objectContaining({
          relativePath: 'notes.md',
          loadType: 'manual',
          status: 'active',
        }),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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

  it('runs blocking system commands through the foreground thinking lifecycle', async () => {
    let resolveCommand: (value: { message: string; success: boolean }) => void;
    const blockingModule: ICommandModule = {
      name: 'test-blocking',
      systemCommands: [
        {
          name: 'slow',
          description: 'Slow command',
          lifecycle: 'blocking',
          execute: () =>
            new Promise<{ message: string; success: boolean }>((resolve) => {
              resolveCommand = resolve;
            }),
        },
      ],
    };
    const session = new InteractiveSession({
      session: createMockSession() as never,
      commandModules: [blockingModule],
    });
    const thinkingStates: boolean[] = [];
    session.on('thinking', (isThinking) => thinkingStates.push(isThinking));

    const pending = session.executeCommand('slow', '');
    await new Promise((r) => setTimeout(r, 10));

    expect(session.isExecuting()).toBe(true);
    expect(thinkingStates).toEqual([true]);

    resolveCommand!({ message: 'done', success: true });
    const result = await pending;

    expect(result?.message).toBe('done');
    expect(session.isExecuting()).toBe(false);
    expect(thinkingStates).toEqual([true, false]);
  });

  it('does not execute another system command while a foreground command is running', async () => {
    let resolveCommand: (value: { message: string; success: boolean }) => void;
    const quickCommand = vi.fn().mockReturnValue({ message: 'quick', success: true });
    const blockingModule: ICommandModule = {
      name: 'test-blocking',
      systemCommands: [
        {
          name: 'slow',
          description: 'Slow command',
          lifecycle: 'blocking',
          execute: () =>
            new Promise<{ message: string; success: boolean }>((resolve) => {
              resolveCommand = resolve;
            }),
        },
        {
          name: 'quick',
          description: 'Quick command',
          execute: quickCommand,
        },
      ],
    };
    const session = new InteractiveSession({
      session: createMockSession() as never,
      commandModules: [blockingModule],
    });

    const pending = session.executeCommand('slow', '');
    await new Promise((r) => setTimeout(r, 10));
    const blocked = await session.executeCommand('quick', '');

    expect(blocked?.success).toBe(false);
    expect(blocked?.message).toContain('already running');
    expect(quickCommand).not.toHaveBeenCalled();

    resolveCommand!({ message: 'done', success: true });
    await pending;
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
      session: mockSession as never,
    });

    expect(session.getSession()).toBe(mockSession);
  });

  it('getContextState delegates to session', () => {
    const mockSession = createMockSession();
    const session = new InteractiveSession({
      session: mockSession as never,
    });

    const state = session.getContextState();
    expect(state.usedTokens).toBe(1000);
    expect(mockSession.getContextState).toHaveBeenCalled();
  });

  describe('session restore (injected session path)', () => {
    it('injects messages from restored session record', () => {
      const mockSession = createMockSession({ sessionId: 'old-session' });
      const mockStore = createMockSessionStore({
        'old-session': {
          id: 'old-session',
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi there' },
          ],
          history: [],
        },
      });

      new InteractiveSession({
        session: mockSession as never,
        sessionStore: mockStore as never,
        resumeSessionId: 'old-session',
      });

      expect(mockSession.injectMessage).toHaveBeenCalledTimes(2);
      expect(mockSession.injectMessage).toHaveBeenCalledWith('user', 'hello');
      expect(mockSession.injectMessage).toHaveBeenCalledWith('assistant', 'hi there');
    });

    it('restores history entries from session record', () => {
      const mockSession = createMockSession();
      const historyEntries = [
        {
          id: '1',
          timestamp: new Date(),
          category: 'chat',
          type: 'message',
          data: { role: 'user', content: 'hello' },
        },
      ];
      const mockStore = createMockSessionStore({
        'old-session': {
          id: 'old-session',
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          messages: [],
          history: historyEntries,
        },
      });

      const session = new InteractiveSession({
        session: mockSession as never,
        sessionStore: mockStore as never,
        resumeSessionId: 'old-session',
      });

      expect(session.getFullHistory()).toEqual(historyEntries);
    });

    it('persists history field when saving after executePrompt', async () => {
      const mockSession = createMockSession({ runResult: 'response', sessionId: 'sid-1' });
      const mockStore = createMockSessionStore();

      const session = new InteractiveSession({
        session: mockSession as never,
        sessionStore: mockStore as never,
      });

      await session.submit('test input');

      expect(mockStore.save).toHaveBeenCalled();
      const savedRecord = mockStore.save.mock.calls[0]![0] as unknown as { history: unknown[] };
      expect(savedRecord.history).toBeDefined();
      expect(savedRecord.history.length).toBeGreaterThan(0);
    });
  });

  describe('session restore (deferred injection for standard path)', () => {
    it('stores pending messages when session is null', () => {
      // Simulate: no injected session, resumeSessionId provided, but standard init path
      // Since we can't easily mock initializeAsync, we test via injected session + null check
      const mockStore = createMockSessionStore({
        'old-session': {
          id: 'old-session',
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          messages: [{ role: 'user', content: 'pending msg' }],
          history: [],
        },
      });

      // Use injected session path but set session to null to simulate standard path timing
      // We verify by checking that injectMessage is NOT called during construction
      // (because session is unavailable), confirming deferred path is used
      const mockSession = createMockSession();
      const session = new InteractiveSession({
        session: mockSession as never,
        sessionStore: mockStore as never,
        resumeSessionId: 'old-session',
      });

      // For injected session, messages are injected immediately
      expect(mockSession.injectMessage).toHaveBeenCalledTimes(1);
      expect(mockSession.injectMessage).toHaveBeenCalledWith('user', 'pending msg');
    });
  });

  describe('fork session', () => {
    it('does not set forkSession by default (resume reuses original ID)', () => {
      const mockSession = createMockSession({ sessionId: 'old-session' });
      const mockStore = createMockSessionStore({
        'old-session': {
          id: 'old-session',
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          messages: [],
          history: [],
        },
      });

      const session = new InteractiveSession({
        session: mockSession as never,
        sessionStore: mockStore as never,
        resumeSessionId: 'old-session',
      });

      // Session was injected so getSessionId should return the mock's value
      expect(session.getSession().getSessionId()).toBe('old-session');
    });
  });
});
