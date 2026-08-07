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
 * ## The identity invariant
 *
 * Two requests that resolve to the SAME LOGICAL SESSION must receive the SAME OBJECT. The busy
 * check in `/submit` is a `WeakSet<IInteractiveSession>` keyed by object identity, so a factory
 * that returns a fresh wrapper per call — a new proxy, a new adapter, a `{...session}` copy —
 * defeats it silently: every request looks unclaimed, two turns start on one session, and the
 * response of the one that ran is delivered to both callers.
 *
 * Review raised this: the requirement was real and stated nowhere, and neither the type system nor
 * a test can catch a conforming-looking implementation that breaks it. Saying so here is the whole
 * of the enforcement, which is worth being honest about rather than leaving implied.
 *
 * Returning the same object is the ordinary shape — resolve from a map keyed by session id — so
 * this constrains a caller only if it was already building per-request wrappers.
 */
export type TSessionFactory = (c: Context) => IInteractiveSession | Promise<IInteractiveSession>;

export interface IAgentRoutesOptions {
  /**
   * Resolve an IInteractiveSession per request (e.g., by auth token, session ID).
   *
   * Must be identity-stable for one logical session — see `TSessionFactory`.
   */
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
  // A single flag was the first version, and review found what it cost: `sessionFactory` resolves a
  // session per request (the documented multi-tenant shape), so one tenant's turn refused every
  // other tenant's. A busy neighbour is not a reason to refuse you — that is a worse defect than the
  // race it closed.
  //
  // Keyed WEAKLY, so a session the host stops handing out is collected with it rather than pinned
  // here forever by a claim nobody will ever release.
  const turnsInFlight = new WeakSet<IInteractiveSession>();

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
    // BOTH, and review is why. The claim is what this route knows; `isExecuting()` is what the
    // SESSION knows. Dropping the second made a turn started by another surface — the TUI, a WS
    // client, a previous process — invisible here, and this route would start a second one on a
    // session already running. Dropping the first is the race at the top of this comment. Neither
    // subsumes the other, so both are asked.
    if (turnsInFlight.has(session) || session.isExecuting()) {
      return c.json({ error: 'session busy — a turn is already in flight' }, 409);
    }
    turnsInFlight.add(session);

    return streamSSE(c, async (stream) => {
      // The `try` opens HERE, immediately after the claim, and that placement is a review finding.
      // It used to open just before `await session.submit`, leaving the subscription setup between
      // the two: a throw in there — a bad handler, a listener cap — left the session claimed with
      // nothing to release it, and every later request to it got 409 forever. A claim whose release
      // is not in the same protected region is a lock, not a claim.
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

        // The subscriptions are wired OUTSIDE the promise executor, and that is a review finding.
        // Inside it, a throw from `session.on` — a bad handler, an EventEmitter listener cap — is
        // caught by the Promise constructor and turned into an already-rejected `done` instead of
        // propagating. Execution then fell through to `await session.submit(...)`, so a REAL TURN
        // was consumed with only some of its listeners attached and nothing to relay it, and the
        // rejection surfaced afterwards at `await done`. The turn is gone by then.
        //
        // Wired here, that throw reaches the `try` synchronously, before anything is submitted: the
        // claim is released by the `finally` and the request fails having spent nothing.
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
        turnsInFlight.delete(session);
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
    });
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
  app.get('/executing', async (c) => {
    const session = await sessionFactory(c);
    return c.json({ executing: session.isExecuting() });
  });

  // GET /pending — get pending queued prompt
  app.get('/pending', async (c) => {
    const session = await sessionFactory(c);
    return c.json({ pending: session.getPendingPrompt() });
  });

  return app;
}
