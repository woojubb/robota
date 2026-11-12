/**
 * The double's surfaces agree about who the session is — including under an override.
 *
 * `parentSessionId` and the workspace snapshot's `sessionId` must not close over the counter value
 * directly, or a caller overriding `getSession` (the shape the HTTP transport's claim tests in
 * `agent-transport` build) would split the double's identity: the claim key would say one name,
 * every other surface another. That is the cross-surface id collision the counter exists to
 * remove, reopened by the override path.
 */

import { describe, expect, it } from 'vitest';

import { createTestInteractiveSession } from '../testing/index.js';

import type { IInteractiveSession } from '../index.js';

describe('every surface of the double names the same session', () => {
  it('agrees with an OVERRIDDEN getSession', async () => {
    const session = createTestInteractiveSession({
      getSession: () =>
        ({ getSessionId: () => 'renamed-by-the-test' }) as ReturnType<
          IInteractiveSession['getSession']
        >,
    });

    expect(session.getExecutionWorkspaceSnapshot().sessionId).toBe('renamed-by-the-test');
    expect(
      session.createBackgroundJobGroup({ waitPolicy: 'detached', taskIds: [] }).parentSessionId,
    ).toBe('renamed-by-the-test');
    expect(
      (
        await session.spawnAgentJob({
          agentType: 't',
          label: 't',
          mode: 'background',
          prompt: 'p',
        })
      ).parentSessionId,
    ).toBe('renamed-by-the-test');
  });

  it('falls back to its own counter when the override cannot answer', () => {
    // The claim tests deliberately build a getSession that throws, and one that answers ''. The
    // OTHER surfaces still need a name — an unnameable session is the subject under test there,
    // not a double whose workspace snapshot should explode.
    const throwing = createTestInteractiveSession({
      getSession: () => {
        throw new Error('no session bound');
      },
    });
    const empty = createTestInteractiveSession({
      getSession: () =>
        ({ getSessionId: () => '' }) as ReturnType<IInteractiveSession['getSession']>,
    });

    expect(throwing.getExecutionWorkspaceSnapshot().sessionId).toMatch(/^test-session-\d+$/);
    expect(empty.getExecutionWorkspaceSnapshot().sessionId).toMatch(/^test-session-\d+$/);
  });

  it('still names each UN-overridden double distinctly', () => {
    const a = createTestInteractiveSession();
    const b = createTestInteractiveSession();

    expect(a.getSession().getSessionId()).not.toBe(b.getSession().getSessionId());
    expect(a.getExecutionWorkspaceSnapshot().sessionId).toBe(a.getSession().getSessionId());
  });
});
