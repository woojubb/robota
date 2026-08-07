/**
 * Tests for HTTP transport routes.
 * Uses Hono's built-in test client — no real HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

import { createAgentRoutes } from '../routes.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

function createMockSession(overrides?: Record<string, unknown>) {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({
      message: 'Conversation cleared.',
      success: true,
    }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as IInteractiveSession;
}

describe('HTTP Transport Routes', () => {
  function createApp(session?: IInteractiveSession) {
    const mockSession = session ?? createMockSession();
    const app = createAgentRoutes({
      sessionFactory: () => mockSession,
      // SEC-008: these cases predate the trust boundary and are about what each route DOES. They say
      // so rather than carrying a credential, so a reader can tell "admission is not under test" from
      // "admission was forgotten" — which is the distinction the boundary exists to make possible.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    return { app, mockSession };
  }

  // ── POST /abort ───────────────────────────────────────────────

  it('POST /abort calls session.abort()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/abort', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSession.abort).toHaveBeenCalled();
  });

  // ── POST /cancel-queue ────────────────────────────────────────

  it('POST /cancel-queue calls session.cancelQueue()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/cancel-queue', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSession.cancelQueue).toHaveBeenCalled();
  });

  // ── GET /messages ─────────────────────────────────────────────

  it('GET /messages returns message history', async () => {
    const { app } = createApp();
    const res = await app.request('/messages');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe('user');
    expect(body[1].role).toBe('assistant');
  });

  // ── GET /context ──────────────────────────────────────────────

  it('GET /context returns context window state', async () => {
    const { app } = createApp();
    const res = await app.request('/context');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usedTokens).toBe(1000);
    expect(body.maxTokens).toBe(200000);
  });

  // ── GET /executing ────────────────────────────────────────────

  it('GET /executing returns execution status', async () => {
    const { app } = createApp();
    const res = await app.request('/executing');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ executing: false });
  });

  // ── GET /pending ──────────────────────────────────────────────

  it('GET /pending returns null when no queue', async () => {
    const { app } = createApp();
    const res = await app.request('/pending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: null });
  });

  it('GET /pending returns queued prompt', async () => {
    const mockSession = createMockSession({
      getPendingPrompt: vi.fn().mockReturnValue('queued prompt'),
    });
    const { app } = createApp(mockSession);
    const res = await app.request('/pending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 'queued prompt' });
  });

  // ── POST /command ─────────────────────────────────────────────

  it('POST /command executes system command via session.executeCommand()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'clear', args: '' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Conversation cleared.');
    // SEC-008: the call now carries its origin — a peer over HTTP is 'remote', not the operator.
    expect(mockSession.executeCommand).toHaveBeenCalledWith('clear', '', 'remote');
  });

  it('POST /command returns 400 without name', async () => {
    const { app } = createApp();
    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /command returns 404 for unknown command', async () => {
    const mockSession = createMockSession({
      executeCommand: vi.fn().mockResolvedValue(null),
    });
    const { app } = createApp(mockSession);

    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  // ── POST /submit validation ───────────────────────────────────

  it('POST /submit returns 400 without prompt', async () => {
    const { app } = createApp();
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // ── POST /submit completion (decoupled from thinking(false)) ──────
  //
  // Regression guard for ARL-04: the /submit done-promise must resolve from the
  // terminal handler (complete/interrupted/error), and the terminal SSE event must
  // be flushed to the client, WITHOUT relying on a trailing thinking(false). Each
  // scripted session emits ONLY its terminal event (no trailing thinking event).

  /**
   * Build a session whose on/off truly register handlers and whose submit()
   * emits exactly one terminal event with NO trailing thinking(false).
   */
  function createEmitterSession(terminalEvent: string, terminalData: unknown) {
    const handlers = new Map<string, Set<(data: unknown) => void>>();
    const session = createMockSession({
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      submit: vi.fn(async () => {
        // Emit ONLY the terminal event — deliberately no trailing thinking(false).
        for (const handler of handlers.get(terminalEvent) ?? []) {
          handler(terminalData);
        }
      }),
    });
    return session;
  }

  async function requestSubmit(session: IInteractiveSession): Promise<string> {
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(200);
    // Draining the SSE body must complete (no hang) and contain the terminal event.
    return res.text();
  }

  it('POST /submit receives the complete event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('complete', { ok: true });
    const body = await requestSubmit(session);
    expect(body).toContain('event: complete');
    expect(body).toContain('"ok":true');
  });

  it('POST /submit receives the interrupted event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('interrupted', { reason: 'user' });
    const body = await requestSubmit(session);
    expect(body).toContain('event: interrupted');
    expect(body).toContain('"reason":"user"');
  });

  it('POST /submit receives the error event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('error', new Error('boom'));
    const body = await requestSubmit(session);
    expect(body).toContain('event: error');
    expect(body).toContain('"message":"boom"');
  });

  // ── ARCH-004 RUNTIME-38: reject concurrent /submit on a busy session ──

  it('POST /submit returns 409 while a turn is already in flight (isExecuting)', async () => {
    const { app } = createApp(createMockSession({ isExecuting: vi.fn().mockReturnValue(true) }));
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(409);
  });

  // ── ARCH-004 RUNTIME-14: SSE teardown always removes every listener (no leak) ──

  it('POST /submit unsubscribes every listener it added once the stream completes', async () => {
    const session = createEmitterSession('complete', { ok: true });
    await requestSubmit(session);
    // The try/finally teardown must `off` exactly what it `on`'d — a balanced count means zero leaked listeners.
    const onCount = (session.on as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const offCount = (session.off as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(offCount).toBe(onCount);
    expect(onCount).toBeGreaterThan(0);
  });

  /**
   * The load-bearing RUNTIME-14 case: a client that disconnects MID-STREAM (before any terminal event). The
   * pre-fix code ran cleanup only after `await done`, and `done` resolved solely on complete/interrupted/error
   * — so a disconnect leaked every listener forever. The fix's `stream.onAbort` must cancel the run
   * (`session.abort()`) and unblock `done` so the `finally` teardown runs.
   */
  it('POST /submit tears down + aborts the run when the client disconnects mid-stream', async () => {
    const handlers = new Map<string, Set<(data: unknown) => void>>();
    let settleSubmit: (() => void) | undefined;
    const session = createMockSession({
      isExecuting: vi.fn().mockReturnValue(false),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      // A run that never emits a terminal event on its own — it settles only when abort() is called.
      submit: vi.fn(() => new Promise<void>((resolve) => (settleSubmit = resolve))),
      abort: vi.fn(() => settleSubmit?.()),
    });

    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(200);

    // Let the handler subscribe + enter the in-flight `submit()`, then cancel the response stream — the
    // Web-standard equivalent of a client disconnecting mid-stream (Hono fires `stream.onAbort`).
    const reader = res.body!.getReader();
    await new Promise((r) => setTimeout(r, 20));
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20)); // let onAbort → session.abort() + the finally teardown run

    expect(session.abort).toHaveBeenCalled(); // onAbort cancelled the run, not just stopped writing
    const onCount = (session.on as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const offCount = (session.off as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(offCount).toBe(onCount); // finally teardown removed every listener — no leak
    expect(onCount).toBeGreaterThan(0);
  });
});

// ── SEC-008: the route is a trust boundary, not a pass-through ───────────────

describe('SEC-008: an unadmitted request never reaches the session', () => {
  /**
   * A session that records whether anything actually got through to it.
   *
   * Built on the PUBLISHED conformant double rather than another cast to the contract. A cast is a
   * partial re-implementation nothing checks against the real thing: it compiles whatever it happens
   * to contain, so a member the contract gains later is simply missing here and the suite keeps
   * passing.
   */
  function createRecordingSession() {
    const reached: string[] = [];
    const session = createTestInteractiveSession({
      submit: async (prompt: string) => {
        reached.push(`submit:${prompt}`);
        // No cast. `submit` returns void on this branch, and the typed override says so — the
        // earlier `as never` would have accepted a handle here and compiled, which is the blindness
        // the conformant double exists to remove. (RUNTIME-003 changes this return type; that lands
        // on its own branch, and the type is what will tell this file about it.)
      },
      executeCommand: async (name: string) => {
        reached.push(`command:${name}`);
        return { message: 'ran', success: true };
      },
    });
    return { session, reached };
  }

  const CREDENTIAL = 'a'.repeat(64);

  it('refuses POST /submit with no credential, before the prompt runs', async () => {
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    const res = await app.request('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'run something' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(401);
    // The status alone would not be enough. What matters is that the prompt did not execute — a
    // route that runs the turn and THEN reports 401 has already done the thing it refused.
    expect(reached, 'the prompt reached the session despite the refusal').toEqual([]);
  });

  it('refuses POST /command with no credential, before the command runs', async () => {
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    const res = await app.request('/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'clear', args: '' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(401);
    expect(reached, 'the command reached the session despite the refusal').toEqual([]);
  });

  it('refuses a WRONG credential the same way it refuses a missing one', async () => {
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    const res = await app.request('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'run something' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${'b'.repeat(64)}` },
    });

    expect(res.status).toBe(401);
    expect(reached).toEqual([]);
  });

  it('attributes an admitted command to a REMOTE source', async () => {
    // The same defect MCP had, in the transport beside it: `executeCommand` with no `source` defaults
    // to `'user'` — the local operator — so a remote peer is attributed as the person at the keyboard
    // and the `'remote'` policy seam is never consulted. Admission decides WHO may reach the session;
    // it does not say who they are.
    const executeCommand = vi.fn().mockResolvedValue({ message: 'ran', success: true });
    const session = createTestInteractiveSession({ executeCommand });
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    await app.request('/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'clear', args: '' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CREDENTIAL}` },
    });

    expect(executeCommand).toHaveBeenCalledWith('clear', '', 'remote');
  });

  it('admits a correct credential', async () => {
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    const res = await app.request('/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'clear', args: '' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CREDENTIAL}` },
    });

    // Without this the suite would pass by refusing EVERYTHING, which is a gate nobody can use.
    expect(res.status).toBe(200);
    expect(reached).toEqual(['command:clear']);
  });

  it('admits with no credential only when the host said so, in writing', async () => {
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { open: true, openReason: 'unit test — no boundary under test here' },
    });

    const res = await app.request('/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'clear', args: '' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(reached).toEqual(['command:clear']);
  });

  it('leaves an empty bearer unadmitted whatever the host configured', async () => {
    // `bearerCredential` requires at least one character after `Bearer `, so a presented credential
    // is never the empty string — MEASURED, for `Bearer`, `Bearer `, `Bearer  ` and no header at
    // all. This pins that, because it is what makes the discriminator defect a LOCKOUT rather than
    // a bypass, and the difference is worth having a case for rather than a claim about.
    const { session, reached } = createRecordingSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      admission: { token: CREDENTIAL },
    });

    for (const authorization of ['Bearer ', 'Bearer', 'Bearer  ']) {
      const res = await app.request('/command', {
        method: 'POST',
        body: JSON.stringify({ name: 'clear', args: '' }),
        headers: { 'content-type': 'application/json', authorization },
      });
      expect(res.status, authorization).toBe(401);
    }
    expect(reached).toEqual([]);
  });
});
