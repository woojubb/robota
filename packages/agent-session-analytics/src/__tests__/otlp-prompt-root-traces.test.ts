import { describe, expect, it } from 'vitest';

import { createOtlpPromptRootTraces } from '../otlp-prompt-root-traces.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const SPAN_ID = '1234567890abcdef';

function root(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usageObservationId: 'turn-1',
    turnId: 'turn-1',
    outcome: 'success',
    promptExecutionStartedAt: '2026-09-24T00:00:59.000Z',
    promptExecutionEndedAt: '2026-09-24T00:01:00.000Z',
    promptExecutionOutcome: 'success',
    promptExecutionTraceId: TRACE_ID,
    promptExecutionSpanId: SPAN_ID,
    providerId: 'secret-provider',
    modelId: 'secret-model',
    source: { scope: 'background', label: 'secret-task' },
    ...overrides,
  };
}

function record(id: string, observations: readonly unknown[]): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/secret/workspace',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:01:00.000Z',
    messages: [],
    history: observations.map((data, index) => ({
      id: `event-${index}`,
      timestamp: new Date('2026-09-24T00:01:00.000Z'),
      category: 'event' as const,
      type: 'usage-observation',
      data: data as never,
    })),
  };
}

function spans(result: ReturnType<typeof createOtlpPromptRootTraces>) {
  return result.payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
}

describe('content-free OTLP prompt root trace projection', () => {
  it('exports exact root times and first-callback outcomes without sensitive fields', () => {
    const result = createOtlpPromptRootTraces(
      [
        record('secret-session', [
          root({ outcome: 'interrupted', promptExecutionOutcome: 'success' }),
          root({
            usageObservationId: 'turn-2',
            turnId: 'turn-2',
            promptExecutionTraceId: '2234567890abcdef1234567890abcdef',
            promptExecutionOutcome: 'failure',
          }),
          root({
            usageObservationId: 'turn-3',
            turnId: 'turn-3',
            promptExecutionTraceId: '3234567890abcdef1234567890abcdef',
            promptExecutionOutcome: 'interrupted',
          }),
        ]),
      ],
      'test-version',
    );

    expect(result.coverage).toMatchObject({ exported: 3, missing: 0, invalid: 0, duplicate: 0 });
    expect(spans(result).map((span) => span.status.code)).toEqual([1, 2, 0]);
    expect(spans(result)[0]).toMatchObject({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      kind: 1,
      startTimeUnixNano: '1790208059000000000',
      endTimeUnixNano: '1790208060000000000',
      attributes: [{ key: 'robota.prompt.outcome', value: { stringValue: 'success' } }],
    });
    const wire = JSON.stringify(result.payload);
    expect(wire).not.toMatch(/secret|turn-1|secret-session|promptExecution|providerId|modelId/);
  });

  it('excludes old, partial, malformed and out-of-range roots without synthesizing spans', () => {
    const validBoundary = root({
      promptExecutionStartedAt: '2554-07-21T23:34:33.709Z',
      promptExecutionEndedAt: '2554-07-21T23:34:33.709Z',
    });
    const cases = [
      root({
        promptExecutionStartedAt: undefined,
        promptExecutionEndedAt: undefined,
        promptExecutionOutcome: undefined,
        promptExecutionTraceId: undefined,
        promptExecutionSpanId: undefined,
      }),
      root({ promptExecutionSpanId: undefined }),
      root({ promptExecutionStartedAt: '1969-12-31T23:59:59.000Z' }),
      root({ promptExecutionEndedAt: '2554-07-21T23:34:33.710Z' }),
      root({ promptExecutionStartedAt: '2026-09-24T00:01:01.000Z' }),
      root({ promptExecutionTraceId: '0'.repeat(32) }),
      root({ promptExecutionSpanId: 'f'.repeat(15) }),
      root({ promptExecutionOutcome: 'unknown' }),
      root({ promptExecutionEndedAt: 'not-a-date' }),
      root({ usageObservationId: 'different-from-turn' }),
    ];
    const unique = cases.map((item, index) => ({
      ...item,
      usageObservationId: `turn-${index + 2}`,
      turnId: `turn-${index + 2}`,
      promptExecutionTraceId:
        item['promptExecutionTraceId'] === TRACE_ID
          ? `${String(index + 2).padStart(2, '0')}${TRACE_ID.slice(2)}`
          : item['promptExecutionTraceId'],
    }));
    unique[9]!['turnId'] = 'other-turn';
    const result = createOtlpPromptRootTraces(
      [record('session', [validBoundary, ...unique])],
      'test-version',
    );

    expect(result.coverage).toMatchObject({ exported: 1, missing: 1, invalid: 9, duplicate: 0 });
    expect(spans(result)[0]?.startTimeUnixNano).toBe('18446744073709000000');
    expect(spans(result)[0]?.endTimeUnixNano).toBe('18446744073709000000');
  });

  it('rejects every duplicated root but keeps equal observation ids from distinct sessions', () => {
    const distinct = root({
      usageObservationId: 'turn-2',
      turnId: 'turn-2',
      promptExecutionTraceId: '2234567890abcdef1234567890abcdef',
    });
    const repeatedTrace = root({
      usageObservationId: 'turn-4',
      turnId: 'turn-4',
      promptExecutionTraceId: '3234567890abcdef1234567890abcdef',
    });
    const result = createOtlpPromptRootTraces(
      [
        record('session-a', [
          root(),
          root({ promptExecutionTraceId: '5234567890abcdef1234567890abcdef' }),
          distinct,
          repeatedTrace,
        ]),
        record('session-b', [
          root({ promptExecutionTraceId: '4234567890abcdef1234567890abcdef' }),
          root({
            usageObservationId: 'turn-5',
            turnId: 'turn-5',
            promptExecutionTraceId: '3234567890abcdef1234567890abcdef',
          }),
        ]),
      ],
      'test-version',
    );

    expect(result.coverage).toMatchObject({ exported: 2, missing: 0, invalid: 0, duplicate: 4 });
    expect(spans(result).map((span) => span.traceId)).toEqual([
      '2234567890abcdef1234567890abcdef',
      '4234567890abcdef1234567890abcdef',
    ]);
  });

  it('accepts the Unix epoch boundary and ignores a legacy summary with root-like data', () => {
    const session = record('session', [
      root({
        promptExecutionStartedAt: '1970-01-01T00:00:00.000Z',
        promptExecutionEndedAt: '1970-01-01T00:00:00.000Z',
      }),
    ]);
    session.history!.push({
      id: 'legacy',
      timestamp: new Date('2026-09-24T00:01:00.000Z'),
      category: 'event',
      type: 'usage-summary',
      data: root(),
    });

    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(result.coverage).toMatchObject({ exported: 1, missing: 0, invalid: 0, duplicate: 0 });
    expect(spans(result)[0]?.startTimeUnixNano).toBe('0');
  });

  it('exports only a verified, content-free provider child under its recorded prompt root', () => {
    const session = record('secret-session', [root()]);
    session.history!.push({
      id: 'provider-event',
      timestamp: new Date('2026-09-24T00:01:00.000Z'),
      category: 'event',
      type: 'provider-call-trace',
      data: {
        traceId: TRACE_ID,
        parentSpanId: SPAN_ID,
        spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'success',
        round: 1,
        providerPayload: 'secret response',
      },
    });

    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(result.coverage.providerChildren).toEqual({
      exported: 1,
      invalid: 0,
      orphaned: 0,
      duplicate: 0,
    });
    expect(spans(result)).toHaveLength(2);
    expect(spans(result)[1]).toMatchObject({
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      spanId: 'abcdef1234567890',
      name: 'robota.provider_call',
      startTimeUnixNano: '1790208059100000000',
      endTimeUnixNano: '1790208059900000000',
      status: { code: 1 },
    });
    expect(JSON.stringify(result.payload)).not.toMatch(/secret|providerPayload|response/);
  });

  it('adds only verified numeric usage and estimated cost to an accepted provider span', () => {
    const session = record('secret-session', [root()]);
    session.history!.push({
      id: 'provider', timestamp: new Date('2026-09-24T00:01:00.000Z'), category: 'event',
      type: 'provider-call-trace', data: {
        traceId: TRACE_ID, parentSpanId: SPAN_ID, spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z', endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'success', round: 1, disposition: 'invoked', usageProvenance: 'complete',
        providerId: 'secret-provider', modelId: 'gpt-4o', callId: 'secret-call',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
      },
    });
    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(result.callMetrics).toMatchObject({ invoked: 1, completeUsage: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.00075, exactPriceMatches: 1 });
    expect(spans(result)[1]?.attributes).toContainEqual({ key: 'robota.provider.usage.input_tokens', value: { intValue: '100' } });
    expect(spans(result)[1]?.attributes).toContainEqual({ key: 'robota.provider.cost.usd.estimated', value: { doubleValue: 0.00075 } });
    expect(JSON.stringify(result.payload)).not.toMatch(/secret|gpt-4o|callId|modelId|providerId/);

    (session.history![1]!.data as Record<string, unknown>)['totalTokens'] = 999;
    const invalid = createOtlpPromptRootTraces([session], 'test-version');
    expect(invalid.coverage.providerUsage.invalid).toBe(1);
    expect(invalid.coverage.providerChildren.exported).toBe(1);
    expect(spans(invalid)[1]?.attributes).toEqual([{ key: 'robota.provider.outcome', value: { stringValue: 'success' } }]);
  });

  it('exports a verified tool body child but no recorded arguments or results', () => {
    const session = record('secret-session', [root()]);
    session.history!.push({
      id: 'tool-event',
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'tool-body-trace',
      data: {
        traceId: TRACE_ID,
        parentSpanId: SPAN_ID,
        spanId: 'abcdef1234567890',
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'failure',
        toolArgs: 'secret argument',
        toolResult: 'secret result',
      },
    });
    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(result.coverage.toolChildren).toEqual({
      exported: 1,
      invalid: 0,
      orphaned: 0,
      duplicate: 0,
    });
    expect(spans(result)[1]).toMatchObject({
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      spanId: 'abcdef1234567890',
      name: 'robota.tool_body',
      status: { code: 2 },
    });
    expect(JSON.stringify(result.payload)).not.toMatch(/secret|toolArgs|toolResult/);
  });

  it('refuses malformed, orphaned, out-of-root and duplicate tool children', () => {
    const session = record('session', [root()]);
    const addTool = (spanId: string, overrides: Record<string, unknown> = {}) => {
      session.history!.push({
        id: `tool-${session.history!.length}`,
        timestamp: new Date('2026-09-24T00:00:59.900Z'),
        category: 'event',
        type: 'tool-body-trace',
        data: {
          traceId: TRACE_ID,
          parentSpanId: SPAN_ID,
          spanId,
          startedAt: '2026-09-24T00:00:59.100Z',
          endedAt: '2026-09-24T00:00:59.900Z',
          outcome: 'success',
          ...overrides,
        },
      });
    };
    addTool('aaaaaaaaaaaaaaaa', { endedAt: 'bad' });
    addTool('bbbbbbbbbbbbbbbb', { parentSpanId: 'cccccccccccccccc' });
    addTool('cccccccccccccccc', { endedAt: '2026-09-24T00:01:00.001Z' });
    addTool('dddddddddddddddd');
    addTool('dddddddddddddddd', { endedAt: 'bad' });
    expect(createOtlpPromptRootTraces([session], 'test-version').coverage.toolChildren).toEqual({
      exported: 0,
      invalid: 2,
      orphaned: 1,
      duplicate: 2,
    });
  });

  it('excludes orphaned, duplicate and out-of-root children while keeping a valid failure', () => {
    const session = record('session', [root()]);
    const child = (spanId: string, overrides: Record<string, unknown> = {}) => ({
      id: `event-${session.history!.length}`,
      timestamp: new Date('2026-09-24T00:00:59.900Z'),
      category: 'event',
      type: 'provider-call-trace',
      data: {
        traceId: TRACE_ID,
        parentSpanId: SPAN_ID,
        spanId,
        startedAt: '2026-09-24T00:00:59.100Z',
        endedAt: '2026-09-24T00:00:59.900Z',
        outcome: 'failure',
        round: 1,
        ...overrides,
      },
    });
    session.history!.push(child('aaaaaaaaaaaaaaaa'));
    session.history!.push(child('bbbbbbbbbbbbbbbb', { parentSpanId: 'cccccccccccccccc' }));
    session.history!.push(child('cccccccccccccccc', { endedAt: '2026-09-24T00:01:00.001Z' }));
    session.history!.push(child('dddddddddddddddd'));
    session.history!.push(child('dddddddddddddddd'));

    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(result.coverage.providerChildren).toEqual({
      exported: 1,
      invalid: 1,
      orphaned: 1,
      duplicate: 2,
    });
    expect(spans(result)).toHaveLength(2);
    expect(spans(result)[1]).toMatchObject({
      spanId: 'aaaaaaaaaaaaaaaa',
      parentSpanId: SPAN_ID,
      status: { code: 2 },
    });
  });

  it('excludes a valid child when a malformed sibling claims the same trace and span identity', () => {
    const session = record('session', [root()]);
    const valid = {
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      spanId: 'abcdef1234567890',
      startedAt: '2026-09-24T00:00:59.100Z',
      endedAt: '2026-09-24T00:00:59.900Z',
      outcome: 'success',
      round: 1,
    };
    for (const data of [valid, { ...valid, endedAt: 'not-a-date' }]) {
      session.history!.push({
        id: `child-${session.history!.length}`,
        timestamp: new Date('2026-09-24T00:00:59.900Z'),
        category: 'event',
        type: 'provider-call-trace',
        data,
      });
    }

    const result = createOtlpPromptRootTraces([session], 'test-version');
    expect(spans(result)).toHaveLength(1);
    expect(result.coverage.providerChildren).toEqual({
      exported: 0,
      invalid: 0,
      orphaned: 0,
      duplicate: 2,
    });
  });
});
