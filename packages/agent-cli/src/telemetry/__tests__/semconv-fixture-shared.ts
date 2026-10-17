import { createServer } from 'node:http';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { createNodeOtlpLiveTracePort } from '../live-trace-otlp.js';
import type { INodeOtlpLiveTraceOptions } from '../live-trace-otlp.js';

const TRACE = '0af7651916cd43dd8448eb211c80319c';
const ROOT = 'b7ad6b7169203331';

/** One batch exercising every exported span field: timing, omitted counts, usage, IDs, failure. */
export function richBatch(): ILivePromptTraceBatch {
  return {
    schemaVersion: 1, sessionId: 'session.1', turnId: 'turn-1',
    root: { traceId: TRACE, spanId: ROOT, startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:00:03.000Z', outcome: 'failure' },
    timingTotals: {
      provider: { durationMs: 1200, samples: 1, invalid: 0 },
      tool: { durationMs: 300, samples: 1, invalid: 1 },
      queue: { durationMs: 5, samples: 1, invalid: 0, admissionStarted: 1, notDispatched: 0 },
    },
    children: [
      { kind: 'provider', trace: {
        traceId: TRACE, parentSpanId: ROOT, spanId: '1111111111111111', outcome: 'success', round: 1,
        startedAt: '2026-10-17T00:00:00.100Z', endedAt: '2026-10-17T00:00:01.300Z', disposition: 'invoked',
        providerId: 'anthropic', modelId: 'claude-sonnet-4-5', usageProvenance: 'complete',
        promptTokens: 120, completionTokens: 30, totalTokens: 150, providerRequestId: 'req_01',
      } },
      { kind: 'permission', decision: { traceId: TRACE, parentSpanId: ROOT, decidedAt: '2026-10-17T00:00:01.400Z', decision: 'allowed', toolCallId: 'toolu_01' } },
      { kind: 'tool', trace: {
        traceId: TRACE, parentSpanId: ROOT, spanId: '2222222222222222', outcome: 'failure',
        startedAt: '2026-10-17T00:00:01.500Z', endedAt: '2026-10-17T00:00:01.800Z', toolCallId: 'toolu_01', toolName: 'Read',
      } },
      { kind: 'provider', trace: {
        traceId: TRACE, parentSpanId: ROOT, spanId: '3333333333333333', outcome: 'interrupted', round: 2,
        startedAt: '2026-10-17T00:00:01.900Z', endedAt: '2026-10-17T00:00:02.500Z', disposition: 'invoked',
        providerId: 'my-gateway', usageProvenance: 'partial',
      } },
    ],
    omittedChildren: { provider: 1, tool: 0, permission: 2 },
  };
}

export const FIXED_RESOURCE = {
  instanceId: '11111111-2222-4333-8444-555555555555',
  attributes: { 'service.name': 'robota', 'service.instance.id': '11111111-2222-4333-8444-555555555555', 'service.version': '3.0.0', 'agent.surface': 'print' },
};

/** The exact OTLP request body the trace port sends for `batch`. */
export async function exportedBody(batch: ILivePromptTraceBatch,
  extra: Partial<INodeOtlpLiveTraceOptions> = {}): Promise<Buffer> {
  const bodies: Buffer[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks));
    response.writeHead(200, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const port = createNodeOtlpLiveTracePort({ endpoint: `http://127.0.0.1:${address.port}/v1/traces`, resource: FIXED_RESOURCE, ...extra });
    port.enqueue(batch);
    await port.shutdown();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (bodies.length !== 1) throw new Error(`Expected one export, got ${bodies.length}`);
  return bodies[0]!;
}

function readVarint(buf: Buffer, pos: number): [value: number, next: number] {
  let result = 0, shift = 0, cursor = pos, byte: number;
  do {
    byte = buf[cursor++]!;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, cursor];
}

function fields(buf: Buffer): Map<number, Array<Buffer | number>> {
  const out = new Map<number, Array<Buffer | number>>();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    const wireType = tag & 0x7;
    let value: Buffer | number;
    if (wireType === 0) { const [v, next] = readVarint(buf, afterTag); value = v; pos = next; }
    else if (wireType === 2) { const [len, next] = readVarint(buf, afterTag); value = buf.subarray(next, next + len); pos = next + len; }
    else if (wireType === 1) { value = 0; pos = afterTag + 8; }
    else if (wireType === 5) { value = 0; pos = afterTag + 4; }
    else throw new Error(`Unsupported OTLP wire type ${wireType}`);
    out.set(tag >>> 3, [...(out.get(tag >>> 3) ?? []), value]);
  }
  return out;
}

export interface IDecodedSpan {
  readonly name: string;
  /** OTLP span kind: 1 internal, 3 client. */
  readonly kind: number;
  readonly attributes: Record<string, string | number>;
}

/** Spans and each scope's schema URL from an OTLP/protobuf ExportTraceServiceRequest. */
export function decodeTraceExport(body: Buffer): { schemaUrls: string[]; spans: IDecodedSpan[] } {
  const schemaUrls: string[] = [];
  const spans: IDecodedSpan[] = [];
  for (const resourceSpans of (fields(body).get(1) ?? []) as Buffer[]) {
    for (const scopeSpans of (fields(resourceSpans).get(2) ?? []) as Buffer[]) {
      const scope = fields(scopeSpans);
      schemaUrls.push(((scope.get(3)?.[0] as Buffer | undefined)?.toString('utf8')) ?? '');
      for (const spanBytes of (scope.get(2) ?? []) as Buffer[]) {
        const span = fields(spanBytes);
        const attributes: Record<string, string | number> = {};
        for (const kv of (span.get(9) ?? []) as Buffer[]) {
          const pair = fields(kv);
          const key = (pair.get(1)?.[0] as Buffer).toString('utf8');
          const any = fields(pair.get(2)?.[0] as Buffer);
          const int = any.get(3)?.[0];
          attributes[key] = typeof int === 'number' ? int : (any.get(1)?.[0] as Buffer).toString('utf8');
        }
        spans.push({ name: (span.get(5)?.[0] as Buffer).toString('utf8'), kind: (span.get(6)?.[0] as number) ?? 0, attributes });
      }
    }
  }
  return { schemaUrls, spans };
}
