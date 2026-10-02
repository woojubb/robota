import { createServer } from 'node:http';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';
import { resolveLiveTelemetrySurface } from '../live-resource.js';

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

describe('Node live telemetry resource identity', () => {
  it('labels the actual dispatch mode when a goal value is empty', () => {
    expect(resolveLiveTelemetrySurface({ printMode: false, goal: '', serve: true }, false)).toBe('serve');
    expect(resolveLiveTelemetrySurface({ printMode: false, goal: '', serve: false }, false)).toBe('interactive');
    expect(resolveLiveTelemetrySurface({ printMode: true, goal: '', serve: true }, false)).toBe('print');
  });

  it('uses one explicit, bounded host identity across all three OTLP signals', async () => {
    vi.stubEnv('OTEL_SERVICE_NAME', 'ambient-secret');
    const requests: Array<{ path: string; text: string }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url ?? '', text: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        PRODUCT_TELEMETRY_ENABLED: '1',
        PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_METRICS: 'otlp',
        PRODUCT_TELEMETRY_LOGS: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        PRODUCT_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      }, undefined, undefined, {
        telemetryServiceName: 'test-service', serviceVersion: '3.0.0-test', surface: 'print',
      });
      port!.enqueue(batch);
      await port!.shutdown();
      expect(requests.map((request) => request.path).sort()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
      for (const request of requests) {
        expect(request.text).toContain('service.version');
        expect(request.text).toContain('3.0.0-test');
        expect(request.text).toContain('service.name');
        expect(request.text).toContain('test-service');
        expect(request.text).toContain('agent.surface');
        expect(request.text).toContain('print');
        expect(request.text).not.toContain('ambient-secret');
        if (request.path === '/v1/metrics') expect(request.text).not.toContain('call-123');
        else {
          expect(request.text).toContain('agent.tool.call_id');
          expect(request.text).toContain('call-123');
        }
      }
      const ids = requests.map((request) => request.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u)?.[0]);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/u);
      expect(new Set(ids).size).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('carries an invoked provider call\'s request ID over OTLP traces and logs, never metrics', async () => {
    const providerBatch: ILivePromptTraceBatch = {
      ...batch,
      children: [{ kind: 'provider', trace: {
        traceId: '1234567890abcdef1234567890abcdef', parentSpanId: '1234567890abcdef',
        spanId: 'abcdef1234567890', startedAt: '2026-09-24T00:00:00.100Z',
        endedAt: '2026-09-24T00:00:00.900Z', outcome: 'success', round: 1,
        disposition: 'invoked', providerRequestId: 'req_abc123',
      } }],
    };
    const requests: Array<{ path: string; text: string }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url ?? '', text: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        PRODUCT_TELEMETRY_ENABLED: '1',
        PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_METRICS: 'otlp',
        PRODUCT_TELEMETRY_LOGS: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        PRODUCT_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      }, undefined, undefined, {
        telemetryServiceName: 'test-service', serviceVersion: '3.0.0-test', surface: 'print',
      });
      port!.enqueue(providerBatch);
      await port!.shutdown();
      for (const request of requests) {
        if (request.path === '/v1/metrics') expect(request.text).not.toContain('req_abc123');
        else {
          expect(request.text).toContain('agent.provider.request_id');
          expect(request.text).toContain('req_abc123');
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('shows the same safe resource fields in console and rejects unsafe host fields', async () => {
    const lines: string[] = [];
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'console',
    }, undefined, (line) => { lines.push(line); }, {
      telemetryServiceName: 'fixture-service', serviceVersion: '3.0.0-test', surface: 'interactive',
    });
    port!.enqueue(batch);
    await port!.shutdown();
    expect(JSON.parse(lines[0]!).resource).toMatchObject({
      'service.name': 'fixture-service', 'service.version': '3.0.0-test',
      'agent.surface': 'interactive',
    });
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'console',
    }, undefined, undefined, {
      telemetryServiceName: 'test-service', serviceVersion: 'private\nvalue', surface: 'interactive',
    }))
      .toThrow(/resource/i);
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'console',
    }, undefined, undefined, {
      telemetryServiceName: 'test-service', serviceVersion: '3.0.0', surface: 'private' as never,
    }))
      .toThrow(/resource/i);
    const extra: string[] = [];
    const allowlisted = createConfiguredNodeOtlpLiveTelemetryPort({
      PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOGS: 'console',
    }, undefined, (line) => { extra.push(line); }, {
      telemetryServiceName: 'trusted-service', serviceVersion: '3.0.0', surface: 'print',
      'service.name': 'untrusted',
    } as never);
    allowlisted!.enqueue(batch);
    await allowlisted!.shutdown();
    expect(JSON.parse(extra[0]!).resource['service.name']).toBe('trusted-service');
    expect(extra[0]).not.toContain('untrusted');
  });
});
