import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, it, expect, expectTypeOf } from 'vitest';
import { createHttpTransport } from '../http-transport.js';
import type { IHttpTransportSession } from '../http-session.js';
import type { IHttpTransport } from '../http-transport.js';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';

function createMockSession(): IHttpTransportSession {
  const full = createTestInteractiveSession();
  const {
    submit,
    on,
    off,
    abort,
    cancelQueue,
    getSession,
    executeCommand,
    listCommands,
    listSkills,
    getMessages,
    getContextState,
    isExecuting,
    getPendingPrompt,
    getPendingCount,
  } = full;
  return {
    submit,
    on,
    off,
    abort,
    cancelQueue,
    getSession,
    executeCommand,
    listCommands,
    listSkills,
    getMessages,
    getContextState,
    isExecuting,
    getPendingPrompt,
    getPendingCount,
  };
}

describe('createHttpTransport', () => {
  it('requires exactly the HTTP session port without a broad attach overload', () => {
    const transport = createHttpTransport();
    expectTypeOf(transport).toMatchTypeOf<ITransportAdapter<IHttpTransportSession>>();
    expectTypeOf<IHttpTransport['attach']>().toEqualTypeOf<
      (session: IHttpTransportSession) => void
    >();
    expectTypeOf<IHttpTransportSession>().not.toHaveProperty('listRuntimeTools');
    expect(Object.keys(createMockSession())).toHaveLength(14);
  });

  it('returns an adapter with name "http"', () => {
    const transport = createHttpTransport();
    expect(transport.name).toBe('http');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHttpTransport();
    await expect(transport.start()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'not-attached',
    });
  });

  it('throws if getApp() is called before start()', () => {
    const transport = createHttpTransport();
    expect(() => transport.getApp()).toThrow('Transport not started');
  });

  it('creates a Hono app after attach + start', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession());
    await transport.start();
    const app = transport.getApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('nullifies app after stop()', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession());
    await transport.start();
    await transport.stop();
    expect(() => transport.getApp()).toThrow('Transport not started');
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-http#createHttpTransport',
      kind: 'service',
      createAdapter: () =>
        createHttpTransport({
          admission: { open: true, openReason: 'ARCH-011 lifecycle conformance' },
        }),
      createSession: createMockSession,
      assertReady: (transport) => {
        if (typeof transport.getApp().fetch !== 'function') throw new Error('HTTP app not ready');
      },
      assertStopped: (transport) => {
        try {
          transport.getApp();
          throw new Error('HTTP app still ready');
        } catch (error) {
          if (!(error instanceof Error) || error.message === 'HTTP app still ready') throw error;
        }
      },
    });
  });
});

describe('SEC-008: the decision is resolved once', () => {
  it('requires the credential it minted, not a second one', async () => {
    // The transport resolved admission at construction and then rebuilt a CONFIG for the routes to
    // resolve again. Two resolutions of one decision: harmless while a token was given, and a fresh
    // mint on the second pass if the first had opened without a reason — so the credential the host
    // was handed by `getAdmissionToken()` would not be the one the routes required.
    const transport = createHttpTransport();
    transport.attach(createMockSession());
    await transport.start();
    const token = transport.getAdmissionToken();

    expect(token).not.toBeNull();
    const refused = await transport.getApp().request('/executing');
    const admitted = await transport
      .getApp()
      .request('/executing', { headers: { authorization: `Bearer ${token}` } });

    expect(refused.status).toBe(401);
    expect(admitted.status, 'the token the host was handed does not open the door').toBe(200);
  });

  it('MINTS for `token: ""`, and the host is handed what it must present', async () => {
    // `{ token: '' }` is documented as "mint a fresh one". This pins the outcome end to end.
    //
    // It does NOT red-prove the discriminator defect, and saying so is the point of this comment:
    // `createHttpTransport` resolves at construction, so the routes it builds receive an
    // already-resolved admission and the discriminator handled that case correctly. The defect was
    // only reachable through `createAgentRoutes` DIRECTLY — measured, this case passes either way.
    //
    // Through that direct path the defect has no black-box symptom either: "requires the empty
    // string" and "requires a token you were not given" are both 401 forever, because
    // `bearerCredential` requires at least one character after `Bearer ` and so a presented
    // credential is never the empty string. It is a LOCKOUT, not a bypass. That is exactly why the
    // fix deletes the discriminator instead of testing around it, and why the case that IS red on
    // it lives at the seam (`agent-transport/src/__tests__/admission.test.ts`).
    const transport = createHttpTransport({ admission: { token: '' } });
    transport.attach(createMockSession());
    await transport.start();
    const token = transport.getAdmissionToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const admitted = await transport
      .getApp()
      .request('/executing', { headers: { authorization: `Bearer ${token}` } });
    expect(admitted.status, 'the token the host was handed does not open the door').toBe(200);
  });
});
