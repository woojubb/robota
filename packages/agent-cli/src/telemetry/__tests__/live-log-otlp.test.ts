import { createServer } from 'node:http';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it, vi } from 'vitest';
import { createNodeOtlpLiveLogPort, projectLivePromptLogs } from '../live-log-otlp.js';
import { createConfiguredNodeOtlpLiveTelemetryPort, resolveNodeOtlpLiveLogEndpoint } from '../live-trace-otlp.js';

const batch: ILivePromptTraceBatch = {
  schemaVersion: 1, sessionId: 'private-session', turnId: 'private-turn',
  root: {
    traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
    startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:02.000Z',
    outcome: 'success',
  },
  children: [], omittedChildren: { provider: 0, tool: 0 },
};

describe('Node live OTLP logs', () => {
  it('exports an independently selected completion log without enabling traces or metrics', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'authorization=ambient-secret');
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'https://ambient.example/v1/logs');
    const requests: Array<{ path: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      expect(request.headers['authorization']).toBeUndefined();
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'otlp',
        ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      });
      expect(port).toBeDefined();
      port!.enqueue(batch);
      await port!.shutdown();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.path).toBe('/v1/logs');
      expect(requests[0]!.body.toString('utf8')).toContain('robota.prompt_execution.completed');
      expect(requests[0]!.body.includes(Buffer.from(batch.root.traceId, 'hex'))).toBe(true);
      expect(requests[0]!.body.includes(Buffer.from(batch.root.spanId, 'hex'))).toBe(true);
      expect(requests[0]!.body.toString('utf8')).not.toContain('private-session');
      expect(requests[0]!.body.toString('utf8')).not.toContain('private-turn');
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('projects only real content-free completion facts with original timestamps and span IDs', () => {
    const provider = (disposition: 'invoked' | 'cache-hit' | 'preflight-refused', spanId: string) => ({
      kind: 'provider' as const,
      trace: {
        traceId: batch.root.traceId, parentSpanId: batch.root.spanId, spanId,
        startedAt: batch.root.startedAt, endedAt: '2026-09-24T00:00:01.000Z',
        outcome: 'failure' as const, round: 1, disposition,
        providerId: 'private-provider', modelId: 'private-model',
      },
    });
    const input: ILivePromptTraceBatch = {
      ...batch,
      root: { ...batch.root, outcome: 'interrupted' },
      children: [
        provider('invoked', '1111111111111111'),
        provider('cache-hit', '2222222222222222'),
        provider('preflight-refused', '3333333333333333'),
        { kind: 'provider', trace: {
          traceId: batch.root.traceId, parentSpanId: batch.root.spanId, spanId: '5555555555555555',
          startedAt: batch.root.startedAt, endedAt: '2026-09-24T00:00:01.000Z',
          outcome: 'success', round: 2,
        } },
        { kind: 'tool', trace: {
          traceId: batch.root.traceId, parentSpanId: batch.root.spanId, spanId: '4444444444444444',
          startedAt: batch.root.startedAt, endedAt: '2026-09-24T00:00:01.500Z',
          outcome: 'success',
        } },
      ],
      omittedChildren: { provider: 2, tool: 1 },
    };
    const records = projectLivePromptLogs(input, new Date('2026-09-24T00:00:03.000Z'));
    expect(records.map((record) => record.eventName)).toEqual([
      'robota.provider_call.completed', 'robota.tool_body.completed',
      'robota.prompt_execution.completed',
    ]);
    expect(records.map((record) => record.severityText)).toEqual(['ERROR', 'INFO', 'WARN']);
    expect(records[0]).toMatchObject({
      hrTime: [1790208001, 0], hrTimeObserved: [1790208003, 0],
      spanContext: { traceId: batch.root.traceId, spanId: '1111111111111111' },
      attributes: { 'robota.provider.outcome': 'failure' },
    });
    expect(records[2]!.attributes).toMatchObject({
      'robota.prompt.outcome': 'interrupted',
      'robota.telemetry.omitted_provider_events': 2,
      'robota.telemetry.omitted_tool_events': 1,
    });
    const text = JSON.stringify(records);
    expect(text).not.toMatch(/private-session|private-turn|private-provider|private-model/);
    expect(records.every((record) => record.body === undefined)).toBe(true);
  });

  it('requires Robota opt-in, an explicit protocol and an independently resolved logs URL', () => {
    expect(resolveNodeOtlpLiveLogEndpoint({ ROBOTA_TELEMETRY_LOGS: 'otlp' })).toBeUndefined();
    const enabled = {
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
    };
    expect(resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318/prefix',
    })).toBe('http://127.0.0.1:4318/prefix/v1/logs');
    expect(resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'https://collector.example/custom',
    })).toBe('https://collector.example/custom');
    expect(() => resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'http://collector.example/v1/logs',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'https://user:secret@collector.example/v1/logs',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'https://collector.example/v1/metrics',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example/v1/traces',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveLogEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/json',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    })).toThrow(/protocol/i);
  });

  it('isolates partial collector rejection and drops queued stale logs', async () => {
    let requests = 0;
    const server = createServer(async (request, response) => {
      requests += 1;
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      // ExportLogsServiceResponse.partial_success.rejected_log_records = 1.
      response.end(Buffer.from([0x0a, 0x02, 0x08, 0x01]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const onFailure = vi.fn();
      const port = createNodeOtlpLiveLogPort(`http://127.0.0.1:${address.port}/v1/logs`, onFailure);
      port.enqueue(batch);
      port.enqueue(batch);
      await expect(port.shutdown()).resolves.toBeUndefined();
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exposes the host failure callback for logs-only queue overflow', () => {
    const onFailure = vi.fn();
    const port = createNodeOtlpLiveLogPort('http://127.0.0.1:9/v1/logs', onFailure);
    expect(port.onFailure).toBe(onFailure);
    port.onFailure?.('enqueue-failed');
    expect(onFailure).toHaveBeenCalledWith('enqueue-failed');
  });
});
