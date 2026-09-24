import { createServer } from 'node:http';
import { ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
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
const metricWindow = {
  instanceId: 'test-instance',
  startTime: [1790208000, 0] as [number, number],
  endTime: [1790208002, 0] as [number, number],
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
  const metric = projectLivePromptMetrics(batch, metricWindow).scopeMetrics[0]?.metrics.find(
    (item) => item.descriptor.name === name,
  );
  const point = metric?.dataPoints[0];
  return point && typeof point.value === 'number' ? point.value : undefined;
}

describe('Node live OTLP metrics', () => {
  it('counts canonical prompt executions and observed tool completions without claiming truncated totals', () => {
    const tool = (spanId: string): ILivePromptTraceBatch['children'][number] => ({
      kind: 'tool', trace: {
        traceId: base.root.traceId, parentSpanId: base.root.spanId, spanId,
        startedAt: base.root.startedAt, endedAt: base.root.endedAt, outcome: 'success',
      },
    });
    const complete = { ...base, children: [tool('1111111111111111'), tool('2222222222222222')] };
    expect(value(complete, 'robota.prompt.executions')).toBe(1);
    expect(value(complete, 'robota.tool.body_completions')).toBe(2);
    const truncated = { ...complete, omittedChildren: { provider: 0, tool: 3 } };
    expect(value(truncated, 'robota.telemetry.tool_events_omitted')).toBe(3);
    expect(value(truncated, 'robota.tool.body_completions')).toBeUndefined();
    expect(value(truncated, 'robota.prompt.executions')).toBe(1);
    expect(value({ ...complete, omittedChildren: { provider: 4, tool: 0 } },
      'robota.tool.body_completions')).toBe(2);
    const metrics = projectLivePromptMetrics(complete, metricWindow).scopeMetrics[0]!.metrics;
    expect(JSON.stringify(metrics)).not.toMatch(/private-session|private-turn/);
  });

  it('exposes the host failure callback for metrics-only queue overflow', () => {
    const onFailure = vi.fn();
    const port = createNodeOtlpLiveMetricPort('http://127.0.0.1:9/v1/metrics', onFailure);
    expect(port.onFailure).toBe(onFailure);
    port.onFailure?.('enqueue-failed');
    expect(onFailure).toHaveBeenCalledWith('enqueue-failed');
  });

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
    const metrics = projectLivePromptMetrics(batch, metricWindow).scopeMetrics[0]!.metrics;
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

  it('retains a verified zero-dollar estimate instead of making its cost look unknown', () => {
    const child = provider('invoked', 'complete', 'gpt-4o');
    if (child.kind !== 'provider') throw new Error('Expected provider child');
    const batch = { ...base, children: [{ kind: 'provider', trace: {
      ...child.trace, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    } }] } as ILivePromptTraceBatch;
    expect(value(batch, 'robota.provider.calls')).toBe(1);
    expect(value(batch, 'robota.provider.estimated_cost_usd')).toBe(0);
  });

  it('gives each exporter a unique writer and successive nonoverlapping delta windows', async () => {
    const serialized: ResourceMetrics[] = [];
    const original = ProtobufMetricsSerializer.serializeRequest;
    const spy = vi.spyOn(ProtobufMetricsSerializer, 'serializeRequest').mockImplementation((metrics) => {
      serialized.push(metrics);
      return original(metrics);
    });
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const endpoint = `http://127.0.0.1:${address.port}/v1/metrics`;
      const first = createNodeOtlpLiveMetricPort(endpoint);
      const turn = { ...base, children: [provider('invoked', 'complete', 'gpt-4o')] };
      first.enqueue(turn);
      first.enqueue(turn);
      await first.shutdown();
      const second = createNodeOtlpLiveMetricPort(endpoint);
      second.enqueue(turn);
      await second.shutdown();
      expect(serialized).toHaveLength(3);
      const points = serialized.map((resource) => resource.scopeMetrics[0]!.metrics[0]!.dataPoints[0]!);
      expect(points[1]!.startTime).toEqual(points[0]!.endTime);
      expect(points[1]!.endTime).not.toEqual(points[0]!.endTime);
      expect(serialized[0]!.resource.attributes['service.instance.id'])
        .toBe(serialized[1]!.resource.attributes['service.instance.id']);
      expect(serialized[0]!.resource.attributes['service.instance.id'])
        .not.toBe(serialized[2]!.resource.attributes['service.instance.id']);
    } finally {
      spy.mockRestore();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
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
