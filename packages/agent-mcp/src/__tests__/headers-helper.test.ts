/**
 * The dynamic header helper: decoded as an exact argv, allowed only by the host, fingerprinted
 * with the URL it serves, parsed strictly, run once per connection and once more after a refusal.
 */

import { describe, expect, it, vi } from 'vitest';

import { MCPAuthenticationError } from '../client/authentication.js';
import {
  MCPHeadersHelperError,
  createHeadersHelperAuthenticator,
  parseHeadersHelperOutput,
  refuseHeadersHelper,
} from '../client/headers-helper.js';
import { MCPSingleFlightCache, MCPSingleFlightClosedError } from '../client/single-flight.js';
import { createStreamableHttpAdapter } from '../client/transport.js';
import { decodeEntry } from '../definition/decode.js';
import { activationEndpoint, definitionFingerprint } from '../definition/identity.js';

import type { IMCPServerDefinitionResolved } from '../definition/types.js';
import type { TEgressLookup } from '@robota-sdk/agent-core/node';

const HELPER = { command: '/usr/local/bin/mcp-token', args: ['--audience', 'mcp'] };
const lookup: TEgressLookup = async () => ['203.0.113.9'];

function decode(entry: Record<string, unknown>) {
  return decodeEntry({ name: 'remote', source: 'user', origin: 'settings.json', entry });
}

function reasonOf(entry: Record<string, unknown>): string {
  const decoded = decode(entry);
  if (!('reason' in decoded)) throw new Error('expected a refusal');
  return decoded.reason;
}

const HTTP = { type: 'http', url: 'https://mcp.example.test/mcp' };

describe('decoding `headersHelper`', () => {
  it('accepts the argv form on a remote server, as a helper rather than unsupported auth', () => {
    const decoded = decode({ ...HTTP, headersHelper: HELPER });
    if ('reason' in decoded) throw new Error(decoded.reason);
    expect(decoded.headersHelper).toEqual(HELPER);
    expect(decoded.unsupportedAuthentication).toBeUndefined();
  });

  it('defaults absent args to none', () => {
    const decoded = decode({ ...HTTP, headersHelper: { command: HELPER.command } });
    if ('reason' in decoded) throw new Error(decoded.reason);
    expect(decoded.headersHelper).toEqual({ command: HELPER.command, args: [] });
  });

  it('refuses the shell-string form, showing the argv form and not the string', () => {
    const reason = reasonOf({ ...HTTP, headersHelper: 'get-token --secret-flag' });
    expect(reason).toContain('"command"');
    expect(reason).toContain('"args"');
    expect(reason).not.toContain('secret-flag');
  });

  it('refuses templates in the command or an argument', () => {
    expect(
      reasonOf({ ...HTTP, headersHelper: { command: '${HOME}/bin/token', args: [] } }),
    ).toContain('templates');
    expect(
      reasonOf({ ...HTTP, headersHelper: { command: HELPER.command, args: ['${TOKEN}'] } }),
    ).toContain('templates');
  });

  it('refuses a relative command, unknown keys and non-string args', () => {
    expect(reasonOf({ ...HTTP, headersHelper: { command: 'token', args: [] } })).toContain(
      'absolute',
    );
    expect(reasonOf({ ...HTTP, headersHelper: { ...HELPER, shell: true } })).toContain(
      'only `command` and `args`',
    );
    expect(reasonOf({ ...HTTP, headersHelper: { command: HELPER.command, args: [1] } })).toContain(
      '`headersHelper.args`',
    );
  });

  it('refuses a helper on a stdio server', () => {
    expect(reasonOf({ type: 'stdio', command: '/bin/server', headersHelper: HELPER })).toContain(
      'headersHelper',
    );
  });
});

function resolved(
  overrides: Partial<IMCPServerDefinitionResolved> = {},
): IMCPServerDefinitionResolved {
  return {
    name: 'remote',
    source: 'user',
    origin: 'settings.json',
    transport: 'http',
    url: 'https://mcp.example.test/mcp',
    unsetVariables: [],
    ...overrides,
  };
}

describe('the helper in the activation identity', () => {
  it('changes the fingerprint when a helper is added or its argv changes', () => {
    const without = definitionFingerprint(resolved());
    const withHelper = definitionFingerprint(resolved({ headersHelper: HELPER }));
    const otherArgs = definitionFingerprint(
      resolved({ headersHelper: { ...HELPER, args: ['--audience', 'other'] } }),
    );
    const splitArgs = definitionFingerprint(
      resolved({ headersHelper: { ...HELPER, args: ['--audience mcp'] } }),
    );
    expect(new Set([without, withHelper, otherArgs, splitArgs]).size).toBe(4);
    expect(definitionFingerprint(resolved())).toBe(without);
  });

  it('shows the helper beside the URL it serves', () => {
    expect(activationEndpoint(resolved({ headersHelper: HELPER }))).toBe(
      'https://mcp.example.test/mcp (headers from /usr/local/bin/mcp-token --audience mcp)',
    );
    expect(activationEndpoint(resolved())).toBe('https://mcp.example.test/mcp');
  });
});

describe('who may run a helper', () => {
  const trusted = { repositoryKey: 'repo', trustState: 'trusted' as const, generation: 1 };
  const untrusted = { ...trusted, trustState: 'untrusted' as const };

  it('refuses a helper whose exact argv is not allowed', () => {
    expect(refuseHeadersHelper(HELPER, 'user', undefined, [])).toBe('headers-helper-not-allowed');
    expect(
      refuseHeadersHelper(HELPER, 'user', undefined, [{ ...HELPER, args: ['--audience'] }]),
    ).toBe('headers-helper-not-allowed');
    expect(
      refuseHeadersHelper(HELPER, 'user', undefined, [{ ...HELPER, command: '/bin/other' }]),
    ).toBe('headers-helper-not-allowed');
  });

  it('refuses a project or local helper outside a trusted workspace', () => {
    expect(refuseHeadersHelper(HELPER, 'project', untrusted, [HELPER])).toBe(
      'headers-helper-untrusted',
    );
    expect(refuseHeadersHelper(HELPER, 'local', undefined, [HELPER])).toBe(
      'headers-helper-untrusted',
    );
    expect(refuseHeadersHelper(HELPER, 'project', trusted, [HELPER])).toBeUndefined();
    expect(refuseHeadersHelper(HELPER, 'user', undefined, [HELPER])).toBeUndefined();
  });
});

function failureOf(text: string): string {
  try {
    parseHeadersHelperOutput(text);
  } catch (error) {
    expect(error).toBeInstanceOf(MCPHeadersHelperError);
    expect((error as Error).message).not.toContain('secret');
    return (error as MCPHeadersHelperError).reason;
  }
  throw new Error('expected a refusal');
}

describe('parsing helper output', () => {
  it('reads one object of string values, surrounding whitespace allowed', () => {
    expect(parseHeadersHelperOutput(' {"Authorization": "Bearer a\\u0062", "X-Id": ""}\n')).toEqual(
      { Authorization: 'Bearer ab', 'X-Id': '' },
    );
    expect(parseHeadersHelperOutput('{}')).toEqual({});
  });

  it('refuses anything else, without quoting it', () => {
    expect(failureOf('{"Authorization": "secret"} trailing')).toBe('output-malformed');
    expect(failureOf('{"Authorization": "secret"}{}')).toBe('output-malformed');
    expect(failureOf('{"X-Count": 1}')).toBe('output-malformed');
    expect(failureOf('{"X": {"secret": "a"}}')).toBe('output-malformed');
    expect(failureOf('["secret"]')).toBe('output-malformed');
    expect(failureOf('')).toBe('output-malformed');
    expect(failureOf('{"a": "secret",}')).toBe('output-malformed');
  });

  it('refuses duplicate names, exact or differing only in case', () => {
    expect(failureOf('{"X-A": "secret", "X-A": "b"}')).toBe('header-duplicate');
    expect(failureOf('{"x-a": "secret", "X-A": "b"}')).toBe('header-duplicate');
  });

  it('refuses invalid names and values', () => {
    expect(failureOf('{"Bad Name": "secret"}')).toBe('header-name-invalid');
    expect(failureOf('{"": "secret"}')).toBe('header-name-invalid');
    expect(failureOf('{"X-A": "secret\\r\\nX-B: injected"}')).toBe('header-value-invalid');
    expect(failureOf('{"X-A": "secret\\u0100"}')).toBe('header-value-invalid');
  });

  it('refuses more than 32 headers', () => {
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`X-${i}`, 'secret']));
    expect(failureOf(JSON.stringify(many))).toBe('too-many-headers');
    const enough = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`X-${i}`, 'v']));
    expect(Object.keys(parseHeadersHelperOutput(JSON.stringify(enough)))).toHaveLength(32);
  });

  it.each([
    'Host',
    'Content-Length',
    'Transfer-Encoding',
    'Connection',
    'Content-Type',
    'Accept',
    'Mcp-Session-Id',
    'MCP-Protocol-Version',
    'traceparent',
  ])('refuses the transport-owned header %s', (name) => {
    expect(failureOf(JSON.stringify({ [name]: 'secret' }))).toBe('header-forbidden');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the single-flight cache', () => {
  it('runs one load for concurrent callers and reuses its value', async () => {
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const cache = new MCPSingleFlightCache(load);
    const first = cache.get();
    const second = cache.get();
    gate.resolve('value');
    expect(await Promise.all([first, second])).toEqual(['value', 'value']);
    expect(await cache.get()).toBe('value');
    expect(load).toHaveBeenCalledOnce();
  });

  it('does not cache a failure', async () => {
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('value');
    const cache = new MCPSingleFlightCache(load);
    await expect(cache.get()).rejects.toThrow('boom');
    expect(await cache.get()).toBe('value');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads again after invalidation, and never stores a load started before it', async () => {
    const gates = [deferred<string>(), deferred<string>()];
    let calls = 0;
    const cache = new MCPSingleFlightCache(() => gates[calls++]!.promise);
    const stale = cache.get();
    cache.invalidate();
    const fresh = cache.get();
    gates[0]!.resolve('old');
    gates[1]!.resolve('new');
    expect(await stale).toBe('old');
    expect(await fresh).toBe('new');
    expect(await cache.get()).toBe('new');
  });

  it('cancels the load only when every waiting caller gave up', async () => {
    let loadSignal: AbortSignal | undefined;
    const cache = new MCPSingleFlightCache((signal) => {
      loadSignal = signal;
      return new Promise<string>(() => {});
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.get(a.signal);
    const second = cache.get(b.signal);
    a.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadSignal?.aborted).toBe(false);
    b.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadSignal?.aborted).toBe(true);
  });

  it('cancels a running load when closed, and refuses later callers', async () => {
    let loadSignal: AbortSignal | undefined;
    const cache = new MCPSingleFlightCache((signal) => {
      loadSignal = signal;
      return new Promise<string>(() => {});
    });
    void cache.get().catch(() => undefined);
    cache.close();
    expect(loadSignal?.aborted).toBe(true);
    await expect(cache.get()).rejects.toBeInstanceOf(MCPSingleFlightClosedError);
  });
});

interface ICall {
  readonly headers: Headers;
}

async function connectThrough(
  statuses: number[],
  run: (signal: AbortSignal) => Promise<string>,
): Promise<{ calls: ICall[]; error: unknown }> {
  const calls: ICall[] = [];
  const fetchStub = (async (_input: unknown, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers) });
    return new Response(null, { status: statuses.shift() ?? 202 });
  }) as typeof globalThis.fetch;
  const adapter = createStreamableHttpAdapter({ fetch: fetchStub, lookup });
  const admission = await adapter.admit({
    url: 'https://mcp.example.test/mcp',
    headers: { Authorization: 'static' },
    authenticationRequired: true,
    authentication: {
      serverId: 'remote',
      securityIdentity: 'sid',
      authenticator: createHeadersHelperAuthenticator(run),
    },
  });
  if (!admission.ok) throw new Error(admission.message);
  const transport = adapter.construct(admission.admitted);
  const notification = { jsonrpc: '2.0' as const, method: 'notifications/initialized' };
  let error: unknown;
  try {
    await transport.send(notification);
    await transport.send(notification);
  } catch (caught) {
    error = caught;
  }
  return { calls, error };
}

describe('a helper behind the authentication port', () => {
  it('runs once for the connection and puts its headers over the static ones', async () => {
    const run = vi.fn(async () => '{"Authorization": "Bearer from-helper"}');
    const { calls, error } = await connectThrough([202, 202], run);
    expect(error).toBeUndefined();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => call.headers.get('authorization') === 'Bearer from-helper')).toBe(
      true,
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it('runs again once after a 401, and sends the fresh headers', async () => {
    let runs = 0;
    const run = vi.fn(async () => JSON.stringify({ Authorization: `Bearer run-${++runs}` }));
    const { calls, error } = await connectThrough([401, 202, 202], run);
    expect(error).toBeUndefined();
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer run-1');
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer run-2');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('fails content-free when the helper output is refused', async () => {
    const run = vi.fn(async () => '{"Authorization": "Bearer secret-value", "Host": "evil"}');
    const { calls, error } = await connectThrough([202], run);
    expect(calls).toHaveLength(0);
    expect(error).toBeInstanceOf(MCPAuthenticationError);
    expect(String(error)).not.toContain('secret-value');
  });

  it('is never replaced by the static headers when no authenticator is registered', async () => {
    const adapter = createStreamableHttpAdapter({ lookup });
    const admission = await adapter.admit({
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'static' },
      authenticationRequired: true,
    });
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.reason).toBe('authentication-unavailable');
  });
});
