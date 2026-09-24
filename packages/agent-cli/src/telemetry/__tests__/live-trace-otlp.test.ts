import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { createNodeOtlpLiveTracePort, resolveNodeOtlpLiveTraceEndpoint } from '../live-trace-otlp.js';

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const ROOT_ID = '1234567890abcdef';
const CHILD_ID = 'abcdef1234567890';

function batch(): ILivePromptTraceBatch {
  return {
    schemaVersion: 1,
    sessionId: 'session.1', turnId: 'turn-1',
    root: {
      traceId: TRACE_ID, spanId: ROOT_ID,
      startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:02.000Z',
      outcome: 'success',
    },
    children: [{ kind: 'provider', trace: {
      traceId: TRACE_ID, parentSpanId: ROOT_ID, spanId: CHILD_ID,
      startedAt: '2026-09-24T00:00:00.500Z', endedAt: '2026-09-24T00:00:01.500Z',
      outcome: 'success', round: 1, disposition: 'invoked', providerId: 'safe-provider',
      usageProvenance: 'complete', promptTokens: 2, completionTokens: 3, totalTokens: 5,
    } }],
    omittedChildren: { provider: 0, tool: 0 },
  };
}

describe('Node live OTLP trace export', () => {
  it('requires Robota opt-in, an explicit protocol, and a validated destination', () => {
    expect(resolveNodeOtlpLiveTraceEndpoint({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://ambient.example',
      ROBOTA_TELEMETRY_TRACES: 'otlp',
    })).toBeUndefined();
    expect(() => resolveNodeOtlpLiveTraceEndpoint({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    })).toThrow(/protocol/i);
    expect(() => resolveNodeOtlpLiveTraceEndpoint({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/json',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    })).toThrow(/protocol/i);
    const enabled = {
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
    };
    expect(resolveNodeOtlpLiveTraceEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    })).toBe('http://127.0.0.1:4318/v1/traces');
    expect(resolveNodeOtlpLiveTraceEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'https://collector.example/custom',
    })).toBe('https://collector.example/custom');
    expect(() => resolveNodeOtlpLiveTraceEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'http://collector.example/v1/traces',
    })).toThrow(/destination/i);
    expect(() => resolveNodeOtlpLiveTraceEndpoint({
      ...enabled, ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'https://user:secret@collector.example/v1/traces',
    })).toThrow(/destination/i);
  });

  it('sends one HTTP/protobuf batch with the original linked trace identities and no content', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'authorization=private-secret');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://ambient.example/v1/traces');
    const requests: Array<{ path: string; contentType: string; authorization: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        path: request.url ?? '', contentType: String(request.headers['content-type'] ?? ''),
        authorization: String(request.headers['authorization'] ?? ''),
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const onFailure = vi.fn();
      const port = createNodeOtlpLiveTracePort({
        endpoint: `http://127.0.0.1:${address.port}/v1/traces`, onFailure,
      });
      port.enqueue(batch());
      await port.shutdown();
      expect(onFailure).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        path: '/v1/traces', contentType: 'application/x-protobuf', authorization: '',
      });
      expect(requests[0]!.body.includes(Buffer.from(TRACE_ID, 'hex'))).toBe(true);
      expect(requests[0]!.body.includes(Buffer.from(ROOT_ID, 'hex'))).toBe(true);
      expect(requests[0]!.body.includes(Buffer.from(CHILD_ID, 'hex'))).toBe(true);
      expect(requests[0]!.body.toString('utf8')).not.toMatch(/private prompt|private response/);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports collector failure without throwing from the accepted turn or shutdown', async () => {
    let requestCount = 0;
    const server = createServer(async (request, response) => {
      requestCount += 1;
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(500);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const onFailure = vi.fn();
      const port = createNodeOtlpLiveTracePort({
        endpoint: `http://127.0.0.1:${address.port}/v1/traces`, onFailure,
      });
      expect(() => port.enqueue(batch())).not.toThrow();
      port.enqueue(batch());
      port.enqueue(batch());
      await expect(port.shutdown()).resolves.toBeUndefined();
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
      expect(requestCount).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports a partial OTLP rejection as delivery failure', async () => {
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      // ExportTraceServiceResponse.partial_success.rejected_spans = 1.
      response.end(Buffer.from([0x0a, 0x02, 0x08, 0x01]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const onFailure = vi.fn();
      const port = createNodeOtlpLiveTracePort({
        endpoint: `http://127.0.0.1:${address.port}/v1/traces`, onFailure,
      });
      port.enqueue(batch());
      await port.shutdown();
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
