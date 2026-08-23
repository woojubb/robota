/**
 * The catch around `streamSSE` itself — reached by making the boundary throw.
 *
 * The branch guards the claim when Hono throws BEFORE ever running the relay callback, and for two
 * rounds it shipped as honestly-labelled unverified code: a throw from inside the callback lands in
 * the inner `finally` (measured — a case built that way was green with this catch removed), and the
 * real `streamSSE` has no synchronous throw path today. Review asked for the third option: a
 * synthetic stub AT the module boundary. Mocking `hono/streaming` tests OUR handler's ordering —
 * hold, then release on the boundary's throw — without asserting anything about Hono's internals,
 * which is exactly what the branch is written against.
 */

import { describe, expect, it, vi } from 'vitest';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

vi.mock('hono/streaming', () => ({
  streamSSE: () => {
    throw new Error('the boundary threw before the callback ran');
  },
}));

const { createAgentRoutes } = await import('../routes.js');

describe('a streamSSE that throws synchronously', () => {
  it('does not leave the session claimed forever', async () => {
    const session = createTestInteractiveSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const post = () =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'x' }),
        headers: { 'content-type': 'application/json' },
      });

    const first = await post();
    const second = await post();

    // Both requests fail on the thrown boundary — a 500, not this route's business. What IS this
    // route's business: the second must not be 409. A leaked claim turns every later request into
    // "session busy" forever, and that difference is the whole reason the catch exists.
    expect(first.status).toBe(500);
    expect(second.status, 'the first request took the claim with it').not.toBe(409);
  });
});
