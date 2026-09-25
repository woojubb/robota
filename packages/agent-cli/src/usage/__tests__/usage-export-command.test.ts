import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { executeUsageExportCommand } from '../usage-export-command.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

function record(): IInteractiveSessionRecord {
  const usage = {
    kind: 'exact' as const,
    scope: 'turn' as const,
    totalTokens: 9,
    promptTokens: 7,
    completionTokens: 2,
    contextUsedTokens: 9,
    contextMaxTokens: 100,
    contextUsedPercentage: 9,
    costStatus: 'exact' as const,
    costUsd: 0.02,
  };
  return {
    id: 'sess-1',
    cwd: '/secret/workspace',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:01:00.000Z',
    messages: [],
    history: [
      {
        id: 'canonical',
        timestamp: new Date('2026-09-24T00:01:00.000Z'),
        category: 'event',
        type: 'usage-observation',
        data: {
          usageObservationId: 'turn-1',
          turnId: 'turn-1',
          outcome: 'success',
          promptExecutionStartedAt: '2026-09-24T00:00:59.000Z',
          promptExecutionEndedAt: '2026-09-24T00:01:00.000Z',
          promptExecutionOutcome: 'success',
          promptExecutionTraceId: '1234567890abcdef1234567890abcdef',
          promptExecutionSpanId: '1234567890abcdef',
          providerId: 'openai',
          source: { scope: 'background', label: 'secret task title' },
          usage,
        },
      },
      {
        id: 'legacy-mirror',
        timestamp: new Date('2026-09-24T00:01:00.000Z'),
        category: 'event',
        type: 'usage-summary',
        data: usage,
      },
    ],
  };
}

function store(): IInteractiveSessionStore {
  return {
    list: () => [{ id: 'sess-1', outcome: { status: 'valid', record: record() } }],
    load: () => ({ status: 'missing' }),
    save: () => undefined,
    delete: () => undefined,
  };
}

describe('explicit OTLP usage snapshot export', () => {
  it('sends accepted provider-call payloads to a real loopback collector and reports partial rejection', async () => {
    const session = record();
    session.history!.push({
      id: 'provider', timestamp: new Date('2026-09-24T00:00:59.900Z'), category: 'event', type: 'provider-call-trace',
      data: {
        traceId: '1234567890abcdef1234567890abcdef', parentSpanId: '1234567890abcdef', spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z', endedAt: '2026-09-24T00:00:59.900Z', outcome: 'success', round: 1,
        disposition: 'invoked', usageProvenance: 'complete', providerId: 'secret-provider', modelId: 'gpt-4o',
        promptTokens: 7, completionTokens: 2, totalTokens: 9,
      },
    });
    const userSessionStore: IInteractiveSessionStore = {
      ...store(), list: () => [{ id: session.id, outcome: { status: 'valid', record: session } }],
    };
    const requests: Array<{ path: string; body: string }> = [];
    const collector = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.url === '/v1/metrics'
        ? JSON.stringify({ partialSuccess: { rejectedDataPoints: '1' } }) : '{}');
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP collector');
      const endpoint = `http://127.0.0.1:${address.port}`;
      const traces = await executeUsageExportCommand(['--signal', 'traces', '--endpoint', endpoint], { userSessionStore, version: 'test' });
      const metrics = await executeUsageExportCommand(['--signal', 'metrics', '--endpoint', endpoint], { userSessionStore, version: 'test' });
      expect(traces.exitCode).toBe(0);
      expect(metrics.exitCode).toBe(1);
      expect(metrics.stderr).toMatch(/rejected/);
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces', '/v1/metrics']);
      const traceBody = JSON.parse(requests[0]!.body);
      expect(traceBody.resourceSpans[0].scopeSpans[0].spans[1].attributes).toContainEqual({ key: 'robota.provider.usage.input_tokens', value: { intValue: '7' } });
      expect(requests[0]!.body).not.toMatch(/secret|gpt-4o|turn-1/);
      const metricBody = JSON.parse(requests[1]!.body);
      expect(metricBody.resourceMetrics[0].scopeMetrics[0].metrics).toContainEqual(expect.objectContaining({ name: 'robota.provider_call.count' }));
    } finally {
      await new Promise<void>((resolve, reject) => collector.close((error) => error ? reject(error) : resolve()));
    }
  });
  it('sends only a content-free prompt root span when traces are explicitly selected', async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      { userSessionStore: store(), fetcher, version: 'test-version' },
    );

    expect(result.exitCode).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:4318/v1/traces');
    const payload = JSON.parse(init!.body as string);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span).toMatchObject({
      name: 'robota.prompt_execution',
      kind: 1,
      traceId: '1234567890abcdef1234567890abcdef',
      spanId: '1234567890abcdef',
      startTimeUnixNano: '1790208059000000000',
      endTimeUnixNano: '1790208060000000000',
      status: { code: 1 },
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|sess-1|turn-1|openai/);
    expect(result.stdout).toMatch(/1 prompt root trace/);
  });

  it('sends only verified content-free completion events when logs are explicitly selected', async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await executeUsageExportCommand(
      ['--signal', 'logs', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: store(),
        fetcher,
        version: 'test-version',
        now: new Date('2026-09-24T00:05:00.000Z'),
      },
    );
    expect(result.exitCode).toBe(0);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:4318/v1/logs');
    const body = JSON.parse(init!.body as string);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toMatchObject([
      {
        eventName: 'robota.prompt_execution.completed',
        severityNumber: 9,
        traceId: '1234567890abcdef1234567890abcdef',
        spanId: '1234567890abcdef',
        observedTimeUnixNano: '1790208300000000000',
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secret|sess-1|turn-1|openai|usageObservationId/);
    expect(result.stdout).toMatch(/1 completion event/);
  });

  it('treats an OTLP log partial rejection as a failed export', async () => {
    const result = await executeUsageExportCommand(
      ['--signal', 'logs', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: store(),
        fetcher: vi.fn(
          async () =>
            new Response(JSON.stringify({ partialSuccess: { rejectedLogRecords: '1' } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/reject/i);
  });

  it('does not misread an underflowed log rejection as full success', async () => {
    const result = await executeUsageExportCommand(
      ['--signal', 'logs', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: store(),
        fetcher: vi.fn(
          async () =>
            new Response(JSON.stringify({ partialSuccess: { rejectedLogRecords: '1e-9999' } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/reject/i);
  });

  it('reports excluded child coverage for a mixed valid completion-event snapshot', async () => {
    const session = record();
    session.history!.push({
      id: 'orphan-child',
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'tool-body-trace',
      data: {
        traceId: '1234567890abcdef1234567890abcdef',
        parentSpanId: 'ffffffffffffffff',
        spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'success',
      },
    });
    const result = await executeUsageExportCommand(
      ['--signal', 'logs', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: {
          ...store(),
          list: () => [{ id: session.id, outcome: { status: 'valid', record: session } }],
        },
        fetcher: vi.fn(
          async () =>
            new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/tool children exported 0, invalid 0, orphaned 1, duplicate 0/);
  });

  it('reports excluded children when no valid completion event can be exported', async () => {
    const session = record();
    delete (session.history![0]!.data as Record<string, unknown>)['promptExecutionSpanId'];
    session.history!.push({
      id: 'orphan-child',
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'tool-body-trace',
      data: {
        traceId: '1234567890abcdef1234567890abcdef',
        parentSpanId: '1234567890abcdef',
        spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'success',
      },
    });
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(
      ['--signal', 'logs', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: {
          ...store(),
          list: () => [{ id: session.id, outcome: { status: 'valid', record: session } }],
        },
        fetcher,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/tool children invalid 0, orphaned 1, duplicate 0/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a recorded provider child with its verified parent and reports child coverage', async () => {
    const session = record();
    session.history!.push({
      id: 'provider-child',
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'provider-call-trace',
      data: {
        traceId: '1234567890abcdef1234567890abcdef',
        parentSpanId: '1234567890abcdef',
        spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'success',
        round: 1,
        content: 'secret result',
      },
    });
    session.history!.push({
      id: 'tool-child',
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'tool-body-trace',
      data: {
        traceId: '1234567890abcdef1234567890abcdef',
        parentSpanId: '1234567890abcdef',
        spanId: 'fedcba0987654321',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'failure',
        content: 'secret tool output',
      },
    });
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: {
          ...store(),
          list: () => [{ id: session.id, outcome: { status: 'valid', record: session } }],
        },
        fetcher,
      },
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.stringify(JSON.parse(fetcher.mock.calls[0]![1]?.body as string));
    expect(body).toContain('"parentSpanId":"1234567890abcdef"');
    expect(body).not.toContain('secret result');
    expect(body).not.toContain('secret tool output');
    expect(result.stdout).toMatch(/1 provider child span/);
    expect(result.stdout).toMatch(/1 tool child span/);
  });

  it('refuses trace export without any valid root before contacting the collector', async () => {
    const old = record();
    const data = old.history![0]!.data as Record<string, unknown>;
    for (const key of [
      'promptExecutionStartedAt',
      'promptExecutionEndedAt',
      'promptExecutionOutcome',
      'promptExecutionTraceId',
      'promptExecutionSpanId',
    ]) {
      delete data[key];
    }
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: {
          ...store(),
          list: () => [{ id: old.id, outcome: { status: 'valid', record: old } }],
        },
        fetcher,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/No valid prompt root traces.*missing 1, invalid 0, duplicate 0/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { partialSuccess: { rejectedSpans: '1' } },
    { partialSuccess: { rejectedSpans: '0', errorMessage: 'warning' } },
    { partialSuccess: { rejectedSpans: '' } },
    { partialSuccess: { rejectedSpans: '   ' } },
    { partialSuccess: { rejectedSpans: '0x0' } },
    { partialSuccess: { rejectedSpans: '1e-9999' } },
    { partialSuccess: { rejectedSpans: '-1e-9999' } },
  ])('fails a partial or malformed trace response %j', async (body) => {
    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: store(),
        fetcher: vi.fn(
          async () =>
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/reject/i);
  });

  it('ignores unknown response fields while validating the selected signal count', async () => {
    const response = new Response(
      JSON.stringify({ partialSuccess: { rejectedSpans: '0.0e+20', rejectedDataPoints: '1' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const traces = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      { userSessionStore: store(), fetcher: vi.fn(async () => response) },
    );
    expect(traces.exitCode).toBe(0);

    const metrics = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: store(),
      fetcher: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              partialSuccess: { rejectedDataPoints: '0.0e+20', rejectedSpans: '1' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    expect(metrics.exitCode).toBe(0);
  });

  it.each([
    new Response('failure', { status: 500 }),
    new Response('', { status: 302 }),
    new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response('x'.repeat(64 * 1024 + 1), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ])('fails a bad or oversized trace collector response', async (response) => {
    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      {
        userSessionStore: store(),
        fetcher: vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          expect(init?.redirect).toBe('error');
          expect(init?.signal).toBeDefined();
          return response;
        }),
      },
    );
    expect(result.exitCode).toBe(1);
  });

  it('blocks an oversized trace request before network I/O', async () => {
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(
      ['--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
      { userSessionStore: store(), fetcher, version: 'x'.repeat(8 * 1024 * 1024) },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/size limit/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unsafe trace destinations and malformed signal arguments before reading records', async () => {
    const list = vi.fn(() => []);
    const fetcher = vi.fn();
    for (const argv of [
      ['--signal', 'traces', '--endpoint', 'https://example.com'],
      ['--signal', 'profiles', '--endpoint', 'http://127.0.0.1:4318'],
      ['--signal', 'traces', '--signal', 'traces', '--endpoint', 'http://127.0.0.1:4318'],
    ]) {
      const result = await executeUsageExportCommand(argv, {
        userSessionStore: { ...store(), list },
        fetcher,
      });
      expect(result.exitCode).toBe(1);
    }
    expect(list).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts one content-free gauge snapshot and never double-counts mirrored usage', async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: store(),
      fetcher,
      now: new Date('2026-09-24T01:00:00.000Z'),
    });
    expect(result.exitCode).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:4318/v1/metrics');
    const payload = JSON.parse(init!.body as string);
    const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
    const value = (name: string) =>
      metrics.find((metric: { name: string }) => metric.name === name)?.gauge.dataPoints[0]
        .asDouble;
    expect(value('robota.session.count')).toBe(1);
    expect(value('robota.turn.count')).toBe(1);
    expect(value('robota.token.total')).toBe(9);
    expect(value('robota.cost.usd.known')).toBe(0.02);
    expect(JSON.stringify(payload)).not.toMatch(/secret|sess-1|turn-1|openai/);
  });

  it.each([
    'https://example.com',
    'http://localhost:4318',
    'http://127.0.0.2:4318',
    'http://user:password@127.0.0.1:4318',
    'http://127.0.0.1:4318/?token=secret',
    'http://127.0.0.1:4318/other',
  ])('rejects non-allowlisted target %s before reading records', async (endpoint) => {
    const list = vi.fn(() => []);
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(['--endpoint', endpoint], {
      userSessionStore: { ...store(), list },
      fetcher,
    });
    expect(result.exitCode).toBe(1);
    expect(list).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an incomplete store rather than exporting a misleading total', async () => {
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: {
        ...store(),
        list: () => [
          { id: 'sess-1', outcome: { status: 'valid', record: record() } },
          { id: 'broken', outcome: { status: 'corrupt', issues: [] } },
        ],
      },
      fetcher,
    });
    expect(result.exitCode).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats HTTP 200 partial rejection as an export failure', async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(JSON.stringify({ partialSuccess: { rejectedDataPoints: '1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: store(),
      fetcher,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/reject/i);
  });

  it.each(['1e-9999', '-1e-9999'])(
    'rejects an underflowed metric rejection count %s',
    async (rejectedDataPoints) => {
      const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
        userSessionStore: store(),
        fetcher: vi.fn(
          async () =>
            new Response(JSON.stringify({ partialSuccess: { rejectedDataPoints } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      });
      expect(result.exitCode).toBe(1);
    },
  );

  it('fails closed on redirects and an invalid OTLP response', async () => {
    const redirect = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      return new Response('', { status: 302 });
    });
    const redirected = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: store(),
      fetcher: redirect,
    });
    expect(redirected.exitCode).toBe(1);

    const malformed = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      userSessionStore: store(),
      fetcher: vi.fn(async () => new Response('not JSON', { status: 200 })),
    });
    expect(malformed.exitCode).toBe(1);
  });

  it.each(['', '[]', '{"partialSuccess":[]}'])(
    'rejects a malformed HTTP 200 OTLP body %j',
    async (body) => {
      const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
        userSessionStore: store(),
        fetcher: vi.fn(
          async () =>
            new Response(body, {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      });
      expect(result.exitCode).toBe(1);
    },
  );
});
