import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredNodeOtlpLiveTelemetryPort, createNodeOtlpLiveTracePort } from '../live-trace-otlp.js';
import { createNodeOtlpLiveMetricPort } from '../live-metric-otlp.js';
import { createNodeOtlpLiveLogPort } from '../live-log-otlp.js';
import { parseOtlpHeaderSetting } from '../live-otlp-headers.js';

const SENTINEL_NAME = 'x-sentinel-name-q7';
const SENTINEL_VALUE = 'sentinel-value-z9';

const batch: ILivePromptTraceBatch = {
  schemaVersion: 1, sessionId: 'session-1', turnId: 'turn-1',
  root: {
    traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
    startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:01.000Z',
    outcome: 'success',
  },
  children: [{ kind: 'tool', trace: {
    toolCallId: 'call-123', traceId: '1234567890abcdef1234567890abcdef',
    parentSpanId: '1234567890abcdef', spanId: 'abcdef1234567890',
    startedAt: '2026-09-24T00:00:00.100Z', endedAt: '2026-09-24T00:00:00.900Z',
    outcome: 'success',
  } }], omittedChildren: { provider: 0, tool: 0, permission: 0 },
};

const GENERIC = 'ROBOTA_TELEMETRY_OTLP_HEADERS';
const base = {
  ROBOTA_TELEMETRY_ENABLED: '1',
  ROBOTA_TELEMETRY_TRACES: 'otlp',
  ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

function startupError(env: Record<string, string>): Error {
  let error: unknown;
  try { createConfiguredNodeOtlpLiveTelemetryPort(env, undefined, () => undefined); }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

function expectSecretFree(message: string, raw: string): void {
  expect(message).not.toContain(SENTINEL_NAME);
  expect(message).not.toContain(SENTINEL_VALUE);
  for (const entry of raw.split(',')) {
    const [name, value] = entry.split('=');
    if (name && name.trim().length > 3) expect(message).not.toContain(name.trim());
    if (value && value.trim().length > 3) expect(message).not.toContain(value.trim());
  }
}

interface ICaptured { path: string; headers: IncomingHttpHeaders; rawHeaders: string[]; body: string }

async function withCollector(run: (url: string, requests: ICaptured[]) => Promise<void>): Promise<void> {
  const requests: ICaptured[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      path: request.url ?? '', headers: request.headers, rawHeaders: request.rawHeaders,
      body: Buffer.concat(chunks).toString('latin1'),
    });
    response.writeHead(200, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function headerCount(request: ICaptured, name: string): number {
  return request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('static OTLP header parsing', () => {
  it.each([
    ['no equals sign', 'justaname', 1],
    ['empty entry in the middle', 'a=b,,c=d', 2],
    ['trailing empty entry', 'a=b,', 2],
    ['whitespace-only entry', 'a=b,  ', 2],
    ['empty name', '=value', 1],
    ['empty value', 'a=b,name=', 2],
    ['whitespace-only value', 'name=   ', 1],
    ['name with a space', 'bad name=v', 1],
    ['name with a percent sign', 'x%41=v', 1],
    ['name with a colon', 'x:y=v', 1],
    ['name over the size limit', `${'n'.repeat(129)}=v`, 1],
    ['CRLF injection', 'x-ok=v%0D%0AInjected: yes', 1],
    ['NUL byte', 'x-ok=v%00', 1],
    ['DEL byte', 'x-ok=v%7F', 1],
    ['non-ASCII value', 'x-ok=%E2%82%AC', 1],
    ['raw non-ASCII value', 'x-ok=café', 1],
    ['percent-decoded leading space', 'x-ok=%20tok', 1],
    ['percent-decoded trailing tab', 'x-ok=tok%09', 1],
    ['malformed percent escape', 'x-ok=%zz', 1],
    ['truncated UTF-8 escape', 'x-ok=%E2%82', 1],
    ['value over the size limit', `x-ok=${'v'.repeat(4097)}`, 1],
    ['duplicate name, case-insensitive', 'x-dup=1,X-Dup=2', 2],
  ])('rejects %s, naming only the variable and entry', (_label, raw, entry) => {
    const error = startupError({ ...base, [GENERIC]: raw });
    expect(error.message).toContain(GENERIC);
    expect(error.message).toMatch(new RegExp(`entry ${entry}\\b`, 'u'));
    expectSecretFree(error.message, raw);
  });

  it.each([
    'content-type', 'Content-Length', 'content-encoding', 'transfer-encoding', 'Host', 'connection',
    'keep-alive', 'upgrade', 'TE', 'trailer', 'expect', 'accept', 'accept-encoding', 'Accept-Charset',
    'accept-language',
    'proxy-authorization', 'Proxy-Anything', 'sec-fetch-mode', 'Sec-Custom', 'traceparent',
    'tracestate', 'baggage',
  ])('rejects the reserved header name %s', (name) => {
    const raw = `x-ok=1,${name}=${SENTINEL_VALUE}`;
    const error = startupError({ ...base, [GENERIC]: raw });
    expect(error.message).toContain(GENERIC);
    expect(error.message).toMatch(/entry 2\b/u);
    if (name.length > 2) expect(error.message.toLowerCase()).not.toContain(name.toLowerCase());
    expectSecretFree(error.message, raw);
  });

  it('rejects a raw setting over the size limit and more entries than allowed', () => {
    const tooLong = startupError({ ...base, [GENERIC]: `x-ok=${'v'.repeat(8200)}` });
    expect(tooLong.message).toContain(GENERIC);
    expect(tooLong.message).not.toContain('vvvv');
    const many = Array.from({ length: 33 }, (_, index) => `x-h${index}=v`).join(',');
    const tooMany = startupError({ ...base, [GENERIC]: many });
    expect(tooMany.message).toContain(GENERIC);
    expect(tooMany.message).not.toContain('x-h');
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ...base, [GENERIC]: Array.from({ length: 32 }, (_, index) => `x-h${index}=v`).join(','),
    })).not.toThrow();
  });

  it('decodes values but never names, and keeps "=" inside a value', () => {
    const map = parseOtlpHeaderSetting(GENERIC,
      ' Authorization = Basic%20dXNlcjpwYXNz ,X-Tenant=dG9rZW4=,x-raw=a=b==,x-tab=a%09b');
    expect(map).toEqual({
      authorization: 'Basic dXNlcjpwYXNz', 'x-tenant': 'dG9rZW4=', 'x-raw': 'a=b==', 'x-tab': 'a\tb',
    });
    expect(Object.isFrozen(map)).toBe(true);
    expect(() => parseOtlpHeaderSetting(GENERIC, 'x%2Dname=v')).toThrow(GENERIC);
  });

  it('keeps disabled telemetry inert whatever the header settings contain', () => {
    const invalid = { [GENERIC]: 'x%41=%0D%0A', ROBOTA_TELEMETRY_OTLP_LOGS_HEADERS: '=' };
    expect(createConfiguredNodeOtlpLiveTelemetryPort(invalid)).toBeUndefined();
    expect(createConfiguredNodeOtlpLiveTelemetryPort({ ...invalid, ROBOTA_TELEMETRY_ENABLED: '0' })).toBeUndefined();
  });

  it('still rejects header helpers and other header-shaped settings', () => {
    for (const name of ['ROBOTA_TELEMETRY_OTLP_HEADERS_HELPER', 'ROBOTA_TELEMETRY_HEADERS', 'ROBOTA_TELEMETRY_OTLP_TRACE_HEADERS']) {
      const error = startupError({ ...base, [name]: SENTINEL_VALUE });
      expect(error.message).toMatch(/headers are not supported/u);
      expect(error.message).toContain(name);
      expect(error.message).not.toContain(SENTINEL_VALUE);
    }
  });
});

describe('destination-scoped OTLP header rules', () => {
  it('refuses generic headers that no OTLP signal would send', () => {
    for (const env of [
      { ...base, ROBOTA_TELEMETRY_TRACES: 'console', [GENERIC]: `${SENTINEL_NAME}=${SENTINEL_VALUE}` },
      {
        ...base, [GENERIC]: `${SENTINEL_NAME}=${SENTINEL_VALUE}`,
        ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
        ROBOTA_TELEMETRY_OTLP_TRACES_HEADERS: 'x-own=1',
      },
    ]) {
      const error = startupError(env);
      expect(error.message).toContain(GENERIC);
      expectSecretFree(error.message, `${SENTINEL_NAME}=${SENTINEL_VALUE}`);
    }
  });

  it('refuses a signal\'s headers when that signal does not export over OTLP', () => {
    for (const selector of [undefined, 'off', 'console']) {
      const env: Record<string, string> = {
        ...base, ROBOTA_TELEMETRY_OTLP_METRICS_HEADERS: `${SENTINEL_NAME}=${SENTINEL_VALUE}`,
      };
      if (selector) env['ROBOTA_TELEMETRY_METRICS'] = selector;
      const error = startupError(env);
      expect(error.message).toContain('ROBOTA_TELEMETRY_OTLP_METRICS_HEADERS');
      expectSecretFree(error.message, env['ROBOTA_TELEMETRY_OTLP_METRICS_HEADERS']!);
    }
  });

  it('refuses a per-signal endpoint left without headers while generic headers are in use', () => {
    const error = startupError({
      ...base, [GENERIC]: `${SENTINEL_NAME}=${SENTINEL_VALUE}`,
      ROBOTA_TELEMETRY_METRICS: 'otlp',
      ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics',
    });
    expect(error.message).toContain('ROBOTA_TELEMETRY_OTLP_METRICS_HEADERS');
    expectSecretFree(error.message, `${SENTINEL_NAME}=${SENTINEL_VALUE}`);
  });

  it('refuses merged headers over the size limit', () => {
    const error = startupError({
      ...base,
      [GENERIC]: `x-a=${'a'.repeat(3000)},x-b=${'b'.repeat(3000)}`,
      ROBOTA_TELEMETRY_OTLP_TRACES_HEADERS: `x-c=${'c'.repeat(3000)}`,
    });
    expect(error.message).toMatch(/ROBOTA_TELEMETRY_OTLP_(TRACES_)?HEADERS/u);
    expect(error.message).not.toContain('aaaa');
  });

  it('merges generic and signal headers with the signal winning, and never sends generic headers to a per-signal endpoint', async () => {
    await withCollector(async (url, requests) => {
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        ROBOTA_TELEMETRY_TRACES: 'otlp', ROBOTA_TELEMETRY_METRICS: 'otlp', ROBOTA_TELEMETRY_LOGS: 'otlp',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: url,
        [GENERIC]: `Authorization=Bearer%20generic-token,x-generic=${SENTINEL_VALUE}`,
        ROBOTA_TELEMETRY_OTLP_TRACES_HEADERS: 'authorization=Bearer%20trace-token',
        ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: `${url}/custom/logs`,
        ROBOTA_TELEMETRY_OTLP_LOGS_HEADERS: 'x-logs-only=l1',
      });
      port!.enqueue(batch);
      await port!.shutdown();
      const byPath = new Map(requests.map((request) => [request.path, request]));
      expect([...byPath.keys()].sort()).toEqual(['/custom/logs', '/v1/metrics', '/v1/traces']);
      const traces = byPath.get('/v1/traces')!;
      expect(headerCount(traces, 'authorization')).toBe(1);
      expect(traces.headers['authorization']).toBe('Bearer trace-token');
      expect(traces.headers['x-generic']).toBe(SENTINEL_VALUE);
      const metrics = byPath.get('/v1/metrics')!;
      expect(metrics.headers['authorization']).toBe('Bearer generic-token');
      expect(metrics.headers['x-generic']).toBe(SENTINEL_VALUE);
      const logs = byPath.get('/custom/logs')!;
      expect(logs.headers['authorization']).toBeUndefined();
      expect(logs.headers['x-generic']).toBeUndefined();
      expect(logs.headers['x-logs-only']).toBe('l1');
      expect(metrics.headers['x-logs-only']).toBeUndefined();
      for (const request of requests) {
        expect(headerCount(request, 'content-type')).toBe(1);
        expect(request.headers['content-type']).toBe('application/x-protobuf');
        expect(request.body).not.toContain(SENTINEL_VALUE);
        expect(request.body).not.toContain('generic-token');
        expect(request.body).not.toContain('trace-token');
      }
    });
  });

  it('keeps each sender\'s protobuf content type even when prebuilt headers try to override it', async () => {
    await withCollector(async (url, requests) => {
      const headers = new Headers({ 'content-type': 'text/plain', 'x-static': 's1' });
      const trace = createNodeOtlpLiveTracePort({ endpoint: `${url}/v1/traces`, headers });
      const metric = createNodeOtlpLiveMetricPort(`${url}/v1/metrics`, undefined, undefined, headers);
      const log = createNodeOtlpLiveLogPort(`${url}/v1/logs`, undefined, undefined, headers);
      for (const port of [trace, metric, log]) port.enqueue(batch);
      await Promise.all([trace.shutdown(), metric.shutdown(), log.shutdown()]);
      expect(requests.map((request) => request.path).sort()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
      for (const request of requests) {
        expect(headerCount(request, 'content-type')).toBe(1);
        expect(request.headers['content-type']).toBe('application/x-protobuf');
        expect(request.headers['x-static']).toBe('s1');
      }
    });
  });

  it('never lets a rejected delivery carry a header value to the failure callback or stderr', async () => {
    const calls: Array<{ url: string; headers: Headers; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), redirect: init.redirect });
      throw new Error(`connect failed with ${SENTINEL_NAME}: ${SENTINEL_VALUE}`);
    }));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const failures: unknown[] = [];
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
      ROBOTA_TELEMETRY_TRACES: 'otlp', ROBOTA_TELEMETRY_METRICS: 'otlp', ROBOTA_TELEMETRY_LOGS: 'otlp',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example',
      [GENERIC]: `${SENTINEL_NAME}=${SENTINEL_VALUE}`,
    }, (...args) => { failures.push(args); });
    port!.enqueue(batch);
    await port!.shutdown();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.headers.get(SENTINEL_NAME)).toBe(SENTINEL_VALUE);
      expect(call.headers.get('content-type')).toBe('application/x-protobuf');
      expect(call.redirect).toBe('error');
    }
    expect(failures).toEqual([['delivery-failed'], ['delivery-failed'], ['delivery-failed']]);
    const written = stderr.mock.calls.map(([text]) => String(text)).join('');
    expect(written).not.toContain(SENTINEL_VALUE);
    expect(written).not.toContain(SENTINEL_NAME);
  });

  it('never writes header names or values to console output', async () => {
    const lines: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(SENTINEL_VALUE); }));
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...base, ROBOTA_TELEMETRY_METRICS: 'console', ROBOTA_TELEMETRY_LOGS: 'console',
      [GENERIC]: `${SENTINEL_NAME}=${SENTINEL_VALUE}`,
    }, () => undefined, (line) => { lines.push(line); });
    port!.enqueue(batch);
    await port!.shutdown();
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain(SENTINEL_NAME);
      expect(line).not.toContain(SENTINEL_VALUE);
    }
  });
});
