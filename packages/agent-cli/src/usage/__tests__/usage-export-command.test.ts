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
