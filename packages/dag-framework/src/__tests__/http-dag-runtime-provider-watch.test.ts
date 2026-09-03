/**
 * Issue #2169 — `HttpDagRuntimeProvider.watchRun()` may only settle on a TERMINAL observation.
 *
 * The SSE branch of the stream-vs-poll race used to resolve on an unavailable stream, a null body
 * or an EOF without a terminal frame, which aborted the authoritative poll and returned a still
 * running result within milliseconds. Each case below keeps the run non-terminal for the first
 * status polls and asserts the watch waits for the poll to observe completion.
 */
import { describe, expect, it } from 'vitest';

import { HttpDagRuntimeProvider } from '../http-dag-runtime-provider.js';

import type { IDagRun, TDagRunStatus } from '@robota-sdk/dag-core';

const BASE_URL = 'http://dag.test';
const RUN_ID = 'run-1';

function dagRun(status: TDagRunStatus): IDagRun {
  return {
    dagRunId: RUN_ID,
    dagId: 'dag',
    version: 1,
    status,
    runKey: 'key',
    logicalDate: '2026-01-01T00:00:00.000Z',
    trigger: 'manual',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface IFakeServer {
  readonly fetch: typeof fetch;
  readonly statusPolls: () => number;
}

/**
 * A server whose run is `running` for the first `runningPolls` status reads and terminal after,
 * and whose `/events` endpoint answers with `events`.
 */
function fakeServer(runningPolls: number, events: () => Response): IFakeServer {
  let polls = 0;
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/events')) return Promise.resolve(events());
    if (url.endsWith('/result')) {
      const status: TDagRunStatus = polls >= runningPolls ? 'success' : 'running';
      return Promise.resolve(
        jsonResponse({ ok: true, data: { dagRun: dagRun(status), taskRuns: [] } }),
      );
    }
    polls += 1;
    const status: TDagRunStatus = polls > runningPolls ? 'success' : 'running';
    return Promise.resolve(jsonResponse({ ok: true, data: { dagRun: dagRun(status) } }));
  };
  return { fetch: fetchImpl, statusPolls: () => polls };
}

function sseResponse(frames: string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const RUNNING_POLLS = 3;

describe('issue #2169 — watchRun settles only on a terminal observation', () => {
  it.each([
    ['an unsupported stream (501)', () => jsonResponse({ ok: false }, 501)],
    ['a stream with no body', () => new Response(null, { status: 200 })],
    ['an empty stream that closes at once', () => sseResponse([])],
    [
      'a stream that closes after a task frame, before any terminal frame',
      () =>
        sseResponse([
          'event: open\ndata: {}\n\n',
          `event: progress\ndata: ${JSON.stringify({ eventType: 'task.started', runId: RUN_ID, nodeId: 'n1' })}\n\n`,
        ]),
    ],
  ])('%s leaves the poll as the authority', async (_label, events) => {
    const server = fakeServer(RUNNING_POLLS, events);
    const provider = new HttpDagRuntimeProvider({ baseUrl: BASE_URL, fetch: server.fetch });

    const result = await provider.watchRun(RUN_ID, () => undefined);

    expect(result.ok).toBe(true);
    expect(server.statusPolls()).toBeGreaterThan(RUNNING_POLLS);
  });

  it('a terminal frame ends the stream branch, and the result is still checked for terminality', async () => {
    const server = fakeServer(RUNNING_POLLS, () =>
      sseResponse([
        `event: progress\ndata: ${JSON.stringify({ eventType: 'execution.completed', runId: RUN_ID })}\n\n`,
      ]),
    );
    const provider = new HttpDagRuntimeProvider({ baseUrl: BASE_URL, fetch: server.fetch });

    const result = await provider.watchRun(RUN_ID, () => undefined);

    // The result endpoint reported `running` until the status polls caught up; the watch polled on
    // rather than mapping a running run as if it were over.
    expect(result.ok).toBe(true);
    expect(server.statusPolls()).toBeGreaterThanOrEqual(RUNNING_POLLS);
  });

  it('an aborted watch of a running run throws instead of returning a non-terminal result', async () => {
    const server = fakeServer(Number.POSITIVE_INFINITY, () => sseResponse([]));
    const provider = new HttpDagRuntimeProvider({ baseUrl: BASE_URL, fetch: server.fetch });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 20);

    await expect(provider.watchRun(RUN_ID, () => undefined, abort.signal)).rejects.toThrow(
      /without observing a terminal state/,
    );
  });
});
