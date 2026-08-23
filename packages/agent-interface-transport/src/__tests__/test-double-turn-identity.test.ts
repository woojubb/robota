import { describe, expect, expectTypeOf, it } from 'vitest';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import { createTestInteractiveSession } from '../testing/index.js';

describe('createTestInteractiveSession turn identity (ARCH-019)', () => {
  it('mints deterministic per-call ids and settles each handle', async () => {
    const firstSession = createTestInteractiveSession();
    const sessionId = firstSession.getSession().getSessionId();

    const first = await firstSession.submit('first');
    const second = await firstSession.submit('second');

    expect(first.turnId).toBe(`${sessionId}-turn-1`);
    expect(second.turnId).toBe(`${sessionId}-turn-2`);
    await expect(first.completed).resolves.toMatchObject({ response: '' });
    await expect(second.completed).resolves.toMatchObject({ response: '' });

    const secondSession = createTestInteractiveSession();
    const secondSessionId = secondSession.getSession().getSessionId();
    const secondSessionFirst = await secondSession.submit('first');
    expect(secondSessionFirst.turnId).toBe(`${secondSessionId}-turn-1`);
  });

  it('uses the resolved session id and preserves submit overrides', async () => {
    const named = createTestInteractiveSession({
      getSession: () => ({ getSessionId: () => 'named-session' }),
    });
    expect((await named.submit('named')).turnId).toBe('named-session-turn-1');

    const empty = createTestInteractiveSession({
      getSession: () => ({ getSessionId: () => '' }),
    });
    expect((await empty.submit('empty')).turnId).toMatch(/^test-session-\d+-turn-1$/);

    const throwing = createTestInteractiveSession({
      getSession: () => {
        throw new Error('deliberate test override');
      },
    });
    expect((await throwing.submit('throwing')).turnId).toMatch(/^test-session-\d+-turn-1$/);

    const completed = Promise.resolve({
      response: 'custom',
      history: [],
      toolSummaries: [],
      contextState: {
        usedTokens: 0,
        maxTokens: 1,
        usedPercentage: 0,
        remainingPercentage: 100,
      },
    });
    const custom = createTestInteractiveSession({
      submit: async () => ({ turnId: 'custom-turn', completed }),
    });
    expect((await custom.submit('custom')).turnId).toBe('custom-turn');
  });

  it('keeps the nested transport session identity-only', () => {
    const session = createTestInteractiveSession();
    expectTypeOf(session.getSession).returns.toEqualTypeOf<
      ReturnType<IInteractiveSession['getSession']>
    >();
    expect(Object.keys(session.getSession())).toEqual(['getSessionId']);
  });
});
