import { describe, it, expect, vi } from 'vitest';
import { createHttpTransport } from '../http-transport.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

function createMockSession(): IInteractiveSession {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 200000 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IInteractiveSession;
}

describe('createHttpTransport', () => {
  it('returns an adapter with name "http"', () => {
    const transport = createHttpTransport();
    expect(transport.name).toBe('http');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHttpTransport();
    await expect(transport.start()).rejects.toThrow('No session attached');
  });

  it('throws if getApp() is called before start()', () => {
    const transport = createHttpTransport();
    expect(() => transport.getApp()).toThrow('Transport not started');
  });

  it('creates a Hono app after attach + start', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession() as never);
    await transport.start();
    const app = transport.getApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('nullifies app after stop()', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession() as never);
    await transport.start();
    await transport.stop();
    expect(() => transport.getApp()).toThrow('Transport not started');
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
    // it lives at the seam (`agent-transport-protocol/src/__tests__/admission.test.ts`).
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
