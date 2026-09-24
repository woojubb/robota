import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { createConfiguredNodeOtlpLiveTelemetryPort, createNodeOtlpLiveTracePort, resolveNodeOtlpLiveTraceEndpoint } from '../live-trace-otlp.js';

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const ROOT_ID = '1234567890abcdef';
const CHILD_ID = 'abcdef1234567890';

/**
 * A minimal protobuf decoder for asserting span identity — this package has no public deserializer
 * for an ExportTraceServiceRequest (only for a collector's response), so this reads exactly the wire
 * types OTLP traces use (varint, length-delimited) to recover span names and integer attributes.
 */
function readVarint(buf: Buffer, pos: number): [value: number, next: number] {
  let result = 0, shift = 0, cursor = pos, byte: number;
  do {
    byte = buf[cursor++]!;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, cursor];
}

function decodeFields(buf: Buffer): Map<number, Array<Buffer | number>> {
  const fields = new Map<number, Array<Buffer | number>>();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    let value: Buffer | number;
    if (wireType === 0) { const [v, next] = readVarint(buf, afterTag); value = v; pos = next; }
    else if (wireType === 2) {
      const [len, next] = readVarint(buf, afterTag);
      value = buf.subarray(next, next + len);
      pos = next + len;
    } else if (wireType === 1) { value = 0; pos = afterTag + 8; }
    else if (wireType === 5) { value = 0; pos = afterTag + 4; }
    else throw new Error(`Unsupported OTLP wire type ${wireType}`);
    if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
    fields.get(fieldNumber)!.push(value);
  }
  return fields;
}

interface IDecodedSpan {
  name: string;
  attributes: Map<string, number | string>;
}

function decodeExportedSpans(body: Buffer): IDecodedSpan[] {
  const spans: IDecodedSpan[] = [];
  const request = decodeFields(body);
  for (const resourceSpans of (request.get(1) ?? []) as Buffer[]) {
    const rsFields = decodeFields(resourceSpans);
    for (const scopeSpans of (rsFields.get(2) ?? []) as Buffer[]) {
      const ssFields = decodeFields(scopeSpans);
      for (const spanBytes of (ssFields.get(2) ?? []) as Buffer[]) {
        const spanFields = decodeFields(spanBytes);
        const name = (spanFields.get(5)?.[0] as Buffer | undefined)?.toString('utf8') ?? '';
        const attributes = new Map<string, number | string>();
        for (const kv of (spanFields.get(9) ?? []) as Buffer[]) {
          const kvFields = decodeFields(kv);
          const key = (kvFields.get(1)?.[0] as Buffer | undefined)?.toString('utf8');
          const anyValue = kvFields.get(2)?.[0] as Buffer | undefined;
          if (!key || !anyValue) continue;
          const anyFields = decodeFields(anyValue);
          const intValue = anyFields.get(3)?.[0];
          const stringValue = anyFields.get(1)?.[0] as Buffer | undefined;
          if (typeof intValue === 'number') attributes.set(key, intValue);
          else if (stringValue) attributes.set(key, stringValue.toString('utf8'));
        }
        spans.push({ name, attributes });
      }
    }
  }
  return spans;
}

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
    omittedChildren: { provider: 0, tool: 0, permission: 0 },
  };
}

describe('Node live OTLP trace export', () => {
  it('exports an explicitly selected live metric signal without enabling traces', async () => {
    const requests: Array<{ path: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
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
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'otlp',
        ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      });
      expect(port).toBeDefined();
      const providerChild = batch().children[0] as unknown as { kind: 'provider'; trace: Record<string, unknown> };
      port!.enqueue({ ...batch(), children: [{ ...providerChild, trace: {
        ...providerChild.trace, modelId: 'gpt-4o',
      } }] } as unknown as ILivePromptTraceBatch);
      await port!.shutdown();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.path).toBe('/v1/metrics');
      expect(requests[0]!.body.toString('utf8')).toContain('robota.provider.estimated_cost_usd');
      expect(requests[0]!.body.toString('utf8')).not.toContain('session.1');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('turns an explicitly enabled CLI host setting into an actual live prompt export', async () => {
    const temporaryHome = mkdtempSync(join(tmpdir(), 'robota-live-trace-'));
    vi.stubEnv('HOME', temporaryHome);
    let requests = 0;
    const server = createServer(async (request, response) => {
      requests += 1;
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const env = {
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
        ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      };
      expect(createConfiguredNodeOtlpLiveTelemetryPort({ ...env, ROBOTA_TELEMETRY_ENABLED: '0' })).toBeUndefined();
      const port = createConfiguredNodeOtlpLiveTelemetryPort(env);
      expect(port).toBeDefined();
      const history: unknown[] = [];
      const session = new InteractiveSession({
        session: {
          run: vi.fn(async () => 'private response'),
          abort: vi.fn(), getHistory: () => history,
          getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 100 }),
          getPermissionMode: () => 'default', getProviderId: () => 'test-provider',
          getModelId: () => 'test-model',
          getEventService: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
          getSessionId: () => 'session.1', getSystemMessage: () => '',
          getToolSchemas: () => [], getMessageCount: () => 0,
          getSessionAllowedTools: () => [],
        } as never,
        cwd: temporaryHome, livePromptTrace: port,
      });
      await session.submit('private prompt');
      await port!.shutdown();
      expect(requests).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(temporaryHome, { recursive: true, force: true });
    }
  });

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
    const foreignTraceId = 'fedcba9876543210fedcba9876543210';
    const active = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: foreignTraceId, spanId: '1111111111111111', traceFlags: TraceFlags.SAMPLED,
    });
    const activeSpy = vi.spyOn(context, 'active').mockReturnValue(active);
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
      expect(requests[0]!.body.includes(Buffer.from(foreignTraceId, 'hex'))).toBe(false);
      expect(requests[0]!.body.includes(Buffer.from(ROOT_ID, 'hex'))).toBe(true);
      expect(requests[0]!.body.includes(Buffer.from(CHILD_ID, 'hex'))).toBe(true);
      expect(requests[0]!.body.toString('utf8')).not.toMatch(/private prompt|private response/);
    } finally {
      activeSpy.mockRestore();
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exports exactly the root and tool spans, never one named after a spanless permission decision', async () => {
    const requests: Buffer[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(Buffer.concat(chunks));
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
      const input: ILivePromptTraceBatch = {
        ...batch(),
        children: [
          { kind: 'tool', trace: {
            traceId: TRACE_ID, parentSpanId: ROOT_ID, spanId: CHILD_ID,
            startedAt: '2026-09-24T00:00:00.500Z', endedAt: '2026-09-24T00:00:01.500Z',
            outcome: 'success', toolCallId: 'call-123',
          } },
          { kind: 'permission', decision: {
            traceId: TRACE_ID, parentSpanId: ROOT_ID,
            decidedAt: '2026-09-24T00:00:00.600Z', decision: 'allowed', toolCallId: 'call-123',
          } },
        ],
        omittedChildren: { provider: 0, tool: 0, permission: 1 },
      };
      port.enqueue(input);
      await port.shutdown();
      expect(onFailure).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      const spans = decodeExportedSpans(requests[0]!);
      expect(spans.map((span) => span.name).sort()).toEqual(['robota.prompt_execution', 'robota.tool_body']);
      expect(spans.some((span) => span.name.includes('permission'))).toBe(false);
      const root = spans.find((span) => span.name === 'robota.prompt_execution')!;
      expect(root.attributes.get('robota.omitted.permission_count')).toBe(1);
    } finally {
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

  it('rejects HTTP 200 without the required protobuf response type, even with an empty body', async () => {
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200);
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
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('accepts a collector warning with zero rejected spans and continues queued delivery', async () => {
    let requestCount = 0;
    const server = createServer(async (request, response) => {
      requestCount += 1;
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      // partial_success.error_message = "warning", rejected_spans absent (zero).
      response.end(Buffer.from([0x0a, 0x09, 0x12, 0x07, ...Buffer.from('warning')]));
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
      port.enqueue(batch());
      await port.shutdown();
      expect(onFailure).not.toHaveBeenCalled();
      expect(requestCount).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
