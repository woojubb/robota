/**
 * HTTP transport adapter — exposes InteractiveSession over REST API.
 *
 * Built on Hono for Cloudflare Workers + Node.js + AWS Lambda compatibility.
 * Each endpoint maps 1:1 to an InteractiveSession or SystemCommandExecutor API.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import type { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-sdk';

/** Callback that resolves an InteractiveSession from the request context. */
export type ISessionFactory = (c: Context) => InteractiveSession | Promise<InteractiveSession>;

export interface IAgentRoutesOptions {
  /** Resolve an InteractiveSession per request (e.g., by auth token, session ID). */
  sessionFactory: ISessionFactory;
  /** System command executor. */
  commandExecutor: SystemCommandExecutor;
}

/**
 * Create a Hono router with all agent HTTP endpoints.
 *
 * Usage:
 * ```typescript
 * const routes = createAgentRoutes({ sessionFactory, commandExecutor });
 * app.route('/agent', routes);          // mount on existing app
 * export default routes;                // or use standalone (CF Workers)
 * ```
 */
export function createAgentRoutes(options: IAgentRoutesOptions): Hono {
  const { sessionFactory, commandExecutor } = options;
  const app = new Hono();

  // POST /submit — execute prompt, stream events via SSE
  app.post('/submit', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ prompt: string }>();

    if (!body.prompt || typeof body.prompt !== 'string') {
      return c.json({ error: 'prompt is required' }, 400);
    }

    return streamSSE(c, async (stream) => {
      const cleanup: Array<() => void> = [];

      const subscribe = <T>(event: string, handler: (data: T) => void): void => {
        session.on(event as 'text_delta', handler as () => void);
        cleanup.push(() => session.off(event as 'text_delta', handler as () => void));
      };

      let completed = false;
      const done = new Promise<void>((resolve) => {
        subscribe('text_delta', (delta: string) => {
          stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ delta }) });
        });

        subscribe('tool_start', (state) => {
          stream.writeSSE({ event: 'tool_start', data: JSON.stringify(state) });
        });

        subscribe('tool_end', (state) => {
          stream.writeSSE({ event: 'tool_end', data: JSON.stringify(state) });
        });

        subscribe('thinking', (isThinking: boolean) => {
          stream.writeSSE({ event: 'thinking', data: JSON.stringify({ isThinking }) });
          if (!isThinking && completed) {
            resolve();
          }
        });

        subscribe('complete', (result) => {
          completed = true;
          stream.writeSSE({ event: 'complete', data: JSON.stringify(result) });
        });

        subscribe('interrupted', (result) => {
          completed = true;
          stream.writeSSE({ event: 'interrupted', data: JSON.stringify(result) });
        });

        subscribe('error', (error: Error) => {
          completed = true;
          stream.writeSSE({ event: 'error', data: JSON.stringify({ message: error.message }) });
        });
      });

      await session.submit(body.prompt);
      await done;

      for (const fn of cleanup) fn();
    });
  });

  // POST /command — execute system command
  app.post('/command', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ name: string; args?: string }>();

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    const result = await commandExecutor.execute(body.name, session, body.args ?? '');
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
