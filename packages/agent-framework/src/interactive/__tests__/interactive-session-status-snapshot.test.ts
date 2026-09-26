/**
 * #3186 — one status read for every client: the terminal, desktop and browser clients render the
 * session's model, permission mode, effort and context from the same snapshot.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

function mockSession(): Record<string, unknown> {
  return {
    run: vi.fn(),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 12, usedTokens: 1200, maxTokens: 10000, remainingPercentage: 88 }),
    getSessionId: vi.fn().mockReturnValue('s-1'),
    getModelId: vi.fn().mockReturnValue('claude-sonnet-5'),
    getPermissionMode: vi.fn().mockReturnValue('acceptEdits'),
    getModelEffort: vi.fn().mockReturnValue('high'),
    getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getSystemMessage: vi.fn().mockReturnValue(''),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

describe('InteractiveSession.getStatusSnapshot', () => {
  it('reads the session, model, settings and context in one snapshot', () => {
    const session = new InteractiveSession({
      session: mockSession() as never,
      cwd: '/tmp',
      sessionName: 'parity-test',
    });
    expect(session.getStatusSnapshot()).toEqual({
      sessionId: 's-1',
      sessionName: 'parity-test',
      model: 'claude-sonnet-5',
      permissionMode: 'acceptEdits',
      effort: 'high',
      context: { usedPercentage: 12, usedTokens: 1200, maxTokens: 10000, remainingPercentage: 88 },
    });
  });

  it('leaves the name out of an unnamed session', () => {
    const session = new InteractiveSession({ session: mockSession() as never, cwd: '/tmp' });
    expect(session.getStatusSnapshot()).not.toHaveProperty('sessionName');
  });
});
