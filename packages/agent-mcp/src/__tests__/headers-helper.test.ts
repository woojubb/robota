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
import { withoutExpansions } from '../definition/secrecy.js';

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

  it('quotes arguments so their boundaries and control characters stay visible', () => {
    const shown = (args: string[]) =>
      activationEndpoint(resolved({ headersHelper: { command: HELPER.command, args } }));
    expect(shown(['a b'])).not.toBe(shown(['a', 'b']));
    expect(shown(['a b'])).toContain('"a b"');
    const hostile = shown(['x\n\u001b[2Kok', '\u202eevil']);
    // eslint-disable-next-line no-control-regex -- asserting no control character survives
    expect(hostile).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/);
    expect(hostile).toContain('\\u202e');
    // Only the display changes; what is approved is still the exact argv.
    expect(
      definitionFingerprint(resolved({ headersHelper: { ...HELPER, args: ['a b'] } })),
    ).not.toBe(definitionFingerprint(resolved({ headersHelper: { ...HELPER, args: ['a', 'b'] } })));
  });
});

describe('a URL shown to a program the definition chose', () => {
  it('puts every expanded stretch back as its reference', () => {
    const definition = {
      provenance: {
        url: [
          { start: 8, end: 24, variable: 'MCP_HOST', secret: false },
          { start: 31, end: 37, variable: 'API_TOKEN', secret: true },
        ],
      },
    };
    expect(withoutExpansions(definition, 'url', 'https://mcp.example.test/mcp?t=abc123')).toBe(
      'https://${MCP_HOST}/mcp?t=${API_TOKEN}',
    );
    expect(withoutExpansions({}, 'url', 'https://plain.test/mcp')).toBe('https://plain.test/mcp');
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

  it('loads again only when the current generation is refused', async () => {
    let calls = 0;
    const cache = new MCPSingleFlightCache(async () => `value-${++calls}`);
    const first = await cache.getEntry();
    expect(first.value).toBe('value-1');
    cache.invalidate(first.generation);
    const second = await cache.getEntry();
    expect(second.value).toBe('value-2');
    // A late refusal of the replaced value keeps the newer one.
    cache.invalidate(first.generation);
    expect(await cache.get()).toBe('value-2');
    expect(calls).toBe(2);
  });

  it('turns concurrent refusals of one value into a single new load', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    let calls = 0;
    const cache = new MCPSingleFlightCache(() => gates[calls++]!.promise);
    const loading = cache.getEntry();
    gates[0]!.resolve('old');
    const refused = await loading;
    // Two requests sent with `old` are both refused; each invalidates and asks again.
    cache.invalidate(refused.generation);
    const a = cache.get();
    cache.invalidate(refused.generation);
    const b = cache.get();
    gates[1]!.resolve('new');
    expect(await Promise.all([a, b])).toEqual(['new', 'new']);
    expect(calls).toBe(2);
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

describe('concurrent refusals and shutdown', () => {
  it('runs the helper once more for two requests refused together', async () => {
    let runs = 0;
    const gate = deferred<void>();
    const run = vi.fn(async () => {
      runs += 1;
      if (runs === 1) await gate.promise;
      return JSON.stringify({ Authorization: `Bearer run-${runs}` });
    });
    const sent: (string | null)[] = [];
    // The second refusal arrives only after the first request already retried with fresh headers,
    // so it refuses a credential that has been replaced.
    const refreshed = deferred<void>();
    let refusals = 0;
    const fetchStub = (async (_input: unknown, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization');
      sent.push(authorization);
      if (authorization !== 'Bearer run-1') {
        refreshed.resolve();
        return new Response(null, { status: 202 });
      }
      refusals += 1;
      if (refusals === 2) await refreshed.promise;
      return new Response(null, { status: 401 });
    }) as typeof globalThis.fetch;
    const adapter = createStreamableHttpAdapter({ fetch: fetchStub, lookup });
    const admission = await adapter.admit({
      url: 'https://mcp.example.test/mcp',
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
    const both = Promise.all([transport.send(notification), transport.send(notification)]);
    gate.resolve();
    await both;
    expect(run).toHaveBeenCalledTimes(2);
    expect(sent.filter((value) => value === 'Bearer run-1')).toHaveLength(2);
    expect(sent.filter((value) => value === 'Bearer run-2').length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a rejection of headers it did not issue', async () => {
    const auth = createHeadersHelperAuthenticator(async () => '{"Authorization": "Bearer a"}');
    expect(
      await auth.onRejected({ status: 401, authorization: { Authorization: 'Bearer a' } }),
    ).toBe('fail');
  });

  it('cancels a running helper when closed', async () => {
    let runSignal: AbortSignal | undefined;
    const auth = createHeadersHelperAuthenticator((signal) => {
      runSignal = signal;
      return new Promise<string>(() => {});
    });
    const pending = auth.authorize({
      serverId: 'remote',
      securityIdentity: 'sid',
      url: new URL('https://mcp.example.test/mcp'),
    });
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(runSignal).toBeDefined());
    auth.close();
    expect(runSignal?.aborted).toBe(true);
  });
});
