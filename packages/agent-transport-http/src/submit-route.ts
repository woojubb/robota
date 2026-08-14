/**
 * `POST /submit` — the admission decision and the handler that hands an admitted turn to the relay.
 *
 * Split from `routes.ts` under the file-size ceiling, along the same seam the review rounds carved:
 * the route factory is a LIST of routes, and this one carries the concurrency-admission decision
 * plus the claim lifecycle, which is a different job from mounting endpoints.
 */

import { streamSSE } from 'hono/streaming';

import { relayTurn } from './submit-stream.js';

import type { IHttpTransportSession } from './http-session.js';
import type { TStreamFailureListener } from './submit-stream.js';
import type { ITurnClaims } from './turn-claims.js';
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
 *
 * (Review moved this block here: it sat on the RE-EXPORT in `routes.ts` after the split, where the
 * person editing the definition would never see it.)
 */
export type TSessionFactory = (
  c: Context,
) => IHttpTransportSession | Promise<IHttpTransportSession>;

/**
 * Admit this request to ONE turn on its session, or answer why not.
 *
 * Returns the claim key it HOLDS on success — the caller owes its release — or the refusal
 * Response. A named unit, and review is why: the admission decision (nameable? busy? claim) is what
 * this route decides, independently testable from the stream wiring it hands the turn to.
 */
function admitTurn(c: Context, session: IHttpTransportSession, claims: ITurnClaims) {
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

export function submitHandler(
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
    // SINGLE-SHOT, and review traced the double-release it prevents: the relay's teardown releases
    // this claim on the normal path, and if a future Hono ever rejected the outer promise AFTER the
    // callback completed, the catch below would release the SAME KEY a second time — by which point
    // another request may hold it, and the second release would free that request's claim, which is
    // the cross-talk this registry exists to prevent. A release that has happened is not a release
    // that can happen again.
    let released = false;
    const releaseOnce = (): void => {
      if (!released) {
        released = true;
        claims.release(claim);
      }
    };

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
      return await streamSSE(c, relayTurn(session, body.prompt, releaseOnce, onStreamFailure));
    } catch (error) {
      releaseOnce();
      throw error;
    }
  };
}
