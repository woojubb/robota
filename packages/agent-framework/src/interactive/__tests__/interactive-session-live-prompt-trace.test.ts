import { describe, expect, it, vi } from 'vitest';

import {
  LivePromptTraceAccumulator,
  enqueueLivePromptTrace,
} from '../interactive-session-live-prompt-trace.js';

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const ROOT_SPAN_ID = '0123456789abcdef';
const AT = '2026-09-24T00:00:00.000Z';

function makeAccumulator(): LivePromptTraceAccumulator {
  return new LivePromptTraceAccumulator();
}

function finish(accumulator: LivePromptTraceAccumulator) {
  return accumulator.finish({
    sessionId: 'sess-1', turnId: 'turn-1',
    root: { traceId: TRACE_ID, spanId: ROOT_SPAN_ID, startedAt: AT, endedAt: AT, outcome: 'success' },
  });
}

describe('live prompt trace boundary', () => {
  it('carries safe tool-call correlation and explicitly omits unsafe IDs', () => {
    const accumulator = makeAccumulator();
    const base = {
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'aaaaaaaaaaaaaaaa',
      startedAt: AT, endedAt: AT, outcome: 'success' as const,
    };
    accumulator.addTool({ ...base, toolCallId: 'call_123' });
    accumulator.addTool({ ...base, spanId: 'bbbbbbbbbbbbbbbb', toolCallId: 'private\nsecret' });
    accumulator.addTool({ ...base, spanId: 'cccccccccccccccc', toolCallId: 'x'.repeat(129) });
    accumulator.addTool({ ...base, spanId: 'dddddddddddddddd' });
    const batch = finish(accumulator);
    expect(batch.children).toMatchObject([
      { kind: 'tool', trace: { toolCallId: 'call_123' } },
      { kind: 'tool', trace: { spanId: 'dddddddddddddddd' } },
    ]);
    expect(batch.omittedChildren.tool).toBe(2);
    expect(JSON.stringify(batch)).not.toMatch(/private|secret/);
  });

  it('carries a provider-returned request ID only for an invoked call with a safe value', () => {
    const accumulator = makeAccumulator();
    const base = {
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, startedAt: AT, endedAt: AT,
      outcome: 'success' as const, round: 1, disposition: 'invoked' as const,
    };
    accumulator.addProvider({ ...base, spanId: 'aaaaaaaaaaaaaaaa', providerRequestId: 'req_abc123' });
    accumulator.addProvider({
      ...base, spanId: 'bbbbbbbbbbbbbbbb', providerRequestId: 'private\nsecret',
    });
    accumulator.addProvider({
      ...base, spanId: 'cccccccccccccccc', disposition: 'cache-hit', providerRequestId: 'req_should_omit',
    });
    accumulator.addProvider({ ...base, spanId: 'dddddddddddddddd' });
    const batch = finish(accumulator);
    expect(batch.children).toMatchObject([
      { kind: 'provider', trace: { providerRequestId: 'req_abc123' } },
      { kind: 'provider', trace: { spanId: 'dddddddddddddddd' } },
    ]);
    expect(batch.omittedChildren.provider).toBe(2);
    expect(JSON.stringify(batch)).not.toMatch(/private|secret|req_should_omit/);
  });

  it('carries a safe permission decision with its call ID and omits unsafe ones under the shared cap', () => {
    const accumulator = makeAccumulator();
    const base = { traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, decidedAt: AT, decision: 'allowed' as const };
    accumulator.addPermission({ ...base, toolCallId: 'call_123' });
    accumulator.addPermission({ ...base, toolCallId: 'private\nsecret' });
    accumulator.addPermission({ ...base, toolCallId: 'x'.repeat(129) });
    accumulator.addPermission({ ...base, decision: 'denied' });
    const batch = finish(accumulator);
    expect(batch.children).toMatchObject([
      { kind: 'permission', decision: { toolCallId: 'call_123', decision: 'allowed' } },
      { kind: 'permission', decision: { decision: 'denied' } },
    ]);
    expect(batch.omittedChildren).toEqual({ provider: 0, tool: 0, permission: 2 });
    expect(JSON.stringify(batch)).not.toMatch(/private|secret/);
  });

  it('keeps the first 256 accepted child completions in callback order and counts omissions by kind', () => {
    const accumulator = makeAccumulator();
    accumulator.addTool({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'aaaaaaaaaaaaaaaa',
      startedAt: AT, endedAt: AT, outcome: 'success',
    });
    for (let index = 1; index <= 256; index++) {
      accumulator.addProvider({
        traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID,
        spanId: index.toString(16).padStart(16, '0'), startedAt: AT, endedAt: AT,
        outcome: 'success', round: index, disposition: 'invoked', usageProvenance: 'complete',
        promptTokens: 1, completionTokens: 2, totalTokens: 3,
      });
    }
    accumulator.addTool({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'bbbbbbbbbbbbbbbb',
      startedAt: AT, endedAt: AT, outcome: 'success',
    });
    const batch = finish(accumulator);
    expect(batch.children).toHaveLength(256);
    expect(batch.children[0]?.kind).toBe('tool');
    expect(batch.children[1]).toMatchObject({ kind: 'provider', trace: { round: 1 } });
    expect(batch.children[255]).toMatchObject({ kind: 'provider', trace: { round: 255 } });
    expect(batch.omittedChildren).toEqual({ provider: 1, tool: 1, permission: 0 });
  });

  it('omits malformed timestamps, unsafe labels, and unattested partial token values', () => {
    const accumulator = makeAccumulator();
    accumulator.addProvider({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'aaaaaaaaaaaaaaaa',
      startedAt: AT, endedAt: AT, outcome: 'success', round: 1,
      disposition: 'invoked', providerId: 'private\ncredential', modelId: 'safe-model',
      usageProvenance: 'partial', promptTokens: 20, completionTokens: 10, totalTokens: 30,
    });
    accumulator.addTool({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'bbbbbbbbbbbbbbbb',
      startedAt: 'private malformed timestamp', endedAt: AT, outcome: 'success',
    });
    const batch = finish(accumulator);
    expect(batch.children).toEqual([{
      kind: 'provider', trace: {
        traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID, spanId: 'aaaaaaaaaaaaaaaa',
        startedAt: AT, endedAt: AT, outcome: 'success', round: 1,
        disposition: 'invoked', modelId: 'safe-model', usageProvenance: 'partial',
      },
    }]);
    expect(batch.omittedChildren).toEqual({ provider: 0, tool: 1, permission: 0 });
    expect(JSON.stringify(batch)).not.toMatch(/private|credential/);
  });

  it('rejects a root without canonical identity or time before host delivery', () => {
    expect(() => makeAccumulator().finish({
      sessionId: '../private', turnId: 'turn-1',
      root: { traceId: TRACE_ID, spanId: ROOT_SPAN_ID, startedAt: AT, endedAt: AT, outcome: 'success' },
    })).toThrow(/root/i);
    expect(() => makeAccumulator().finish({
      sessionId: 'sess-1', turnId: 'turn-1',
      root: { traceId: TRACE_ID, spanId: ROOT_SPAN_ID, startedAt: 'private', endedAt: AT, outcome: 'success' },
    })).toThrow(/root/i);
    expect(() => makeAccumulator().finish({
      sessionId: 'sess-1', turnId: 'turn-1',
      root: {
        traceId: TRACE_ID, spanId: ROOT_SPAN_ID,
        startedAt: '3000-01-01T00:00:00.000Z', endedAt: '3000-01-01T00:00:00.000Z',
        outcome: 'success',
      },
    })).toThrow(/root/i);
  });

  it('does not expose a rejected async diagnostic as an unhandled rejection', async () => {
    const enqueue = vi.fn(async () => { throw new Error('secret'); });
    const onFailure = vi.fn(async () => { throw new Error('private'); });
    enqueueLivePromptTrace({ enqueue, onFailure }, finish(makeAccumulator()));
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith('enqueue-failed'));
  });
});
