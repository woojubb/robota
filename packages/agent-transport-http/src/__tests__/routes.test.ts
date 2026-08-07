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

function createHonestSession() {
  let executing = false;
  let started = 0;
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = (event: string, data: unknown): void => {
    for (const h of listeners.get(event) ?? []) h(data);
  };
  // Built on the PUBLISHED conformant double rather than another cast to the contract. A cast is a
  // partial re-implementation nothing checks against the real thing — it compiles whatever it
  // happens to contain, so a member the contract gains later is simply missing and the suite keeps
  // passing.
  //
  // And the overrides are typed. The first version ended `} as never`, which defeated exactly what
  // the double was chosen for: `never` is assignable to everything, so a misspelled member name or a
  // wrong handler signature compiled silently — the same blindness as the cast it replaced, one line
  // further down. Review found it. Each override is narrowed at its own site instead, so a typo is a
  // compile error and nothing else is waved through.
  const session = createTestInteractiveSession({
    isExecuting: () => executing,
    submit: async () => {
      // The real `submit()` opens with `await ensureInitialized()` before it reads or sets the
      // busy flag. A stub without that suspension point cannot express the window, and the first
      // version of this file did not have it — which is why it reported no race.
      await Promise.resolve();
      if (executing) return; // the real session queues here
      started += 1;
      executing = true;
      await new Promise((r) => setTimeout(r, 20));
      executing = false;
      // The route's SSE stream ends on the terminal event, so a session that never emits one
      // would hang the request and the case would fail on a TIMEOUT — a red for the wrong reason,
      // which proves as little as a green for the wrong reason.
      emit('complete', { success: true, content: 'done' });
    },
    on: ((event: string, handler: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: (data: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return { session, startedTurns: () => started };
}

describe('HTTP Transport Routes', () => {
  function createApp(session?: IInteractiveSession) {
    const mockSession = session ?? createMockSession();
    const app = createAgentRoutes({
      sessionFactory: () => mockSession,
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
    expect(mockSession.executeCommand).toHaveBeenCalledWith('clear', '');
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
    const app = createAgentRoutes({ sessionFactory: () => session });
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

  it('POST /submit returns 409 while a turn is already in flight', async () => {
    // The route CLAIMS the turn now rather than reading `session.isExecuting()`, so a session stubbed
    // as "already executing" no longer expresses this: the flag it used to set is set inside
    // `submit()`, past a suspension point, which is exactly the race that made the old check
    // unreliable. A request actually in flight is what the refusal is about, so that is what this
    // holds — and it is a stronger statement than the stub was.
    const { session } = createHonestSession();
    const app = createAgentRoutes({ sessionFactory: () => session });
    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

    const [first, second] = await Promise.all([post('first'), post('second')]);
    await Promise.all([first.text(), second.text()]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
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

    const app = createAgentRoutes({ sessionFactory: () => session });
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

// ── RUNTIME-003 P2: the busy check must be a CLAIM, not a look ──────────────

describe('RUNTIME-003: two submissions in the same tick', () => {
  /**
   * A session whose `isExecuting()` tells the truth — it flips only when a turn actually starts.
   *
   * This is the whole point of the case. The old test for the 409 handed the route a session that
   * was ALREADY executing, which proves the route reads the flag but says nothing about the window
   * the route itself documented: the check and the `await session.submit` inside `streamSSE` are
   * separated by awaits, so two requests arriving together both read `false` and both proceed.
   */
  it('starts exactly one turn, and answers the other 409', async () => {
    // The window is REAL, and review found it after the first version of this case declared it was
    // not. Measured: `submit()` opens with `await ensureInitialized()`, an unconditional suspension
    // point, and the `executing` flag `isExecuting()` reads is only set past it. So two requests both
    // read `false`, both call `submit`, and the loser silently coalesces into the pending queue while
    // its HTTP response streams back the WINNER'S events — both are subscribed to one shared emitter.
    //
    // That is worse than what the original comment warned about: not two turns, but one turn's output
    // delivered to two clients as if each had asked for it.
    //
    // The earlier version of this case measured `check → submit → check` and concluded there was no
    // race. It was measuring a `submit` with no suspension point in it — a stub I wrote — so it was
    // reporting on my fixture rather than on the session.
    const { session, startedTurns } = createHonestSession();
    const app = createAgentRoutes({ sessionFactory: () => session });

    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'content-type': 'application/json' },
      });

    const both = await Promise.all([post('AAAA'), post('BBBB')]);
    await Promise.all(both.map((r) => r.text()));

    expect(
      startedTurns(),
      'both requests passed the isExecuting() look and reached submit — one turn, two clients',
    ).toBe(1);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
