/**
 * HTTP transport adapter — exposes IInteractiveSession over REST API.
 *
 * Built on Hono for Cloudflare Workers + Node.js + AWS Lambda compatibility.
 * Exposes the core session methods (a subset; background-task, job-group, and
 * execution-workspace methods are WS-only).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  bearerCredential,
  credentialMatches,
  resolveAdmission,
} from '@robota-sdk/agent-transport-protocol';

import { submitHandler } from './submit-route.js';

import type { TSessionFactory } from './submit-route.js';
import { createTurnClaims } from './turn-claims.js';

import type { TStreamFailureListener } from './submit-stream.js';
import type { ITurnClaims } from './turn-claims.js';
import type {
  IInteractiveSession,
  ITransportAdmission,
  ITransportAdmissionConfig,
} from '@robota-sdk/agent-interface-transport';
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
export type { TSessionFactory } from './submit-route.js';

export interface IAgentRoutesOptions {
  /** Resolve an IInteractiveSession per request (e.g., by auth token, session ID). */
  sessionFactory: TSessionFactory;
  /**
   * Where the DETAIL of a post-headers stream failure goes (the client gets only a generic line —
   * see `submit-stream.ts`). Injected per the side-concern rule: the host decides the destination,
   * and absent means the host chose to drop it.
   */
  onStreamFailure?: TStreamFailureListener;
  /**
   * SEC-008: what a peer must present to reach the session. REQUIRED — there is no shape of this
   * option that means "I did not think about it", which is the state these routes shipped in.
   *
   * `{ open: true, openReason: '…' }` still runs with no credential, and that is a legitimate answer
   * for a host that has its own boundary in front. It just has to be written down.
   */
  admission: ITransportAdmissionConfig | ITransportAdmission;
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
  const { sessionFactory, onStreamFailure } = options;
  const app = new Hono();

  // RUNTIME-38: one turn at a time, per session — `turn-claims.ts` owns what that means and why it
  // is keyed by the session's declared ID rather than by object identity.
  const claims = createTurnClaims();

  // SEC-008: resolved ONCE, at construction, so a transport that cannot mint a credential fails to
  // build rather than serving without one. Resolving per request would also mint a new token per
  // request, which no peer could ever present.
  // Either shape goes in: `resolveAdmission` is idempotent, so an already-resolved admission comes
  // back unchanged and a config is resolved. `http-transport.ts` therefore does not have to take
  // its resolved admission apart and rebuild a config for this to resolve again — two resolutions
  // of one decision, and a mint on the second if the first had opened without a reason (review).
  //
  // This used to pick between the two with `'token' in options.admission`, and review showed that
  // cannot work: BOTH interfaces declare a `token`, so the shapes differ only by VALUE. A config of
  // `{ token: '' }` — documented as "mint a fresh one" — was read as pre-resolved and installed the
  // EMPTY STRING as the required credential, which a peer sending an empty bearer would match. The
  // discriminator is gone rather than repaired; there is nothing here left to get wrong.
  const admission = resolveAdmission(options.admission);

  /**
   * The trust boundary, installed BEFORE every route rather than checked inside each one.
   *
   * Before this, `POST /submit` reached `session.submit` and `POST /command` reached
   * `session.executeCommand` with nothing in between — remote arbitrary execution with no gate, and
   * an unauthenticated request looked exactly like an authorised one in both directions.
   *
   * A missing credential and a wrong one get the same answer, deliberately: telling them apart tells
   * a caller which half they got right.
   */
  app.use('*', async (c, next) => {
    if (admission.token === null) return next();
    if (credentialMatches(admission.token, bearerCredential(c.req.header('authorization')))) {
      return next();
    }
    return c.json({ error: 'unauthorized' }, 401);
  });

  // POST /submit — execute prompt, stream events via SSE
  app.post('/submit', submitHandler(sessionFactory, claims, onStreamFailure));

  // POST /command — execute system command
  app.post('/command', async (c) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ name: string; args?: string }>();

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    // SEC-008: 'remote', not the default 'user'. A peer over HTTP is not the person at the keyboard,
    // and defaulting to the local operator both mis-attributes the call and skips the 'remote' policy
    // seam that exists to treat the two differently. Admission decided WHO may reach the session; it
    // does not say who they are. (The MCP adapter had the same defect; this is its sibling.)
    const result = await session.executeCommand(body.name, body.args ?? '', 'remote');
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
    const claim = claims.keyFor(session);
    const claimed = claim !== undefined && claims.isHeld(claim);
    return c.json({ executing: claimed || session.isExecuting() });
  });

  // GET /pending — get pending queued prompt
  app.get('/pending', async (c) => {
    const session = await sessionFactory(c);
    return c.json({ pending: session.getPendingPrompt() });
  });

  return app;
}
