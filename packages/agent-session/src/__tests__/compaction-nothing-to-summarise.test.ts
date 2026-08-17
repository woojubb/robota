/**
 * CORE-031 — a compaction with nothing to summarise must not replace the conversation.
 *
 * `session-history-ops.compact()` guarded on the FULL history and then compacted a DIFFERENT array:
 * it filters system messages out before calling the orchestrator. So a conversation consisting only
 * of system messages passed the guard with a non-empty history, reached the orchestrator with an
 * empty one, took its `return ''` shortcut, and came back as a summary the caller then wrote over
 * the conversation with — clearing it and injecting an empty `[Context Summary]` block.
 *
 * That path is reachable from the product: `/compact` is a user-invocable command
 * (`packages/agent-command/src/compact/compact-command-module.ts`) and a fresh session holds exactly
 * one message, the system message, before the first turn.
 *
 * The two halves are tested where they live. The guard belongs to the caller, which is the only
 * thing that knows a system-only conversation is a no-op rather than an error. The orchestrator's
 * `''` contradicted its own documented contract ("always a non-empty string") and was the value that
 * made the overwrite possible, so an empty history reaching it is now a broken invariant, not a
 * silent shortcut.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CompactionError, CompactionOrchestrator } from '../compaction-orchestrator.js';
import { Session } from '../session.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

let mockHistory: Array<{ role: string; content: string | null }> = [];
let mockInjectCalls: Array<{ role: string; content: string }> = [];
let mockClearCount = 0;

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn(),
      getHistory: vi.fn().mockImplementation(() => mockHistory),
      clearHistory: vi.fn().mockImplementation(() => {
        mockClearCount++;
        mockHistory = [];
      }),
      injectMessage: vi.fn().mockImplementation((role: string, content: string) => {
        mockInjectCalls.push({ role, content });
        mockHistory.push({ role, content });
      }),
    })),
    runHooks: vi.fn().mockResolvedValue({ blocked: false, stdout: '' }),
  };
});

let providerChatCalls = 0;

function createMockProvider(): never {
  providerChatCalls = 0;
  return {
    name: 'mock',
    chat: vi.fn().mockImplementation(async () => {
      providerChatCalls++;
      return {
        role: 'assistant',
        content: 'summary of the conversation so far',
        timestamp: new Date(),
      };
    }),
  } as never;
}

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

function createSession(): Session {
  return new Session({
    cwd: process.cwd(),
    tools: [] as never,
    provider: createMockProvider(),
    systemMessage: 'test system',
    terminal: MOCK_TERMINAL,
    model: 'claude-sonnet-4-6',
  });
}

beforeEach(() => {
  mockHistory = [];
  mockInjectCalls = [];
  mockClearCount = 0;
  providerChatCalls = 0;
});

describe('CORE-031 — nothing to summarise is a no-op, not a summary', () => {
  it('leaves a system-messages-only conversation untouched', async () => {
    const session = createSession();
    // Exactly what a fresh session holds when `/compact` is the first thing the user types.
    mockHistory = [{ role: 'system', content: 'test system' }];

    await session.compact();

    expect(providerChatCalls).toBe(0);
    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls).toEqual([]);
    expect(mockHistory).toEqual([{ role: 'system', content: 'test system' }]);
  });

  it('leaves a conversation of several system messages untouched', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'system', content: 'test system' },
      { role: 'system', content: 'project context' },
    ];

    await session.compact();

    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls).toEqual([]);
    expect(mockHistory).toHaveLength(2);
  });

  it('leaves an entirely empty conversation untouched', async () => {
    const session = createSession();
    mockHistory = [];

    await session.compact();

    expect(providerChatCalls).toBe(0);
    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls).toEqual([]);
  });

  it('still reports a cancelled turn as cancelled, even with nothing to compact (RUNTIME-004)', async () => {
    const session = createSession();
    // The orchestrator used to make this check for us. The CORE-031 early return happens before the
    // orchestrator is reached, so the caller has to keep the abort contract itself — otherwise a
    // cancelled no-op resolves quietly and the contract narrows to "rejects if cancelled AND there
    // was work", which is a different promise from the one RUNTIME-004 made.
    mockHistory = [{ role: 'system', content: 'test system' }];

    await expect(session.compact(undefined, 'manual', AbortSignal.abort())).rejects.toThrow();
    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls).toEqual([]);
  });

  it('still replaces the conversation when there IS something to summarise', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'system', content: 'test system' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    await session.compact();

    expect(providerChatCalls).toBe(1);
    expect(mockClearCount).toBe(1);
    expect(mockInjectCalls).toHaveLength(2);
    expect(mockInjectCalls[1].content).toContain('summary of the conversation so far');
  });

  it('the orchestrator treats an empty history as a broken invariant, never a summary', async () => {
    const orchestrator = new CompactionOrchestrator({
      sessionId: 'core-031-test',
      cwd: process.cwd(),
      model: 'test-model',
    });
    const provider = {
      name: 'never-called',
      chat: async () => ({
        id: randomUUID(),
        role: 'assistant' as const,
        content: 'a summary nobody asked for',
        state: 'complete' as const,
        timestamp: new Date(),
      }),
    } as IAIProvider;

    // The value that made the overwrite possible was `''` — a string the caller happily wrote over
    // the conversation with. It must not come back at all.
    await expect(orchestrator.compact(provider, [])).rejects.toBeInstanceOf(CompactionError);
  });
});
