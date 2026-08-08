/**
 * HTTP transport adapter — exposes IInteractiveSession over REST API.
 *
 * Built on Hono for Cloudflare Workers + Node.js + AWS Lambda compatibility.
 * Exposes the core session methods (a subset; background-task, job-group, and
 * execution-workspace methods are WS-only).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import type { Context } from 'hono';

/**
 * Callback that resolves an IInteractiveSession from the request context.
 *
 * It need NOT return the same object twice for the same logical session. It briefly did: `/submit`
 * keyed its concurrent-turn claim on object identity, so a factory building a fresh wrapper per
 * call — a proxy, an adapter, a `{...session}` copy — defeated the guard in silence. The first
 * answer was to document that as a requirement callers had to keep, and a requirement neither the
 * type system nor a test can check is not a contract, it is a hope.
 *
 * What the session already promises is enough. `getSession(): { getSessionId(): string }` names the
 * session, the claim is keyed by that name, and the requirement is gone rather than written down.
 *
 * The session must therefore BE nameable. `/submit` refuses with 500 when `getSessionId()` returns
 * nothing, because without an id the concurrent-turn guarantee does not exist and serving anyway
 * would hand back the bug to whoever could least tell. The contract types that method as returning
 * a `string`, so a conformant session never meets it.
 */
export type TSessionFactory = (c: Context) => IInteractiveSession | Promise<IInteractiveSession>;

export interface IAgentRoutesOptions {
  /** Resolve an IInteractiveSession per request (e.g., by auth token, session ID). */
  sessionFactory: TSessionFactory;
}

/**
 * Create a Hono router with all agent HTTP endpoints.
 *
 * Usage:
 * ```typescript
 * const routes = createAgentRoutes({ sessionFactory });
 * app.route('/agent', routes);          // mount on existing app
 * export default routes;                // or use standalone (CF Workers)
 * ```
 */
export function createAgentRoutes(options: IAgentRoutesOptions): Hono {
  const { sessionFactory } = options;
  const app = new Hono();

  // RUNTIME-38: claimed by the route, PER SESSION — see the note at the check below.
  //
  // PER SESSION, not one flag for the router. `sessionFactory` resolves a session per request (the
  // documented multi-tenant shape), so a single flag made one tenant's turn refuse every other
  // tenant's — a busy neighbour is not a reason to refuse you, and that is a worse defect than the
  // race it closed.
  //
  // Keyed by the session's declared ID, not by object identity.
  //
  // Keying on the OBJECT makes identity-stability a requirement of every caller that nothing can
  // check: a `sessionFactory` returning a fresh wrapper per call for the same logical session — a
  // proxy, an adapter, a spread copy — defeats the guard in silence, and every request looks
  // unclaimed. `getSession(): { getSessionId(): string }` already names the session, so asking for
  // the id turns an unenforceable requirement into no requirement at all.
  //
  // Entries are deleted in the stream's `finally`, so this does not grow with the number of
  // sessions the host has ever served — which is what weak keying would otherwise buy.
  const turnsInFlight = new Set<string>();

  /**
   * The key one logical session is claimed under, or `undefined` when it will not name itself.
   *
   * `undefined` rather than a placeholder: a shared fallback key would collide every unnameable
   * session into one claim and refuse them all as each other's neighbours. The caller turns it into
   * a refusal — see the check below for why serving anyway is not the softer option.
   */
  const claimKey = (session: IInteractiveSession): string | undefined => {
    try {
      // No `?.`: `getSession(): { getSessionId(): string }` is non-nullable, and optional chaining
      // here would suggest the contract allows an absent session when it does not. A session that
      // breaks the contract anyway is caught by the `catch`.
      const id = session.getSession().getSessionId();
      return typeof id === 'string' && id !== '' ? id : undefined;
    } catch {
      // allow-fallback: a session that throws while naming itself has not told us who it is, and
      // guessing would claim the wrong turn. The caller REFUSES on `undefined` — an earlier version
      // of this comment said `isExecuting()` still guarded the request, which stopped being true
      // when the fallback became a refusal two lines down.
      return undefined;
    }
  };

  // POST /submit — execute prompt, stream events via SSE
  app.post('/submit', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ prompt: string }>();

    if (!body.prompt || typeof body.prompt !== 'string') {
      return c.json({ error: 'prompt is required' }, 400);
    }

    // RUNTIME-38: the session is single-threaded (one turn at a time) and shared across requests, so a
    // concurrent /submit would cross-subscribe to the same emitter and interleave two clients' events.
    //
    // The route CLAIMS the turn rather than asking whether one is running, and that difference is the
    // whole fix. `session.isExecuting()` is set inside `submit()` past an `await ensureInitialized()`
    // — an unconditional suspension point — so two requests both read `false`, both call `submit`, and
    // the loser coalesces into the pending queue while its HTTP response streams back the WINNER'S
    // events. One turn delivered to two clients as if each had asked for it, which is worse than the
    // race the earlier comment described and then wrongly declared absent.
    //
    // A synchronous flag on the route closes it because there is no suspension point between reading
    // and setting it. It is released in the stream's `finally`, so a turn that throws does not leave
    // the route wedged.
    //
    // BOTH are asked because neither subsumes the other. The claim is what this ROUTE knows;
    // `isExecuting()` is what the SESSION knows, including a turn started by another surface — the
    // TUI, a WS client, a previous process — which the claim cannot see.
    // A session that cannot name itself is REFUSED, not served racily. The busy check is a guarantee
    // only while the claim is keyed by a real id: with no id it falls back to `isExecuting()` alone,
    // which the comment above documents as the racy read this route exists to stop relying on.
    // Serving anyway would degrade the fix back into the bug for exactly the callers who could not
    // be told they were affected.
    //
    // `getSession(): { getSessionId(): string }` is required by the contract, so this is unreachable
    // for a conformant session. It is a 500 rather than a 503: the session is not temporarily
    // unavailable, it does not meet the contract this route is built on, which is a defect on the
    // server side of the boundary and not a condition that clears on retry.
    const claim = claimKey(session);
    if (claim === undefined) {
      return c.json(
        {
          // No internal method signature: this route can be mounted outside a trust boundary, and
          // the caller cannot act on `getSession().getSessionId()` anyway — it names a contract
          // they do not implement. The HOST needs the detail and gets it from the comment above
          // this branch; the client needs to know its request was refused and why in its own terms.
          error:
            'concurrent-turn tracking is unavailable for this session, so this request cannot be ' +
            'served safely. Refusing rather than starting a turn that cannot be guaranteed to be ' +
            'yours.',
        },
        500,
      );
    }
    if (turnsInFlight.has(claim) || session.isExecuting()) {
      return c.json({ error: 'session busy — a turn is already in flight' }, 409);
    }
    turnsInFlight.add(claim);

    // The claim is taken OUTSIDE the callback, so its release cannot live only in the callback's
    // `finally` — a claim whose release is not in the same protected region is a lock, not a claim,
    // which this file states one level in. If `streamSSE` throws before it ever runs the callback,
    // this releases and rethrows; the callback's own `finally` covers everything after it starts.
    //
    // NOT REPRODUCED BY A TEST, and that is said here rather than implied by a case that would pass
    // either way. A throw from `session.on` lands INSIDE the callback, where the inner `finally`
    // already releases — measured: a case built that way is green with this `catch` removed. Making
    // `streamSSE` itself throw synchronously would mean stubbing Hono's internals, which tests the
    // stub rather than the route. This is defensive code for a path Hono does not currently take.
    try {
      return streamSSE(
        c,
        async (stream) => {
          // The `try` opens HERE, immediately after the claim. Opened later — just before
          // `await session.submit` — it leaves the subscription setup outside, and a throw in there
          // (a bad handler, a listener cap) leaves the session claimed with nothing to release it,
          // so every later request gets 409 forever.
          const cleanup: Array<() => void> = [];
          try {
            const subscribe = <T>(event: string, handler: (data: T) => void): void => {
              session.on(event as 'text_delta', handler as () => void);
              cleanup.push(() => session.off(event as 'text_delta', handler as () => void));
            };

            // RUNTIME-14: await + catch every SSE write so a write to a client-closed stream is a blessed no-op,
            // not an unhandled rejection (post-headers errors bypass Hono's onError).
            const write = (event: string, data: unknown): Promise<void> =>
              stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {
                // allow-fallback: client closed the stream mid-write — nothing to deliver; the finally teardown
                // (RUNTIME-14) removes the listeners, so this write has nothing left to do.
              });

            // The subscriptions are wired OUTSIDE the promise executor. Inside it, a throw from
            // `session.on` — a bad handler, an EventEmitter listener cap — is caught by the Promise
            // constructor and becomes an already-rejected `done` instead of propagating. Execution then
            // reaches `await session.submit(...)`, so a REAL TURN is consumed with only some of its
            // listeners attached and nothing to relay it, and the rejection surfaces afterwards at
            // `await done` — by which point the turn is gone.
            let settle!: () => void;
            const done = new Promise<void>((resolve) => {
              settle = resolve;
            });

            subscribe('text_delta', (delta: string) => void write('text_delta', { delta }));
            subscribe('tool_start', (state) => void write('tool_start', state));
            subscribe('tool_end', (state) => void write('tool_end', state));
            subscribe('thinking', (isThinking: boolean) => void write('thinking', { isThinking }));

            subscribe('complete', async (result) => {
              // Flush the terminal event before resolving, so the resolve → cleanup →
              // stream-close continuation cannot race ahead of the write.
              await write('complete', result);
              settle();
            });
            subscribe('interrupted', async (result) => {
              await write('interrupted', result);
              settle();
            });
            subscribe('error', async (error: Error) => {
              await write('error', { message: error.message });
              settle();
            });

            // RUNTIME-14: on client disconnect, CANCEL the underlying run (not merely stop writing) and unblock
            // `done` so the finally teardown runs — otherwise `done` would never resolve and the listeners leak.
            stream.onAbort(() => {
              session.abort();
              settle();
            });

            await session.submit(body.prompt);
            await done;
          } finally {
            // RUNTIME-14: teardown ALWAYS runs — on completion, error, OR client disconnect — so the session
            // event listeners can never leak.
            for (const fn of cleanup) fn();
            // RUNTIME-38: released here for the same reason — a turn that throws must not wedge the
            // session it claimed.
            turnsInFlight.delete(claim);
          }
        },
        // A stream callback that throws AFTER the response headers are out cannot be turned into an
        // error status — the client already has a 200 and an open stream. Without this handler the
        // throw is an UNHANDLED rejection: it left the process silently in a browser and turned the
        // `quality` job red under vitest, which is how it was found.
        //
        // So it is reported on the channel the client is actually listening to, and the stream is
        // closed. The teardown in the `finally` above has already run by the time this is called, so
        // the listeners are gone and the claim is released — this handler owes only the telling.
        async (error, stream) => {
          await stream
            .writeSSE({ event: 'error', data: JSON.stringify({ message: error.message }) })
            .catch(() => {
              // allow-fallback: the stream is already gone, which is the one case where there is
              // nobody left to tell. Rethrowing here would restore the unhandled rejection this
              // handler exists to remove.
            });
        },
      );
    } catch (error) {
      turnsInFlight.delete(claim);
      throw error;
    }
  });

  // POST /command — execute system command
  app.post('/command', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ name: string; args?: string }>();

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    const result = await session.executeCommand(body.name, body.args ?? '');
    if (!result) {
      return c.json({ error: `Unknown command: ${body.name}` }, 404);
    }
    return c.json(result);
  });

  // POST /abort — abort current execution
  app.post('/abort', async (c) => {
    const session = await sessionFactory(c);
    session.abort();
    return c.json({ ok: true });
  });

  // POST /cancel-queue — cancel queued prompt
  app.post('/cancel-queue', async (c) => {
    const session = await sessionFactory(c);
    session.cancelQueue();
    return c.json({ ok: true });
  });

  // GET /messages — get message history
  app.get('/messages', async (c) => {
    const session = await sessionFactory(c);
    return c.json(session.getMessages());
  });

  // GET /context — get context window state
  app.get('/context', async (c) => {
    const session = await sessionFactory(c);
    return c.json(session.getContextState());
  });

  // GET /executing — check if currently executing
  //
  // Reports the SAME "busy" that `/submit` refuses on: the route's own claim OR the session's
  // `isExecuting()`. Asking only the session lets a client polling here see `executing: false` and
  // still get a 409 from `/submit`, and two endpoints disagreeing about one word is a worse answer
  // than either of them alone.
  app.get('/executing', async (c) => {
    const session = await sessionFactory(c);
    const claim = claimKey(session);
    const claimed = claim !== undefined && turnsInFlight.has(claim);
    return c.json({ executing: claimed || session.isExecuting() });
  });

  // GET /pending — get pending queued prompt
  app.get('/pending', async (c) => {
    const session = await sessionFactory(c);
    return c.json({ pending: session.getPendingPrompt() });
  });

  return app;
}
