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
    expect(batch.omittedChildren).toEqual({ provider: 1, tool: 1 });
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
    expect(batch.omittedChildren).toEqual({ provider: 0, tool: 1 });
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
