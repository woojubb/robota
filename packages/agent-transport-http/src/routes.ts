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

/** Callback that resolves an IInteractiveSession from the request context. */
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

  // POST /submit — execute prompt, stream events via SSE
  app.post('/submit', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ prompt: string }>();

    if (!body.prompt || typeof body.prompt !== 'string') {
      return c.json({ error: 'prompt is required' }, 400);
    }

    // RUNTIME-38: the session is single-threaded (one turn at a time) and shared across requests, so a
    // concurrent /submit would cross-subscribe to the same emitter and interleave two clients' events.
    // Reject while a turn is in flight.
    //
    // RUNTIME-003: this comment used to declare a TOCTOU here — that two requests passing the check in
    // the same tick could both proceed. Measured, they cannot: from this check through `streamSSE` to
    // `session.submit` there is no suspension point, so a second request's check always observes the
    // first turn already claimed. The ordering was recorded both ways round (with a synchronous and an
    // async `sessionFactory`) and came out `check → submit → check` each time.
    //
    // Worth stating plainly, because the safety is INHERITED rather than owned: it holds because Hono
    // enters the stream callback synchronously, which is a property of a dependency and not of this
    // route. A regression case in `routes.test.ts` pins the observable outcome — one turn starts, the
    // other is refused — so a Hono that started deferring would be caught here rather than in
    // production. Per-session isolation remains the larger answer (ARCH-004).
    if (session.isExecuting()) {
      return c.json({ error: 'session busy — a turn is already in flight' }, 409);
    }

    return streamSSE(c, async (stream) => {
      const cleanup: Array<() => void> = [];

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

      const done = new Promise<void>((resolve) => {
        subscribe('text_delta', (delta: string) => void write('text_delta', { delta }));
        subscribe('tool_start', (state) => void write('tool_start', state));
        subscribe('tool_end', (state) => void write('tool_end', state));
        subscribe('thinking', (isThinking: boolean) => void write('thinking', { isThinking }));

        subscribe('complete', async (result) => {
          // Flush the terminal event before resolving, so the resolve → cleanup →
          // stream-close continuation cannot race ahead of the write.
          await write('complete', result);
          resolve();
        });
        subscribe('interrupted', async (result) => {
          await write('interrupted', result);
          resolve();
        });
        subscribe('error', async (error: Error) => {
          await write('error', { message: error.message });
          resolve();
        });

        // RUNTIME-14: on client disconnect, CANCEL the underlying run (not merely stop writing) and unblock
        // `done` so the finally teardown runs — otherwise `done` would never resolve and the listeners leak.
        stream.onAbort(() => {
          session.abort();
          resolve();
        });
      });

      try {
        await session.submit(body.prompt);
        await done;
      } finally {
        // RUNTIME-14: teardown ALWAYS runs — on completion, error, OR client disconnect — so the session
        // event listeners can never leak.
        for (const fn of cleanup) fn();
      }
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
