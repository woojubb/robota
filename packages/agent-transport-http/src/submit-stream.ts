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
): (stream: SSEStreamingApi) => Promise<void> {
  return async (stream) => {
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

      await session.submit(prompt);
      await done;
    } finally {
      // RUNTIME-14: teardown ALWAYS runs — on completion, error, OR client disconnect — so the session
      // event listeners can never leak.
      for (const fn of cleanup) fn();
      // RUNTIME-38: released here for the same reason — a turn that throws must not wedge the
      // session it claimed.
      release();
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
 * IT SENDS `error.message` VERBATIM, and review asked whether that meets the same standard as the
 * 500 branch in `routes.ts`, which deliberately withholds an internal method name. It is a fair
 * question and the answer is that the two have different alternatives available. The 500 branch can
 * withhold because the HOST still learns the detail — the condition is a contract violation
 * described where it is raised. Here there is no second channel: `no-console` is an error in `src/`,
 * this package carries no logger, and the throw is already swallowed to stop it becoming an
 * unhandled rejection. Withholding the message would not move the detail somewhere safer; it would
 * delete it, and leave an operator with a stream that ended for no stated reason.
 */
export async function reportStreamFailure(error: Error, stream: SSEStreamingApi): Promise<void> {
  await stream
    .writeSSE({ event: 'error', data: JSON.stringify({ message: error.message }) })
    .catch(() => {
      // allow-fallback: the stream is already gone, which is the one case where there is nobody
      // left to tell. Rethrowing here would restore the unhandled rejection this exists to remove.
    });
}
