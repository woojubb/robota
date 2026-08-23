/**
 * SEC-015 — `HttpExecutor` outcome decoding, driven against a REAL `node:http` server.
 *
 * The previous suite stubbed `fetch`. A stub is the wrong instrument for this contract: the three
 * failure kinds it must separate (`timeout`, `transport-failure`, `malformed-response`) are
 * distinguished by what the platform's `fetch` actually throws — a `DOMException` named
 * `TimeoutError`, a `TypeError` carrying `ECONNREFUSED`, a `SyntaxError` from the body read — and a
 * stub that resolves whatever the test author decided proves only that the author agreed with
 * themselves. The server binds to port 0 on loopback, so there is no fixed port and no egress.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import { HttpExecutor } from '../executors/http-executor.js';

import type { IHookInput } from '../types.js';

const input: IHookInput = {
  session_id: 'test',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
};

/** What the next request should answer with. Reassigned per test. */
let respond: (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void;
let server: Server;
let url: string;
/** Captured so the header/body assertions do not need a second mechanism. */
let lastHeaders: Record<string, string | string[] | undefined> = {};
let lastBody = '';

beforeEach(async () => {
  respond = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  };
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks).toString('utf8');
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Answer every request with this status and body. */
function reply(status: number, body: string, contentType = 'application/json'): void {
  respond = (_req, res) => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
  };
}

describe('HttpExecutor', () => {
  const executor = new HttpExecutor();

  it('should have type "http"', () => {
    expect(executor.type).toBe('http');
  });

  it('POSTs the hook input as JSON with a Content-Type header', async () => {
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome.outcome).toBe('allow');
    expect(lastHeaders['content-type']).toBe('application/json');
    expect(JSON.parse(lastBody)).toMatchObject({ session_id: 'test', tool_name: 'Bash' });
  });

  it('interpolates $VAR references in headers from process.env', async () => {
    process.env['SEC_015_TOKEN'] = 'sekrit';
    try {
      await executor.execute(
        { type: 'http', url, headers: { Authorization: 'Bearer $SEC_015_TOKEN' } },
        input,
      );
      expect(lastHeaders['authorization']).toBe('Bearer sekrit');
    } finally {
      delete process.env['SEC_015_TOKEN'];
    }
  });

  // ── The verdicts ────────────────────────────────────────────────────────────────────────────
  it('{"ok":true} is allow, carrying the raw body as stdout', async () => {
    reply(200, '{"ok":true,"note":"fine"}');
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome.outcome).toBe('allow');
    expect(outcome.outcome === 'allow' && JSON.parse(outcome.stdout)).toMatchObject({ ok: true });
  });

  it('{"ok":false,...} is deny, carrying the endpoint\'s reason', async () => {
    reply(200, '{"ok":false,"reason":"nope"}');
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome).toEqual({ outcome: 'deny', source: 'http', reason: 'nope' });
  });

  it('{"ok":false} with no reason denies with a default reason', async () => {
    reply(200, '{"ok":false}');
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome.outcome).toBe('deny');
    expect(outcome.outcome === 'deny' && outcome.reason).toBe('Blocked by http hook');
  });

  // ── SEC-015 TC-01 / TC-02: the truthiness coercion, in BOTH directions ──────────────────────
  //
  // These are the regression rows. Reverse-apply this executor's diff and both blocks go red on a
  // value, not on a type: the pre-fix code answers `exitCode: 0` for the first group (gate silently
  // disabled) and `exitCode: 2` for the second (a tool call blocked by a verdict no endpoint
  // issued). Neither is `outcome: 'error'`.
  describe('TC-01 — a truthy non-boolean `ok` must NOT read as allow', () => {
    it.each(['{"ok":"false"}', '{"ok":1}', '{"ok":"true"}', '{"ok":{}}'])(
      '%s is error/malformed-response',
      async (body) => {
        reply(200, body);
        const outcome = await executor.execute({ type: 'http', url }, input);
        expect(outcome.outcome).toBe('error');
        expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
      },
    );
  });

  describe('TC-02 — a falsy or absent `ok` must NOT read as deny', () => {
    it.each(['{}', '{"ok":null}', '{"ok":0}', '{"ok":""}', '"not an object"', '[]', 'null'])(
      '%s is error/malformed-response, not a denial',
      async (body) => {
        reply(200, body);
        const outcome = await executor.execute({ type: 'http', url }, input);
        expect(outcome.outcome).toBe('error');
        // Stated as its own assertion rather than left implicit in the line above: `deny` is the
        // specific wrong answer this row exists to forbid, and it is what the pre-fix code returns.
        expect(outcome.outcome).not.toBe('deny');
        expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
      },
    );
  });

  // ── SEC-015 TC-04: transport conditions are separate kinds ──────────────────────────────────
  it('a non-2xx response is error/http-status', async () => {
    reply(503, 'service unavailable', 'text/plain');
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome.outcome).toBe('error');
    if (outcome.outcome !== 'error') return;
    expect(outcome.kind).toBe('http-status');
    expect(outcome.reason).toContain('503');
  });

  it('a 2xx body that is not JSON is error/malformed-response', async () => {
    reply(200, '<html>not json</html>', 'text/html');
    const outcome = await executor.execute({ type: 'http', url }, input);
    expect(outcome.outcome).toBe('error');
    if (outcome.outcome !== 'error') return;
    expect(outcome.kind).toBe('malformed-response');
    // The excerpt is what makes a misconfigured endpoint identifiable from the reason alone.
    expect(outcome.reason).toContain('<html>');
  });

  it('an unreachable endpoint is error/transport-failure', async () => {
    // A port that was bound and then closed: guaranteed free, unlike a hard-coded number.
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}/`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const outcome = await executor.execute({ type: 'http', url: deadUrl }, input);
    expect(outcome.outcome).toBe('error');
    expect(outcome.outcome === 'error' && outcome.kind).toBe('transport-failure');
  });

  it('a slow endpoint is error/timeout — distinct from transport-failure', async () => {
    respond = (_req, res) => {
      setTimeout(() => res.end('{"ok":true}'), 5_000);
    };
    const outcome = await executor.execute({ type: 'http', url, timeout: 1 }, input);
    expect(outcome.outcome).toBe('error');
    expect(outcome.outcome === 'error' && outcome.kind).toBe('timeout');
  }, 15_000);

  // ── SEC-015 TC-05 ───────────────────────────────────────────────────────────────────────────
  it('every outcome carries source: "http"', async () => {
    const bodies = ['{"ok":true}', '{"ok":false}', '{}'];
    for (const body of bodies) {
      reply(200, body);
      const outcome = await executor.execute({ type: 'http', url }, input);
      expect(outcome.source).toBe('http');
    }
  });
});
