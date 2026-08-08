/**
 * RUNTIME-14 / RUNTIME-38 — relaying ONE turn to an SSE client, and letting go of it afterwards.
 *
 * Split out of `routes.ts` under the file-size ceiling. The route's job is to decide whether this
 * request may start a turn; relaying the turn's events, tearing the subscriptions down, and telling
 * a client whose stream broke after the headers went out is a different job with its own failure
 * modes, and it was four fifths of the handler.
 */

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import type { SSEStreamingApi } from 'hono/streaming';

/**
 * Where the DETAIL of a post-headers stream failure goes — injected, never imported.
 *
 * The first version imported `createLogger` from `agent-core`, and review held it against two
 * authorities at once: `project-structure.md` declares this package contract-pure (transports
 * depend on the contracts and the protocol, nothing else), and its side-concern rule says a logging
 * destination "must be injected, not imported directly". The host that mounts this router decides
 * where diagnostics go; a module-level singleton decided it for every host, with no override.
 *
 * Absent, the detail is dropped — by the HOST's explicit default, which is a different thing from
 * this module deleting it: the client still learns the stream failed, and the host was offered the
 * detail at the boundary where it mounts the route.
 */
export type TStreamFailureListener = (error: Error) => void;

/**
 * The `streamSSE` callback for one submitted prompt.
 *
 * `release` is called in the teardown, ALWAYS — on completion, on error, and on client disconnect.
 * It is passed in rather than taken here because the claim is made before the stream opens: a claim
 * whose release lives only inside the stream is a lock that outlives the request that took it.
 */
export function relayTurn(
  session: IInteractiveSession,
  prompt: string,
  release: () => void,
  onFailure?: TStreamFailureListener,
): (stream: SSEStreamingApi) => Promise<void> {
  return async (stream) => {
    // NOTHING may escape this callback, and the reason is measured rather than stylistic. Hono's
    // `streamSSE` runner calls its `onError` argument and then UNCONDITIONALLY writes
    // `event: error, data: e.message` to the stream — so an escaped exception reaches the client
    // verbatim no matter what the handler withheld. The probe that found it saw TWO error events:
    // this module's generic line, then Hono's raw one. The only place the trust boundary can be
    // held is here, before the throw reaches the runner at all.
    try {
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
          // `settle` in a `finally`, and review is why the order matters more than it used to: an
          // `abort()` that throws used to cost a listener leak, and with the claim registry it now
          // costs the SESSION — `done` never resolves, the teardown never runs, the claim is held
          // forever, and every future /submit to this session is 409. `abort()` is typed as a
          // synchronous void and the shipped implementation does not throw; this is what makes that
          // an implementation detail rather than a load-bearing assumption.
          try {
            session.abort();
          } catch (error) {
            // allow-fallback: an abort that throws is the HOST's news, not the runner's
            // Not rethrown, and where the throw would land is why — review traced it: this handler
            // runs inside Hono's abort dispatch, OUTSIDE the relay's own try/catch, so a rethrow is
            // an unhandled rejection rather than a reported failure. The detail goes where every
            // other stream failure's detail goes.
            try {
              onFailure?.(error instanceof Error ? error : new Error(String(error)));
            } catch {
              // allow-fallback: a listener that throws must not replace the abort path's settle
              // Same rule as reportStreamFailure: the host's listener failing is the host's to see.
            }
          } finally {
            settle();
          }
        });

        await session.submit(prompt);
        await done;
      } finally {
        // RUNTIME-14: teardown ALWAYS runs — on completion, error, OR client disconnect — so the session
        // event listeners can never leak.
        //
        // Each entry individually, and review is why: these are `session.off` calls, and one that
        // throws inside a bare loop would end the `finally` before `release()` ran — the same
        // claim-held-forever the `abort()` guard above closes, reintroduced two lines down. A
        // failed unsubscribe forfeits one listener; taking the release with it forfeits the session.
        for (const fn of cleanup) {
          try {
            fn();
          } catch {
            // allow-fallback: a failed unsubscribe must not take the claim release with it
            // The listener stays attached — the lesser loss, and the one the next turn can survive.
          }
        }
        // RUNTIME-38: released here for the same reason — a turn that throws must not wedge the
        // session it claimed.
        release();
      }
    } catch (error) {
      await reportStreamFailure(
        error instanceof Error ? error : new Error(String(error)),
        stream,
        onFailure,
      );
    }
  };
}

/**
 * What to tell a client whose stream failed AFTER the response headers were sent.
 *
 * A throw at that point cannot become an error status — the client already has a 200 and an open
 * stream. Without this the throw is an UNHANDLED rejection: it left the process silently in a
 * browser and turned the `quality` job red under vitest, which is how it was found.
 *
 * By the time this runs, `relayTurn`'s teardown has removed the listeners and released the claim.
 * This handler owes only the telling.
 *
 * The CLIENT gets a generic line and the HOST gets the detail, and review moved this three times.
 * The first version sent `error.message` verbatim; the second sent it to a package logger imported
 * from `agent-core`, which the layering rule refuses (see `TStreamFailureListener`). What survives
 * both rounds is the boundary itself: an exception escaping the stream callback is not a message
 * anything composed for a client — it can carry provider internals, paths, or stack fragments,
 * exactly what the 500 branch in `routes.ts` withholds at the same boundary.
 *
 * The session's own `error` EVENT is different and stays verbatim in `relayTurn` above: that is the
 * session's client-facing error channel, worded by the session (`humanizeApiError`) and relayed
 * identically by the WS transport. One is a message meant for the client; this one never was.
 */
export async function reportStreamFailure(
  error: Error,
  stream: SSEStreamingApi,
  onFailure?: TStreamFailureListener,
): Promise<void> {
  try {
    onFailure?.(error);
  } catch {
    // allow-fallback: a listener that throws must not take the client's only notification with it
    // The listener is the host's code; its failure is the host's to see, and the write below is the
    // one thing this function owes the client either way.
  }
  await stream
    .writeSSE({
      event: 'error',
      data: JSON.stringify({
        message: 'the stream failed on the server after it opened — the turn may not have run',
      }),
    })
    .catch(() => {
      // allow-fallback: the stream is already gone, which is the one case where there is nobody
      // left to tell. Rethrowing here would restore the unhandled rejection this exists to remove.
    });
}
