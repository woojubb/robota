/**
 * RUNTIME-38 — who currently holds the one turn a session can run.
 *
 * Split out of `routes.ts`, which had grown past its size ceiling: routing is one job and deciding
 * whether a second turn may start on a session is another, and the second is the only part of that
 * file with state of its own.
 *
 * PER SESSION, not one flag for the router. `sessionFactory` resolves a session per request (the
 * documented multi-tenant shape), so a single flag made one tenant's turn refuse every other
 * tenant's — a busy neighbour is not a reason to refuse you, and that is a worse defect than the
 * race it closed.
 */

import type { IHttpTransportSession } from './http-session.js';

export interface ITurnClaims {
  /** The key this session is claimed under, or `undefined` when it will not name itself. */
  keyFor(session: IHttpTransportSession): string | undefined;
  isHeld(key: string): boolean;
  hold(key: string): void;
  release(key: string): void;
}

/**
 * A claim registry keyed by the session's declared ID, not by object identity.
 *
 * Keying on the OBJECT makes identity-stability a requirement of every caller that nothing can
 * check: a `sessionFactory` returning a fresh wrapper per call for the same logical session — a
 * proxy, an adapter, a spread copy — defeats the guard in silence, and every request looks
 * unclaimed. `getSession(): { getSessionId(): string }` already names the session, so asking for the
 * id turns an unenforceable requirement into no requirement at all.
 *
 * A claim is released in the caller's `finally`, so this does not grow with the number of sessions
 * the host has ever served — which is what weak keying would otherwise buy.
 */
export function createTurnClaims(): ITurnClaims {
  const held = new Set<string>();

  return {
    keyFor(session) {
      try {
        // No `?.`: `getSession(): { getSessionId(): string }` is non-nullable, and optional chaining
        // here would suggest the contract allows an absent session when it does not. A session that
        // breaks the contract anyway is caught below.
        const id = session.getSession().getSessionId();
        return typeof id === 'string' && id !== '' ? id : undefined;
      } catch {
        // allow-fallback: an unnameable session must not be guessed at
        // A session that throws while naming itself has not told us who it is, and guessing would
        // claim the wrong turn. The CALLER refuses on `undefined`, so nothing is swallowed here.
        //
        // `undefined` rather than a placeholder — a shared fallback key would collide every
        // unnameable session into one claim and refuse them all as each other's neighbours. There is
        // no `isExecuting()` fallback on the submit path, and an earlier comment said there was.
        return undefined;
      }
    },
    isHeld: (key) => held.has(key),
    hold: (key) => void held.add(key),
    release: (key) => void held.delete(key),
  };
}
