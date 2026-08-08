/**
 * The relay's own failure modes — the ones an HTTP request cannot conveniently reach.
 *
 * `reportStreamFailure` runs after the headers are out, and `onAbort` runs when the client is
 * already gone; both are places where "what does the other side learn" and "does the claim come
 * back" have to be asked directly.
 */

import { describe, expect, it, vi } from 'vitest';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

import { relayTurn, reportStreamFailure } from '../submit-stream.js';

import type { SSEStreamingApi } from 'hono/streaming';

function fakeStream(overrides: Partial<SSEStreamingApi> = {}): {
  stream: SSEStreamingApi;
  written: Array<{ event?: string; data: string }>;
} {
  const written: Array<{ event?: string; data: string }> = [];
  const stream = {
    writeSSE: (message: { event?: string; data: string }) => {
      written.push(message);
      return Promise.resolve();
    },
    onAbort: () => {},
    ...overrides,
  } as unknown as SSEStreamingApi;
  return { stream, written };
}

describe('what a client learns from a stream that failed after it opened', () => {
  it('is a generic line, not the exception', async () => {
    // Review, twice: this route can be mounted outside a trust boundary, and an exception ESCAPING
    // the stream callback is not a message anything composed for a client — it can carry provider
    // internals, paths, stack fragments. The detail goes to the package logger; the client learns
    // that the stream failed, which is the part it can act on.
    const { stream, written } = fakeStream();

    await reportStreamFailure(new Error('ENOENT /home/op/.robota/providers/key.json'), stream);

    expect(written).toHaveLength(1);
    expect(written[0].data).not.toContain('key.json');
    expect(written[0].data).toContain('the stream failed on the server');
  });

  it('swallows a write to a stream that is already gone', async () => {
    const { stream } = fakeStream({
      writeSSE: () => Promise.reject(new Error('closed')),
    });

    await expect(reportStreamFailure(new Error('x'), stream)).resolves.toBeUndefined();
  });
});

describe('a client disconnect releases the claim even when abort throws', () => {
  it('settles and releases', async () => {
    // Review: before the claim registry this cost a listener leak; now an `abort()` that throws
    // would hold the claim forever and 409 every future /submit to this session. `abort()` is typed
    // as a synchronous void and the shipped one does not throw — this case is what turns that from
    // a load-bearing assumption into an implementation detail.
    const release = vi.fn();
    // The conformant double, not a cast — the contract-cast ratchet refuses another one, and it is
    // right to. `submit` resolves at once so the relay parks on `done`, which only the abort path
    // settles here.
    const session = createTestInteractiveSession({
      abort: () => {
        throw new Error('abort blew up');
      },
    });

    let abortHandler!: () => void;
    const { stream } = fakeStream({
      onAbort: (handler: () => void) => {
        abortHandler = handler;
      },
    });

    const relaying = relayTurn(session, 'prompt', release)(stream);
    // The registered handler throws through `session.abort()`; the relay must still settle.
    expect(() => abortHandler()).toThrow('abort blew up');
    await relaying;

    expect(release).toHaveBeenCalledTimes(1);
  });
});
