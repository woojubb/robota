/**
 * SEC-008 — the user-execution scenario, as CODE.
 *
 * The closure of SEC-008 first carried this evidence as prose: a report that a run had happened
 * once, with the runner not checked in. Review named the irony — SEC-008 is precisely about "the
 * trust boundary being documentation rather than code", and the evidence for closing it was
 * documentation rather than code. So the scenario lives here, where anyone can re-run it.
 *
 * What makes this different from the sibling route suites, which already cover the same code paths:
 * it is a REAL HTTP round-trip over a REAL loopback socket, not an in-process `app.fetch()`. The
 * thing being demonstrated is what an unauthenticated remote request DOES to a served transport, so
 * the request has to actually travel.
 *
 * The observable is the session TRANSCRIPT — what reached `submit` — because "rejected" and "never
 * executed" are different claims and only the second one is the security property.
 */

import { createServer, type Server } from 'node:http';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createHttpTransport } from '../http-transport.js';

import type { IInteractiveSession, ITurnHandle } from '@robota-sdk/agent-interface-session';

/**
 * A CONFORMANT turn handle. Not `{ status: 'started' }` behind a cast: `ITurnHandle` is
 * `{ turnId, completed }`, and a double that answers a different shape is a partial
 * re-implementation the compiler was told to stop checking. The route only awaits the terminal
 * event today, so the difference is invisible — until a call site reads `.completed`, at which
 * point the double would misrepresent the contract silently. (#1684 review)
 */
function stubHandle(turnId: string): ITurnHandle {
  return {
    turnId,
    completed: Promise.resolve({
      response: '',
      history: [],
      toolSummaries: [],
      contextState: { usedTokens: 0, maxTokens: 0, usedPercentage: 0, remainingPercentage: 100 },
    }),
  };
}

/** A session that RECORDS what actually reached it — the transcript the scenario asserts on. */
function createRecordingSession(): { session: IInteractiveSession; transcript: string[] } {
  const transcript: string[] = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = (event: string, data: unknown): void => {
    for (const handler of listeners.get(event) ?? []) handler(data);
  };
  const session = createTestInteractiveSession({
    isExecuting: () => false,
    submit: (async (prompt: string) => {
      transcript.push(prompt);
      // The route's SSE stream ends on the terminal event; a session that never emits one leaves
      // the request hanging, so the case would fail on a timeout — a red for the wrong reason.
      queueMicrotask(() => emit('complete', { success: true, content: 'done' }));
      return stubHandle('scenario-turn');
    }) as IInteractiveSession['submit'],
    on: ((event: string, handler: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: (data: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return { session, transcript };
}

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

/**
 * Serve a transport's app on a real loopback port and return its base URL.
 *
 * `fetch` is typed as `Response | Promise<Response>` on Hono — it answers synchronously for some
 * routes — so the parameter accepts both and the call site awaits, rather than narrowing the app to
 * a shape it does not have.
 */
async function serve(app: {
  fetch: (request: Request) => Response | Promise<Response>;
}): Promise<string> {
  const server = createServer((req, res) => {
    void (async () => {
      // Everything inside is guarded: an unhandled rejection here would leave `res.end()` uncalled,
      // so the client-side `fetch` below would hang to the test timeout instead of failing with a
      // cause. In a file whose whole subject is a gate that refuses LEGIBLY, an illegible hang is
      // the wrong failure mode to build the harness on. (#1684 review)
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        // Node's `IncomingHttpHeaders` values are `string | string[] | undefined`, which is not
        // `HeadersInit` — casting across that gap works for this fixture's simple headers and
        // silently mangles an array-valued one (`set-cookie`, a repeated header) the day the
        // harness is reused. Built explicitly instead, so a repeated header stays repeated.
        // (#1684 review)
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.set(name, value);
        }
        const response = await app.fetch(
          new Request(`http://127.0.0.1:${port}${req.url ?? '/'}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          }),
        );
        res.statusCode = response.status;
        res.end(await response.text());
      } catch (error) {
        // 500 with the cause in the body, so a broken harness reads as a broken harness rather than
        // as a transport that answered nothing.
        res.statusCode = 500;
        res.end(
          `scenario harness failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function submit(base: string, prompt: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ prompt }),
  });
  return { status: res.status, body: await res.text() };
}

describe('SEC-008 scenario — an unauthenticated remote request reaches no session', () => {
  it('rejects POST /submit with no credential, and the prompt is NEVER executed', async () => {
    // `admission` omitted is the shipped default and means SECURE: a credential is minted.
    const transport = createHttpTransport();
    const { session, transcript } = createRecordingSession();
    transport.attach(session);
    await transport.start();
    const base = await serve(transport.getApp());

    const res = await submit(base, 'hello from an unauthenticated caller');

    expect(res.status, `expected a rejection, got ${res.status} ${res.body}`).toBe(401);
    // The security property is not "answered 401" — it is that nothing ran.
    expect(transcript, 'the unauthenticated prompt reached the session').toEqual([]);
  });

  it('accepts the same request with the minted credential, and only that prompt runs', async () => {
    const transport = createHttpTransport();
    const { session, transcript } = createRecordingSession();
    transport.attach(session);
    await transport.start();
    const base = await serve(transport.getApp());
    const token = transport.getAdmissionToken();

    expect(token, 'omitting admission must MINT a credential, not run open').toBeTruthy();

    const rejected = await submit(base, 'unauthenticated');
    const accepted = await submit(base, 'authenticated', { authorization: `Bearer ${token}` });

    expect(rejected.status).toBe(401);
    expect(accepted.status, `expected success, got ${accepted.status} ${accepted.body}`).toBe(200);
    expect(transcript).toEqual(['authenticated']);
  });

  it('CONTRAST: an explicitly OPEN transport executes the same unauthenticated prompt', async () => {
    // What the absent gate used to do for every caller. Reaching this state now takes asking for it
    // AND writing down why — `openReason` is required, and `open` with a token is refused outright.
    const transport = createHttpTransport({
      admission: { open: true, openReason: 'SEC-008 scenario: the contrast this closure rests on' },
    });
    const { session, transcript } = createRecordingSession();
    transport.attach(session);
    await transport.start();
    const base = await serve(transport.getApp());

    const res = await submit(base, 'unauthenticated against an open transport');

    expect(transport.getAdmissionToken(), 'an open transport holds no credential').toBeNull();
    expect(res.status).toBe(200);
    expect(transcript).toEqual(['unauthenticated against an open transport']);
  });
});
