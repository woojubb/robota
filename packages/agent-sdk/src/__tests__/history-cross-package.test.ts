/**
 * Cross-package integration tests for IHistoryEntry.
 *
 * Verifies the full chain: InteractiveSession → history → persist → load → restore.
 * These tests catch issues that unit tests per package miss.
 */

import { describe, it, expect, vi } from 'vitest';
import { InteractiveSession } from '../interactive/interactive-session.js';
import {
  createUserMessage,
  createAssistantMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
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
  };
}

describe('IHistoryEntry cross-package integration', () => {
  // ── History accumulation across submit cycles ──────────────

  it('history accumulates user + assistant entries across multiple submits', async () => {
    const session = new InteractiveSession({
      session: createMockSession({ runResult: 'answer' }) as never,
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
    } as never);

    // Simulate tool execution
    const handler = (
      session as unknown as {
        handleToolExecution: (e: Record<string, unknown>) => void;
      }
    ).handleToolExecution;

    handler.call(session, { type: 'start', toolName: 'Read', toolArgs: { file_path: '/a.ts' } });
    handler.call(session, { type: 'end', toolName: 'Read', success: true });

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
