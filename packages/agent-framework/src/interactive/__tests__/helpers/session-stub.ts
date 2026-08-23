/**
 * A minimal `Session` for tests that construct an `InteractiveSession`.
 *
 * Two files had grown their own copy of this, and a third was about to. The copies had already
 * started to differ — one stubbed `shutdown` as resolving a TURN HANDLE, which `Session.shutdown`
 * does not return and no case reads — and a stub that disagrees with the thing it stands in for is a
 * test passing about something else.
 *
 * Both of those files now call this, which is worth stating because the first version of this file
 * claimed the deduplication while leaving them untouched: a helper nobody migrated to is a fourth
 * copy, not one fewer. Review caught that.
 *
 * `overrides` is where a case says what it actually cares about; everything else answers the way a
 * real session would for a test that never exercises it.
 */

import { vi } from 'vitest';

import type { TSubmitFn } from '../../interactive-session-execution-contracts.js';
import type { IExecutionResult } from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';

/** What a turn resolves to when a case does not care about the content. */
export const EMPTY_TURN_RESULT: IExecutionResult = {
  response: '',
  history: [],
  toolSummaries: [],
  contextState: { usedTokens: 0, maxTokens: 0, usedPercentage: 0, remainingPercentage: 100 },
};

/**
 * A `TSubmitFn` for a case that does not exercise submission.
 *
 * `TSubmitFn` promises a handle — narrowed from `ITurnHandle | void` once every path actually
 * returned one — so `async () => {}` no longer stands in for it. That is the point of the narrowing:
 * a stub that answers with nothing was describing a submission shape the code no longer has.
 */
export const stubSubmit: TSubmitFn = async () => ({
  turnId: 'stub-turn',
  completed: Promise.resolve(EMPTY_TURN_RESULT),
});

export function createSessionStub(overrides: Partial<Session> = {}): Session {
  return {
    getSessionId: () => 'session_stub',
    getHistory: () => [],
    getSystemMessage: () => 'system',
    getToolSchemas: () => [],
    getContextState: () => ({
      usedTokens: 0,
      maxTokens: 100,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    abort: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
    ...overrides,
  } as unknown as Session;
}
