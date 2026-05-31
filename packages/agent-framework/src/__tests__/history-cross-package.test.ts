/**
 * Cross-package integration tests for IHistoryEntry.
 *
 * Verifies the full chain: InteractiveSession → history → persist → load → restore.
 * These tests catch issues that unit tests per package miss.
 */

import {
  createUserMessage,
  createAssistantMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import { describe, it, expect, vi } from 'vitest';

import { InteractiveSession } from '../interactive/interactive-session.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';

function createMockSession(options?: {
  runResult?: string;
  history?: Array<{ role: string; content?: string }>;
}) {
  const history = options?.history ?? [];
  return {
    run: vi.fn().mockResolvedValue(options?.runResult ?? 'mock response'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue(history),
    getFullHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),

    getSystemMessage: vi.fn().mockReturnValue('mock system prompt'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

describe('IHistoryEntry cross-package integration', () => {
  // ── History accumulation across submit cycles ──────────────

  it('history accumulates user + assistant entries across multiple submits', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'answer' }) as never,
      cwd: '/tmp',
    } as never);

    await session.submit('first');
    await session.submit('second');

    const history = session.getFullHistory();
    const userEntries = history.filter((e: IHistoryEntry) => e.type === 'user');
    const assistantEntries = history.filter((e: IHistoryEntry) => e.type === 'assistant');

    expect(userEntries).toHaveLength(2);
    expect(assistantEntries).toHaveLength(2);
  });

  // ── Tool events recorded in history ────────────────────────

  it('tool-start and tool-end events are recorded in history', async () => {
    const mockSession = createMockSession({ runResult: 'done' });
    const session = new InteractiveSession({
      session: mockSession as never,
      cwd: '/tmp',
    } as never);

    // Simulate tool execution via the execution controller
    const execCtrl = (
      session as unknown as {
        execCtrl: { handleToolExecution: (e: Record<string, unknown>) => void };
      }
    ).execCtrl;

    execCtrl.handleToolExecution({
      type: 'start',
      toolName: 'Read',
      toolArgs: { file_path: '/a.ts' },
    });
    execCtrl.handleToolExecution({ type: 'end', toolName: 'Read', success: true });

    const history = session.getFullHistory();
    const starts = history.filter((e: IHistoryEntry) => e.type === 'tool-start');
    const ends = history.filter((e: IHistoryEntry) => e.type === 'tool-end');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect((starts[0].data as { toolName: string }).toolName).toBe('Read');
    expect((ends[0].data as { result: string }).result).toBe('success');
  });

  // ── Persist → load round-trip ──────────────────────────────

  it('persisted history round-trips through SessionStore mock', async () => {
    let savedRecord: Record<string, unknown> | null = null;
    const mockSessionStore = {
      save: vi.fn((record: Record<string, unknown>) => {
        savedRecord = record;
      }),
      load: vi.fn().mockReturnValue(undefined),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'persisted answer' }) as never,
      sessionStore: mockSessionStore,
    } as never);

    await session.submit('test');

    // Verify persist was called
    expect(mockSessionStore.save).toHaveBeenCalled();
    expect(savedRecord).not.toBeNull();

    const persistedHistory = (savedRecord as unknown as Record<string, unknown>)
      .history as IHistoryEntry[];
    expect(persistedHistory.length).toBeGreaterThan(0);

    // Simulate restore: load returns saved record
    mockSessionStore.load.mockReturnValue(savedRecord);

    const restored = new InteractiveSession({
      session: createMockSession() as never,
      sessionStore: mockSessionStore,
      resumeSessionId: 'test-session-id',
    } as never);

    const restoredHistory = restored.getFullHistory();
    expect(restoredHistory).toEqual(persistedHistory);
  });

  // ── TC-03/T-08: tool_use+tool_result round-trip via SessionStore ────────────

  it('TC-03/T-08: tool_use+tool_result pairs round-trip through persist→load→restore with structure intact', () => {
    const toolCalls = [
      {
        id: 'call-abc',
        type: 'function' as const,
        function: { name: 'readFile', arguments: '{"path":"a.ts"}' },
      },
    ];

    const originalMessages = [
      { id: 'u1', role: 'user', content: '파일 읽어줘', state: 'complete', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: null,
        toolCalls,
        state: 'complete',
        timestamp: new Date(),
      },
      {
        id: 't1',
        role: 'tool',
        toolCallId: 'call-abc',
        content: 'a.ts content here',
        state: 'complete',
        timestamp: new Date(),
      },
      {
        id: 'a2',
        role: 'assistant',
        content: '파일을 읽었습니다.',
        state: 'complete',
        timestamp: new Date(),
      },
    ];

    const mockStore = {
      save: vi.fn(),
      load: vi.fn().mockReturnValue({
        id: 'round-trip-session',
        cwd: '/tmp',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        messages: originalMessages,
        history: [],
      }),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    const restoreTarget = createMockSession();

    new InteractiveSession({
      session: restoreTarget as never,
      cwd: '/tmp',
      sessionStore: mockStore,
      resumeSessionId: 'round-trip-session',
    } as never);

    // All 4 messages must have been injected
    expect(restoreTarget.injectRawMessage).toHaveBeenCalledTimes(4);

    // assistant message with toolCalls must preserve structure (not be stringified)
    const injectedAssistant = restoreTarget.injectRawMessage.mock.calls[1]?.[0] as {
      role: string;
      content: null;
      toolCalls: typeof toolCalls;
    };
    expect(injectedAssistant.role).toBe('assistant');
    expect(injectedAssistant.content).toBeNull();
    expect(Array.isArray(injectedAssistant.toolCalls)).toBe(true);
    expect(injectedAssistant.toolCalls[0]?.id).toBe('call-abc');
    expect(injectedAssistant.toolCalls[0]?.function?.name).toBe('readFile');
    expect(typeof injectedAssistant.toolCalls).not.toBe('string');

    // tool message must preserve toolCallId as string (linking back to call-abc)
    const injectedTool = restoreTarget.injectRawMessage.mock.calls[2]?.[0] as {
      role: string;
      toolCallId: string;
      content: string;
    };
    expect(injectedTool.role).toBe('tool');
    expect(injectedTool.toolCallId).toBe('call-abc');
    expect(injectedTool.content).toBe('a.ts content here');
  });

  // ── messageToHistoryEntry preserves data ───────────────────

  it('messageToHistoryEntry creates correct IHistoryEntry for user/assistant/system', () => {
    const userEntry = messageToHistoryEntry(createUserMessage('hello'));
    expect(userEntry.category).toBe('chat');
    expect(userEntry.type).toBe('user');
    expect((userEntry.data as { content: string }).content).toBe('hello');

    const assistantEntry = messageToHistoryEntry(createAssistantMessage('world'));
    expect(assistantEntry.category).toBe('chat');
    expect(assistantEntry.type).toBe('assistant');
    expect((assistantEntry.data as { content: string }).content).toBe('world');
  });

  // ── History entries have required fields ────────────────────

  it('all history entries have id, timestamp, category, type', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'test' }) as never,
      cwd: '/tmp',
    } as never);

    await session.submit('test');

    for (const entry of session.getFullHistory()) {
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.category).toBeDefined();
      expect(entry.type).toBeDefined();
    }
  });
});
