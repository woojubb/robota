/**
 * A minimal `Session` for tests that construct an `InteractiveSession`.
 *
 * Two files had grown their own copy of this, and a third was about to. The copies had already
 * started to differ — one stubbed `shutdown` as resolving a TURN HANDLE, which `Session.shutdown`
 * does not return and no case reads — and a stub that disagrees with the thing it stands in for is a
 * test passing about something else.
 *
 * `overrides` is where a case says what it actually cares about; everything else answers the way a
 * real session would for a test that never exercises it.
 */

import { vi } from 'vitest';

import type { Session } from '@robota-sdk/agent-session';

/** What a turn resolves to when a case does not care about the content. */
export const EMPTY_TURN_RESULT = {
  response: '',
  history: [],
  toolSummaries: [],
  contextState: { usedTokens: 0, maxTokens: 0, usedPercentage: 0, remainingPercentage: 100 },
};

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
