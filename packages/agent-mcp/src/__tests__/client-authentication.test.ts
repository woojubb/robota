/**
 * The client authentication port: a host-registered authenticator supplies headers for one server,
 * per request, after admission — and a rejection is retried at most once, never unauthenticated.
 */

import { describe, expect, it, vi } from 'vitest';

import { MCPAuthenticationError, type IMCPClientAuthenticator } from '../client/authentication.js';
import { createStreamableHttpAdapter } from '../client/transport.js';
import { decodeEntry } from '../definition/decode.js';
import { classifyMcpFailure } from '../supervisor/connection.js';

import type { TEgressLookup } from '@robota-sdk/agent-core/node';

const lookup: TEgressLookup = async () => ['203.0.113.9'];
const NOTIFICATION = { jsonrpc: '2.0' as const, method: 'notifications/initialized' };

interface ICall {
  readonly headers: Headers;
  readonly body: unknown;
}

function stubFetch(statuses: number[]): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: ICall[];
} {
  const calls: ICall[] = [];
  const fetchStub = (async (_input: unknown, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers), body: init?.body });
    const status = statuses.shift() ?? 202;
    return new Response(null, {
      status,
      ...(status === 401 ? { headers: { 'www-authenticate': 'Bearer realm="mcp"' } } : {}),
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchStub, calls };
}

function authenticator(
  overrides: Partial<IMCPClientAuthenticator> = {},
): IMCPClientAuthenticator & {
  authorize: ReturnType<typeof vi.fn>;
  onRejected: ReturnType<typeof vi.fn>;
} {
  let issued = 0;
  return {
    authorize: vi.fn(async () => {
      issued += 1;
      return { authorization: `Bearer token-${issued}` };
    }),
    onRejected: vi.fn(async () => 'retry' as const),
    ...overrides,
  } as never;
}

async function send(
  statuses: number[],
  auth: IMCPClientAuthenticator | undefined,
  headers: Record<string, string> = {},
): Promise<{ calls: ICall[]; error: unknown }> {
  const { fetch: fetchStub, calls } = stubFetch(statuses);
  const adapter = createStreamableHttpAdapter({ fetch: fetchStub, lookup });
  const admission = await adapter.admit({
    url: 'https://mcp.example.test/mcp',
    headers,
    ...(auth === undefined
      ? {}
      : {
          authentication: { serverId: 'alpha', securityIdentity: 'sid-alpha', authenticator: auth },
        }),
  });
  if (!admission.ok) throw new Error(admission.message);
  const transport = adapter.construct(admission.admitted);
  const error = await transport.send(NOTIFICATION).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  return { calls, error };
}

describe('client authentication port', () => {
  it('adds the authenticator headers to each request, over a static header of the same name', async () => {
    const auth = authenticator();
    const { calls, error } = await send([202], auth, {
      Authorization: 'static',
      'x-other': 'kept',
    });

    expect(error).toBeUndefined();
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(calls[0]?.headers.get('x-other')).toBe('kept');
    expect(auth.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'alpha', securityIdentity: 'sid-alpha' }),
    );
  });

  it('keeps static headers alone when no authenticator is registered', async () => {
    const { calls, error } = await send([202], undefined, { Authorization: 'static' });
    expect(error).toBeUndefined();
    expect(calls[0]?.headers.get('authorization')).toBe('static');
  });

  it('retries a rejection once, with fresh authorization', async () => {
    const auth = authenticator();
    const { calls, error } = await send([401, 202], auth);

    expect(error).toBeUndefined();
    // The retried POST carries fresh authorization; the SDK's follow-up GET stream is authorized too.
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer token-2');
    expect(calls.every((call) => call.headers.get('authorization') !== null)).toBe(true);
    expect(auth.onRejected).toHaveBeenCalledWith({
      status: 401,
      wwwAuthenticate: 'Bearer realm="mcp"',
    });
  });

  it('refuses after a second rejection, and never sends unauthenticated', async () => {
    const auth = authenticator();
    const { calls, error } = await send([401, 401, 202], auth);

    expect(error).toBeInstanceOf(MCPAuthenticationError);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.headers.get('authorization') !== null)).toBe(true);
    expect(classifyMcpFailure(error)).toBe('auth');
  });

  it('refuses when the authenticator answers fail', async () => {
    const auth = authenticator({ onRejected: vi.fn(async () => 'fail' as const) });
    const { calls, error } = await send([403], auth);

    expect(error).toBeInstanceOf(MCPAuthenticationError);
    expect(calls).toHaveLength(1);
  });

  it('refuses without sending when authorization throws, and keeps its text out of the error', async () => {
    const auth = authenticator({
      authorize: vi.fn(async () => {
        throw new Error('refresh token rt-secret expired');
      }),
    });
    const { calls, error } = await send([202], auth);

    expect(calls).toHaveLength(0);
    expect(error).toBeInstanceOf(MCPAuthenticationError);
    expect(String((error as Error).message)).not.toContain('rt-secret');
  });
});

describe('declared but unsupported authentication', () => {
  it('decodes `oauth` and `headersHelper` so the server stays listed, and refuses to admit it', async () => {
    const decoded = decodeEntry({
      name: 'gamma',
      source: 'project',
      origin: '.mcp.json',
      entry: { type: 'http', url: 'https://mcp.example.test/mcp', oauth: { clientId: 'x' } },
    });
    if ('reason' in decoded) throw new Error(decoded.reason);
    expect(decoded.unsupportedAuthentication).toEqual(['oauth']);

    const adapter = createStreamableHttpAdapter({ lookup });
    const admission = await adapter.admit({
      url: 'https://mcp.example.test/mcp',
      unsupportedAuthentication: ['oauth'],
    });
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.reason).toBe('unsupported-authentication');
    expect(admission.message).toContain('oauth');
  });
});
