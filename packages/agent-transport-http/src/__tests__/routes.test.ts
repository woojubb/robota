/**
 * Tests for HTTP transport routes.
 * Uses Hono's built-in test client — no real HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { createAgentRoutes } from '../routes.js';
import type { IInteractiveSession, ITurnHandle } from '@robota-sdk/agent-interface-session';

/**
 * Built on the PUBLISHED conformant double, not a cast.
 *
 * It WAS a cast — `{ … } as unknown as IInteractiveSession` — and `/submit` refusing a session that
 * cannot name itself is what exposed it: the cast omitted `getSession`, so five cases got a 500.
 * That is the cast working exactly as this file's other double already warns it does — "a partial
 * re-implementation nothing checks against the real thing", compiling whatever it happens to
 * contain and silently missing whatever the contract gains later.
 *
 * The overrides are typed at their own sites for the same reason `createHonestSession` narrows
 * each: `as never` or a blanket cast would defeat what the published double is for.
 */
/**
 * RUNTIME-003 landed while this PR was in review: `submit` now answers with a TURN HANDLE whose
 * `completed` always settles. The honest stubs answer with one too — an empty result, since no case
 * here reads the handle (the route relays EVENTS) — so the suite keeps compiling against the
 * contract rather than against the shape it had last month.
 */
function stubHandle(turnId: string): ITurnHandle {
  return {
    turnId,
    completed: Promise.resolve({
      response: '',
      history: [],
      toolSummaries: [],
      contextState: { usedTokens: 0, maxTokens: 0, usedPercentage: 0, remainingPercentage: 100 },
    }),
  };
}

function createMockSession(overrides?: Partial<IInteractiveSession>) {
  return createTestInteractiveSession({
    submit: vi.fn() as unknown as IInteractiveSession['submit'],
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]) as unknown as IInteractiveSession['getMessages'],
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }) as unknown as IInteractiveSession['getContextState'],
    isExecuting: vi.fn().mockReturnValue(false) as unknown as IInteractiveSession['isExecuting'],
    getPendingPrompt: vi
      .fn()
      .mockReturnValue(null) as unknown as IInteractiveSession['getPendingPrompt'],
    executeCommand: vi.fn().mockResolvedValue({
      message: 'Conversation cleared.',
      success: true,
    }) as unknown as IInteractiveSession['executeCommand'],
    listCommands: vi.fn().mockReturnValue([]) as unknown as IInteractiveSession['listCommands'],
    on: vi.fn() as unknown as IInteractiveSession['on'],
    off: vi.fn() as unknown as IInteractiveSession['off'],
    ...overrides,
  });
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
      if (executing) return stubHandle('queued'); // the real session queues here
      started += 1;
      executing = true;
      await new Promise((r) => setTimeout(r, 20));
      executing = false;
      // The route's SSE stream ends on the terminal event, so a session that never emits one
      // would hang the request and the case would fail on a TIMEOUT — a red for the wrong reason,
      // which proves as little as a green for the wrong reason.
      emit('complete', { success: true, content: 'done' });
      return stubHandle(`turn-${started}`);
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
      }) as unknown as IInteractiveSession['on'],
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }) as unknown as IInteractiveSession['off'],
      submit: vi.fn(async () => {
        // Emit ONLY the terminal event — deliberately no trailing thinking(false).
        for (const handler of handlers.get(terminalEvent) ?? []) {
          handler(terminalData);
        }
        return stubHandle('emitter-turn');
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

  it('POST /submit returns 409 while a turn is already in flight', async () => {
    // The route CLAIMS the turn now rather than reading `session.isExecuting()`, so a session stubbed
    // as "already executing" no longer expresses this: the flag it used to set is set inside
    // `submit()`, past a suspension point, which is exactly the race that made the old check
    // unreliable. A request actually in flight is what the refusal is about, so that is what this
    // holds — and it is a stronger statement than the stub was.
    const { session } = createHonestSession();
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
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
      isExecuting: vi.fn().mockReturnValue(false) as unknown as IInteractiveSession['isExecuting'],
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      }) as unknown as IInteractiveSession['on'],
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }) as unknown as IInteractiveSession['off'],
      // A run that never emits a terminal event on its own — it settles only when abort() is called.
      submit: vi.fn(
        () => new Promise<void>((resolve) => (settleSubmit = resolve)),
      ) as unknown as IInteractiveSession['submit'],
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
  it('releases the claim when SETUP throws, not only when the turn does', async () => {
    // A REGRESSION guard, labelled as one: it passes against both placements of the `try`, and that
    // is worth saying rather than leaving as an implied red-proof.
    //
    // Review was right that the protected region should open at the claim — the subscription setup
    // runs in a synchronous promise executor, outside where the `try` used to start. Measured, the
    // session is released either way: the router swallows a throw from the stream callback and the
    // `finally` runs regardless. So the correctness today does not depend on the placement; it
    // depends on the router, which is not this route's to promise.
    //
    // The `try` opens at the claim anyway, because a claim whose release is not in the same region
    // is a lock, and this case pins the observable outcome so a router that stopped swallowing would
    // be caught here rather than by a session wedged at 409 forever.
    let requests = 0;
    const { session } = createHonestSession();
    const realOn = session.on.bind(session);
    session.on = ((event: string, handler: () => void) => {
      if (requests === 0 && event === 'text_delta') throw new Error('listener cap reached');
      return realOn(event as 'text_delta', handler);
    }) as IInteractiveSession['on'];
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'content-type': 'application/json' },
      });

    await (await post('the one that throws in setup')).text().catch(() => '');
    requests += 1;
    const after = await post('the one that must still be served');
    await after.text();

    expect(after.status, 'the session stayed claimed after setup threw').toBe(200);
  });

  it('does NOT consume a turn when the subscription setup throws', async () => {
    // The case above pins the CLAIM. Review pointed out that it says nothing about the turn, and
    // that the turn was the more expensive half: the subscriptions were wired inside a promise
    // executor, so a throw from `session.on` was caught by the Promise constructor and became an
    // already-rejected `done` rather than propagating. Execution fell through to `submit()` — a
    // real turn ran, with only some of its listeners attached and nothing relaying it — and the
    // rejection surfaced afterwards at `await done`, by which point the turn was gone.
    //
    // RED-PROVED against the executor placement: `submit` was called once.
    let threw = false;
    const { session } = createHonestSession();
    const realOn = session.on.bind(session);
    session.on = ((event: string, handler: () => void) => {
      if (!threw && event === 'text_delta') {
        threw = true;
        throw new Error('listener cap reached');
      }
      return realOn(event as 'text_delta', handler);
    }) as IInteractiveSession['on'];
    const submit = vi.spyOn(session, 'submit');

    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    await (
      await app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'must never reach the session' }),
        headers: { 'content-type': 'application/json' },
      })
    )
      .text()
      .catch(() => '');

    expect(threw, 'the fixture never threw, so this case proves nothing').toBe(true);
    expect(
      submit,
      'a turn was consumed by a request that could not relay it',
    ).not.toHaveBeenCalled();
  });

  it('TELLS the client when the stream callback throws', async () => {
    // The throw above had nowhere to go. `streamSSE` had no error handler, so it became an
    // UNHANDLED rejection — silent in a browser, and red under vitest, which is how it was found
    // (the `quality` job on this PR). A stream that dies without saying so leaves the client
    // waiting on a 200 and an open connection forever.
    //
    // It cannot be an error STATUS: the headers are already out by the time the callback runs. So
    // it is reported on the channel the client is listening to.
    const { session } = createHonestSession();
    const realOn = session.on.bind(session);
    session.on = ((event: string, handler: () => void) => {
      if (event === 'text_delta') throw new Error('listener cap reached');
      return realOn(event as 'text_delta', handler);
    }) as IInteractiveSession['on'];

    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const response = await app.request('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'the setup will throw' }),
      headers: { 'content-type': 'application/json' },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body, 'the stream closed without telling the client anything').toContain('event: error');
    // The GENERIC line, and NOT the exception — review caught this assertion contradicting the
    // trust-boundary design, and measuring it found a real leak: Hono's runner follows any
    // `onError` by writing the raw `e.message` to the stream, so the body carried TWO error events,
    // the generic one and the leak. The callback catches its own failures now, so the runner's
    // write is unreachable.
    expect(body).toContain('the stream failed on the server');
    expect(body, 'the raw exception crossed the trust boundary').not.toContain(
      'listener cap reached',
    );
  });

  it('refuses when the session is busy from SOMEWHERE ELSE', async () => {
    // Claiming per route closed the race but dropped `session.isExecuting()` entirely, so a turn
    // started by another surface — the TUI, a WS client, a previous process — was invisible here and
    // this route would start a second one on a session already running. Review found it: the claim
    // is what this route knows, and isExecuting is what the session knows. Both are needed.
    const { session } = createHonestSession();
    session.isExecuting = () => true; // busy, but not by anything this router claimed
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });

    const res = await app.request('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'while another surface holds the turn' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(409);
  });

  it('does not refuse a DIFFERENT session because another one is busy', async () => {
    // Review found this: the claim was a single flag on the router, but `sessionFactory` is
    // documented as resolving a session per request — the example says "multi-tenant" in as many
    // words. One tenant's turn refused every other tenant's, which is a worse defect than the race
    // it closed: a busy neighbour is not a reason to refuse you.
    const first = createHonestSession();
    const second = createHonestSession();
    let call = 0;
    const app = createAgentRoutes({
      sessionFactory: () => (call++ === 0 ? first.session : second.session),
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'content-type': 'application/json' },
      });

    const both = await Promise.all([post('tenant A'), post('tenant B')]);
    await Promise.all(both.map((r) => r.text()));

    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(first.startedTurns()).toBe(1);
    expect(second.startedTurns(), 'a second tenant was refused because the first was busy').toBe(1);
  });

  it('still refuses when the factory returns a FRESH WRAPPER for the same session', async () => {
    // The claim used to be a `WeakSet` keyed on the OBJECT, and the first answer to this was a
    // paragraph telling callers to be identity-stable — a requirement nothing could check, which
    // review rightly refused. The contract already gives every session a stable id
    // (`getSession(): { getSessionId(): string }`), so the claim is keyed by that and the
    // requirement is gone rather than documented.
    //
    // RED-PROVED against the WeakSet: [200, 200], and BOTH turns started.
    const backing = createHonestSession();
    const app = createAgentRoutes({
      // A new object every call, forwarding to one session — the shape that defeated identity.
      sessionFactory: () => Object.assign(createTestInteractiveSession(), { ...backing.session }),
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'content-type': 'application/json' },
      });

    const both = await Promise.all([post('first'), post('second')]);
    await Promise.all(both.map((r) => r.text()));

    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(backing.startedTurns(), 'two turns ran on one session').toBe(1);
  });

  it('REFUSES a session that will not name itself, rather than serving it racily', async () => {
    // Review: with no id, `claim` was `undefined` and the busy check fell back to `isExecuting()`
    // alone — which the route's own comment documents as the racy read this whole change exists to
    // stop relying on. So the fix silently degraded into the bug for exactly the callers who could
    // not be told they were affected.
    //
    // The contract types `getSessionId()` as returning a `string`, so this is unreachable for a
    // conformant session; naming it is what keeps that true.
    const { session } = createHonestSession();
    session.getSession = (() => ({ getSessionId: () => '' })) as IInteractiveSession['getSession'];
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });

    const response = await app.request('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'nobody can guarantee this is mine' }),
      headers: { 'content-type': 'application/json' },
    });

    // Read ONCE — a Response body is not re-readable, and asserting twice off `await json()` throws
    // `Body is unusable` rather than failing the assertion it was written for.
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/concurrent-turn tracking is unavailable/);
    // And it names no internal method: this route can be mounted outside a trust boundary, and a
    // client cannot act on a contract it does not implement. Review asked for the call; this is it.
    expect(body.error, 'the internal signature leaked').not.toMatch(/getSessionId/);
  });

  it('reports the SAME busy from /executing as /submit refuses on', async () => {
    // Review: `/executing` asked only `session.isExecuting()`, so a client polling it could see
    // `executing: false` and still get a 409 from `/submit` — two endpoints disagreeing about one
    // word, which is a worse answer than either alone.
    //
    // The divergence needs a session whose turn is CLAIMED but not yet EXECUTING, and the honest
    // double cannot hold that open: it sets `executing` inside `submit`, so both are true at the
    // same moment and the case passes either way. Measured — my first version of this case was
    // green with the fix reverted.
    //
    // This one holds the window: `submit` never resolves and never sets `executing`, which is what
    // the real session looks like between the route's claim and the flag flipping past
    // `await ensureInitialized()`.
    const executing = false;
    const session = createTestInteractiveSession({
      isExecuting: () => executing,
      submit: (() => new Promise(() => {})) as unknown as IInteractiveSession['submit'],
    });
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });
    const post = async (prompt: string): Promise<Response> =>
      app.request('/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'content-type': 'application/json' },
      });

    void post('holds the claim, never executes');
    // The 409 establishes that the claim IS held — one microtask is not enough for `/submit` to
    // reach it, so querying before that measures the wrong moment.
    const refused = await post('arrives while claimed');
    await refused.text();
    const busy = await (await app.request('/executing')).json();

    expect(refused.status, 'the second submission was not refused').toBe(409);
    expect(executing, 'the fixture was executing, so it cannot show the divergence').toBe(false);
    expect(busy, '/executing said idle while /submit said busy').toEqual({ executing: true });
  });

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
    const app = createAgentRoutes({
      sessionFactory: () => session,
      // SEC-008: admission is not under test here, and the reason it is open says so.
      admission: { open: true, openReason: 'SEC-008: this case is about routing, not admission' },
    });

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
        // No cast, and the previous version of this comment predicted this edit: it said RUNTIME-003
        // would change the return type on its own branch "and the type is what will tell this file
        // about it". It landed, the compiler told, and the stub answers with the handle the contract
        // now promises. No case here reads it — `reached` is the observable.
        return {
          turnId: 'recorded-turn',
          completed: Promise.resolve({
            response: '',
            history: [],
            toolSummaries: [],
            contextState: {
              usedTokens: 0,
              maxTokens: 0,
              usedPercentage: 0,
              remainingPercentage: 100,
            },
          }),
        };
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
