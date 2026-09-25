import { describe, expect, it } from 'vitest';

import { randomId } from './random-id';
import {
  buildTraceparent,
  outboundTraceContextFor,
  providerCallSpanId,
  spanIdFromMintedId,
  toolTraceContextFor,
  traceHeadersFor,
} from './trace-context';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('providerCallSpanId', () => {
  it('is the span ID the exported provider-call child has always carried', () => {
    for (let i = 0; i < 50; i += 1) {
      const callId = randomId();
      expect(providerCallSpanId(callId)).toBe(callId.replaceAll('-', '').slice(0, 16));
      expect(providerCallSpanId(callId)).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('spanIdFromMintedId', () => {
  it('is the same derivation under its general name, so provider and tool spans share it', () => {
    for (let i = 0; i < 20; i += 1) {
      const id = randomId();
      expect(spanIdFromMintedId(id)).toBe(providerCallSpanId(id));
      expect(spanIdFromMintedId(id)).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('toolTraceContextFor', () => {
  const run = { traceId: TRACE_ID, parentSpanId: 'b7ad6b7169203331', allowedOrigins: ['https://mcp.example.com'] };

  it('names the tool body span minted for this body as the parent', () => {
    const toolBodyId = randomId();
    expect(toolTraceContextFor(run, toolBodyId)).toEqual({
      traceparent: `00-${TRACE_ID}-${spanIdFromMintedId(toolBodyId)}-01`,
      allowedOrigins: ['https://mcp.example.com'],
    });
  });

  it('has nothing to send without an allowlist or a valid trace', () => {
    expect(toolTraceContextFor({ ...run, allowedOrigins: [] }, randomId())).toBeUndefined();
    expect(toolTraceContextFor({ ...run, traceId: 'bad' }, randomId())).toBeUndefined();
  });
});

describe('buildTraceparent', () => {
  it('builds a sampled version-00 traceparent', () => {
    expect(buildTraceparent(TRACE_ID, '00f067aa0ba902b7')).toBe(`00-${TRACE_ID}-00f067aa0ba902b7-01`);
    expect(buildTraceparent(TRACE_ID, providerCallSpanId(randomId()))).toMatch(TRACEPARENT);
  });

  it('refuses identifiers W3C trace context calls invalid', () => {
    expect(buildTraceparent('0'.repeat(32), '00f067aa0ba902b7')).toBeUndefined();
    expect(buildTraceparent(TRACE_ID, '0'.repeat(16))).toBeUndefined();
    expect(buildTraceparent(TRACE_ID.toUpperCase(), '00f067aa0ba902b7')).toBeUndefined();
    expect(buildTraceparent(TRACE_ID, 'short')).toBeUndefined();
  });
});

describe('traceHeadersFor', () => {
  const ctx = outboundTraceContextFor(
    { traceId: TRACE_ID, parentSpanId: 'b7ad6b7169203331', allowedOrigins: ['https://api.example.com', 'http://127.0.0.1:4318'] },
    '123e4567-e89b-42d3-a456-426614174000',
  );

  it('attaches traceparent when the effective origin is exactly listed', () => {
    expect(ctx).toBeDefined();
    expect(traceHeadersFor('https://api.example.com', ctx)).toEqual({
      traceparent: `00-${TRACE_ID}-123e4567e89b42d3-01`,
    });
    // A base URL with a path still has the listed origin, and the default port is not a mismatch.
    expect(traceHeadersFor('https://api.example.com/v1', ctx)).toHaveProperty('traceparent');
    expect(traceHeadersFor('https://api.example.com:443/', ctx)).toHaveProperty('traceparent');
    expect(traceHeadersFor('http://127.0.0.1:4318/v1', ctx)).toHaveProperty('traceparent');
  });

  it('sends nothing for a scheme, port or subdomain mismatch, or an unlisted origin', () => {
    expect(traceHeadersFor('http://api.example.com', ctx)).toEqual({});
    expect(traceHeadersFor('https://api.example.com:8443', ctx)).toEqual({});
    expect(traceHeadersFor('https://eu.api.example.com', ctx)).toEqual({});
    expect(traceHeadersFor('https://example.com', ctx)).toEqual({});
    expect(traceHeadersFor('http://127.0.0.1:4319', ctx)).toEqual({});
    expect(traceHeadersFor('https://api.openai.com', ctx)).toEqual({});
    expect(traceHeadersFor('not a url', ctx)).toEqual({});
    expect(traceHeadersFor(undefined, ctx)).toEqual({});
    expect(traceHeadersFor('https://api.example.com', undefined)).toEqual({});
  });

  it('has nothing to send without a valid trace or an allowlist', () => {
    expect(outboundTraceContextFor({ traceId: TRACE_ID, parentSpanId: 'b7ad6b7169203331', allowedOrigins: [] }, randomId()))
      .toBeUndefined();
    expect(outboundTraceContextFor({ traceId: 'bad', parentSpanId: 'b7ad6b7169203331', allowedOrigins: ['https://a.example'] }, randomId()))
      .toBeUndefined();
  });
});
