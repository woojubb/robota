import { createServer } from 'node:http';
import { calculateModelCost } from '@robota-sdk/agent-core';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it, vi } from 'vitest';
import { createNodeOtlpLiveMetricPort, projectLivePromptMetrics } from '../live-metric-otlp.js';
import {
  createConfiguredNodeOtlpLiveTelemetryPort,
  resolveNodeOtlpLiveMetricEndpoint,
} from '../live-trace-otlp.js';

const base: ILivePromptTraceBatch = {
  schemaVersion: 1,
  sessionId: 'private-session', turnId: 'private-turn',
  root: {
    traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
    startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:02.000Z',
    outcome: 'success',
  },
  children: [],
  omittedChildren: { provider: 0, tool: 0 },
};

function provider(
  disposition: 'invoked' | 'cache-hit' | 'preflight-refused',
  usageProvenance: 'complete' | 'partial' | 'absent',
  modelId?: string,
): ILivePromptTraceBatch['children'][number] {
  return { kind: 'provider', trace: {
    traceId: base.root.traceId, parentSpanId: base.root.spanId, spanId: 'abcdef1234567890',
    startedAt: base.root.startedAt, endedAt: base.root.endedAt,
    outcome: 'success', round: 1, disposition, usageProvenance,
    ...(modelId ? { modelId } : {}),
    ...(usageProvenance === 'complete' ? {
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
    } : {}),
  } };
}

function value(batch: ILivePromptTraceBatch, name: string): number | undefined {
  const metric = projectLivePromptMetrics(batch).scopeMetrics[0]?.metrics.find(
    (item) => item.descriptor.name === name,
  );
  const point = metric?.dataPoints[0];
  return point && typeof point.value === 'number' ? point.value : undefined;
}

describe('Node live OTLP metrics', () => {
  it('uses per-invocation complete usage and table-estimated cost without charging cache/preflight', () => {
    const batch = { ...base, children: [
      provider('invoked', 'complete', 'gpt-4o'),
      provider('invoked', 'complete', 'unknown-model'),
      provider('invoked', 'partial', 'gpt-4o'),
      provider('cache-hit', 'complete', 'gpt-4o'),
      provider('preflight-refused', 'complete', 'gpt-4o'),
    ] } as ILivePromptTraceBatch;
    expect(value(batch, 'robota.provider.calls')).toBe(3);
    expect(value(batch, 'robota.provider.input_tokens')).toBe(200);
    expect(value(batch, 'robota.provider.output_tokens')).toBe(100);
    expect(value(batch, 'robota.provider.usage_unavailable_calls')).toBe(1);
    expect(value(batch, 'robota.provider.cost_unpriced_calls')).toBe(1);
    expect(value(batch, 'robota.provider.estimated_cost_usd')).toBe(calculateModelCost('gpt-4o', 100, 50));
    const metrics = projectLivePromptMetrics(batch).scopeMetrics[0]!.metrics;
    expect(metrics.every((metric) => metric.dataPoints.every((point) =>
      !Object.hasOwn(point.attributes, 'sessionId') && !Object.hasOwn(point.attributes, 'turnId')))).toBe(true);
    expect(JSON.stringify(metrics)).not.toContain('private-session');
    expect(JSON.stringify(metrics)).not.toContain('unknown-model');
  });

  it('does not misrepresent a truncated child batch as a complete usage or cost total', () => {
    const batch = { ...base, children: [provider('invoked', 'complete', 'gpt-4o')],
      omittedChildren: { provider: 5, tool: 0 } } as ILivePromptTraceBatch;
    expect(value(batch, 'robota.telemetry.provider_events_omitted')).toBe(5);
    expect(value(batch, 'robota.provider.calls')).toBeUndefined();
    expect(value(batch, 'robota.provider.estimated_cost_usd')).toBeUndefined();
  });

  it('requires independent opt-in and resolves metrics-specific destinations', () => {
    expect(resolveNodeOtlpLiveMetricEndpoint({ ROBOTA_TELEMETRY_METRICS: 'otlp' })).toBeUndefined();
    const enabled = {
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
    };
    expect(resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318/prefix',
    })).toBe('http://127.0.0.1:4318/prefix/v1/metrics');
    expect(resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'https://collector.example/custom',
    })).toBe('https://collector.example/custom');
    expect(() => resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'http://collector.example/v1/metrics',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'https://user:secret@collector.example/v1/metrics',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'https://collector.example/v1/traces',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveMetricEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/json',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    })).toThrow(/protocol/i);
  });

  it('sends traces and metrics independently when both are selected', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'authorization=ambient-secret');
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', 'https://ambient.example/v1/metrics');
    const paths: string[] = [];
    const server = createServer(async (request, response) => {
      paths.push(request.url ?? '');
      expect(request.headers['authorization']).toBeUndefined();
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'otlp',
        ROBOTA_TELEMETRY_TRACES: 'otlp', ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      });
      port!.enqueue({ ...base, children: [provider('invoked', 'complete', 'gpt-4o')] });
      await port!.shutdown();
      expect(paths.sort()).toEqual(['/v1/metrics', '/v1/traces']);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports partial collector rejection without failing shutdown or retrying stale work', async () => {
    let requests = 0;
    const server = createServer(async (request, response) => {
      requests += 1;
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      // ExportMetricsServiceResponse.partial_success.rejected_data_points = 1.
      response.end(Buffer.from([0x0a, 0x02, 0x08, 0x01]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const onFailure = vi.fn();
      const port = createNodeOtlpLiveMetricPort(`http://127.0.0.1:${address.port}/v1/metrics`, onFailure);
      const batch = { ...base, children: [provider('invoked', 'complete', 'gpt-4o')] };
      port.enqueue(batch);
      port.enqueue(batch);
      await expect(port.shutdown()).resolves.toBeUndefined();
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
