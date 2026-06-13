/**
 * BEHAVIOR-002: `executeRun` must emit context-window updates per agentic round
 * (on `assistant_message_committed`), not only at the start and end of a turn, so the
 * TUI status bar's `Context:` value climbs live during a multi-round turn.
 */

import { createUserMessage } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ContextWindowTracker } from '../context-window-tracker.js';
import { executeRun } from '../session-run.js';

import type { IRunContext } from '../session-run.js';
import type {
  IAIProvider,
  IContextWindowState,
  Robota,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

function assistantMessage(id: string, contentLength: number): TUniversalMessage {
  return {
    id,
    role: 'assistant',
    content: 'x'.repeat(contentLength),
    timestamp: new Date(),
    state: 'complete',
  } as TUniversalMessage;
}

/**
 * Fake Robota whose `run()` drives `onExecutionEvent('assistant_message_committed', …)`
 * `rounds` times, pushing a growing assistant message each round so the context tracker's
 * usedTokens is non-decreasing across emissions.
 */
function createFakeRobota(rounds: number): {
  robota: Robota;
  run: ReturnType<typeof vi.fn>;
} {
  const messages: TUniversalMessage[] = [];
  const run = vi.fn(
    async (
      message: string,
      options?: { onExecutionEvent?: (event: string, data: Record<string, unknown>) => void },
    ): Promise<string> => {
      messages.push(createUserMessage(message));
      for (let r = 0; r < rounds; r++) {
        // Non-round noise that must NOT trigger a context emission.
        options?.onExecutionEvent?.('provider_request', { round: r });
        messages.push(assistantMessage(`assistant_${r}`, 200 * (r + 1)));
        options?.onExecutionEvent?.('assistant_message_committed', { round: r });
        options?.onExecutionEvent?.('history_mutation', { round: r });
      }
      return 'final response';
    },
  );
  const robota = {
    getHistory: (): TUniversalMessage[] => [...messages],
    run,
  } as unknown as Robota;
  return { robota, run };
}

function createProvider(): IAIProvider {
  return {
    name: 'fake-provider',
    version: '1.0.0',
    chat: vi.fn(),
    generateResponse: vi.fn(),
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

function createContext(
  robota: Robota,
  onContextUpdate: (state: IContextWindowState) => void,
): IRunContext {
  return {
    sessionId: 'test-session',
    cwd: '/tmp/test',
    model: 'test-model',
    robota,
    aiProvider: createProvider(),
    // autoCompactThreshold=false so executeRun never tries to compact in this test.
    contextTracker: new ContextWindowTracker('test-model', undefined, false),
    hooks: undefined,
    hookTypeExecutors: undefined,
    sessionStartStdout: '',
    log: vi.fn(),
    compact: vi.fn(async () => {}),
    persistSession: vi.fn(),
    getSessionStore: () => false,
    clearSessionStartStdout: vi.fn(),
    onContextUpdate,
  };
}

describe('executeRun real-time context updates (BEHAVIOR-002)', () => {
  it('TC-01: emits a context update per round, not only at start and end', async () => {
    const updates: IContextWindowState[] = [];
    const { robota } = createFakeRobota(2);
    const ctx = createContext(robota, (state) => updates.push(state));

    await executeRun('hello', undefined, ctx, new AbortController().signal);

    // pre-run (input) + 2 rounds + post-run = at least 4; certainly > 2 (the old behavior).
    expect(updates.length).toBeGreaterThanOrEqual(3);
  });

  it('TC-02: emitted usedTokens are non-decreasing across the turn', async () => {
    const updates: IContextWindowState[] = [];
    const { robota } = createFakeRobota(3);
    const ctx = createContext(robota, (state) => updates.push(state));

    await executeRun('hello', undefined, ctx, new AbortController().signal);

    for (let i = 1; i < updates.length; i++) {
      expect(updates[i]!.usedTokens).toBeGreaterThanOrEqual(updates[i - 1]!.usedTokens);
    }
  });

  it('TC-03: only assistant_message_committed triggers a per-round update, not other events', async () => {
    const updates: IContextWindowState[] = [];
    const { robota } = createFakeRobota(2);
    const ctx = createContext(robota, (state) => updates.push(state));

    await executeRun('hello', undefined, ctx, new AbortController().signal);

    // Per round the fake also fires provider_request + history_mutation (2 noise events each).
    // If those triggered emissions, the count would be much higher. Bound it:
    // pre-run(1) + 2 rounds(2) + post-run(1) = 4 expected; allow exactly that.
    expect(updates.length).toBe(4);
  });
});
