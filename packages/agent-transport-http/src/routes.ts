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

import { relayTurn } from './submit-stream.js';
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
export type TSessionFactory = (c: Context) => IInteractiveSession | Promise<IInteractiveSession>;

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
 * Admit this request to ONE turn on its session, or answer why not.
 *
 * Returns the claim key it HOLDS on success — the caller owes its release — or the refusal
 * Response. A named unit, and review is why: the admission decision (nameable? busy? claim) is what
 * this route decides, independently testable from the stream wiring it hands the turn to.
 */
function admitTurn(c: Context, session: IInteractiveSession, claims: ITurnClaims) {
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
  const claim = claims.keyFor(session);
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
  if (claims.isHeld(claim) || session.isExecuting()) {
    return c.json({ error: 'session busy — a turn is already in flight' }, 409);
  }
  claims.hold(claim);
  return { claim };
}

function submitHandler(
  sessionFactory: TSessionFactory,
  claims: ITurnClaims,
  onStreamFailure?: TStreamFailureListener,
) {
  return async (c: Context) => {
    const session = await sessionFactory(c);
    const body = await c.req.json<{ prompt: string }>();

    if (!body.prompt || typeof body.prompt !== 'string') {
      return c.json({ error: 'prompt is required' }, 400);
    }

    const admitted = admitTurn(c, session, claims);
    if (admitted instanceof Response) {
      return admitted;
    }
    const { claim } = admitted;

    // The claim is taken OUTSIDE the callback, so its release cannot live only in the callback's
    // `finally` — a claim whose release is not in the same protected region is a lock, not a claim,
    // which this file states one level in. If `streamSSE` throws before it ever runs the callback,
    // this releases and rethrows; the callback's own `finally` covers everything after it starts.
    //
    // REPRODUCED at the module boundary: `routes-streamsse-throw.test.ts` mocks `hono/streaming`
    // to throw before the callback ever runs and asserts the second request is not 409 — a leaked
    // claim is what this catch exists to prevent. Two rounds shipped it as honestly-labelled
    // unverified code (a throw from `session.on` lands INSIDE the callback, where the inner
    // `finally` releases — measured, a case built that way is green with this catch removed), and
    // review supplied the third option: stub the boundary, not Hono's internals.
    try {
      // NO third argument, deliberately: Hono's runner follows any `onError` by writing the raw
      // `e.message` to the stream, so the only leak-proof shape is a callback nothing escapes —
      // `relayTurn` catches its own failures and reports them generically. An onError here would be
      // dead code that turns into a leak the day it stops being dead.
      // `await`, so the catch below covers a REJECTION as well as a synchronous throw. Today's
      // Hono returns the Response synchronously and only the sync path is real — but review is
      // right that a version returning a rejecting promise would sail past a bare `return`, and
      // the cost of closing that class is one keyword.
      return await streamSSE(
        c,
        relayTurn(session, body.prompt, () => claims.release(claim), onStreamFailure),
      );
    } catch (error) {
      claims.release(claim);
      throw error;
    }
  };
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
