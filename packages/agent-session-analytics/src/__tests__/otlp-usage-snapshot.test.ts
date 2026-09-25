import { describe, expect, it } from 'vitest';

import { createOtlpUsageSnapshot } from '../otlp-usage-snapshot.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

describe('OTLP usage snapshot projection', () => {
  it('exports separate accepted-call gauges without adding call tokens to turn totals', () => {
    const record: IInteractiveSessionRecord = {
      id: 'private-session', cwd: '/private/path', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:01:00.000Z', messages: [],
      history: [
        { id: 'root', timestamp: new Date('2026-09-24T00:01:00.000Z'), category: 'event', type: 'usage-observation', data: {
          usageObservationId: 'turn-1', turnId: 'turn-1', outcome: 'success',
          promptExecutionStartedAt: '2026-09-24T00:00:59.000Z', promptExecutionEndedAt: '2026-09-24T00:01:00.000Z', promptExecutionOutcome: 'success',
          promptExecutionTraceId: '1234567890abcdef1234567890abcdef', promptExecutionSpanId: '1234567890abcdef',
          usage: { kind: 'exact', scope: 'turn', totalTokens: 150, promptTokens: 100, completionTokens: 50, contextUsedTokens: 150, contextMaxTokens: 1000, contextUsedPercentage: 15, costStatus: 'estimated', costUsd: 0.00075 },
        } },
        { id: 'call', timestamp: new Date('2026-09-24T00:00:59.900Z'), category: 'event', type: 'provider-call-trace', data: {
          traceId: '1234567890abcdef1234567890abcdef', parentSpanId: '1234567890abcdef', spanId: 'abcdef1234567890',
          startedAt: '2026-09-24T00:00:59.100Z', endedAt: '2026-09-24T00:00:59.900Z', outcome: 'success', round: 1,
          disposition: 'invoked', usageProvenance: 'complete', modelId: 'gpt-4o', promptTokens: 100, completionTokens: 50, totalTokens: 150,
        } },
      ],
    };
    const at = new Date('2026-09-24T02:00:00.000Z');
    const metrics = (createOtlpUsageSnapshot([record], at, 'test').resourceMetrics[0] as { scopeMetrics: [{ metrics: Array<{ name: string; gauge: { dataPoints: [{ asDouble: number }] } }> }] }).scopeMetrics[0].metrics;
    const value = (name: string) => metrics.find((metric) => metric.name === name)?.gauge.dataPoints[0].asDouble;
    expect(value('robota.token.total')).toBe(150);
    expect(value('robota.provider_call.count')).toBe(1);
    expect(value('robota.provider_call.token.input.known')).toBe(100);
    expect(value('robota.provider_call.cost.usd.estimated')).toBeCloseTo(0.00075);
    record.history!.push({ ...record.history![1]!, id: 'duplicate' });
    const duplicateMetrics = (createOtlpUsageSnapshot([record], at, 'test').resourceMetrics[0] as { scopeMetrics: [{ metrics: Array<{ name: string; gauge: { dataPoints: [{ asDouble: number }] } }> }] }).scopeMetrics[0].metrics;
    expect(duplicateMetrics.find((metric) => metric.name === 'robota.provider_call.count')?.gauge.dataPoints[0].asDouble).toBe(0);
  });
  it('keeps missing cost and token split visibly unknown', () => {
    const record: IInteractiveSessionRecord = {
      id: 'private-session',
      cwd: '/private/path',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:01:00.000Z',
      messages: [],
      history: [
        {
          id: 'observation',
          timestamp: new Date('2026-09-24T00:01:00.000Z'),
          category: 'event',
          type: 'usage-observation',
          data: {
            usageObservationId: 'turn-private',
            turnId: 'turn-private',
            outcome: 'success',
            source: { scope: 'background', label: 'private task' },
            usage: {
              kind: 'exact',
              scope: 'turn',
              totalTokens: 12,
              contextUsedTokens: 12,
              contextMaxTokens: 100,
              contextUsedPercentage: 12,
              costStatus: 'unknown',
            },
          },
        },
      ],
    };
    const payload = createOtlpUsageSnapshot([record], new Date('2026-09-24T02:00:00.000Z'), 'test');
    const json = JSON.stringify(payload);
    const metrics = (
      payload.resourceMetrics[0] as {
        scopeMetrics: [
          { metrics: Array<{ name: string; gauge: { dataPoints: [{ asDouble: number }] } }> },
        ];
      }
    ).scopeMetrics[0].metrics;
    const value = (name: string) =>
      metrics.find((metric) => metric.name === name)?.gauge.dataPoints[0].asDouble;
    expect(value('robota.token.total')).toBe(12);
    expect(value('robota.token.input.known')).toBe(0);
    expect(value('robota.token.split_unknown_observations')).toBe(1);
    expect(value('robota.cost.usd.known')).toBe(0);
    expect(value('robota.cost.unknown_observations')).toBe(1);
    expect(json).not.toMatch(/private|turn-private/);
  });

  it('counts only canonical turns while retaining legacy child usage tokens', () => {
    const record: IInteractiveSessionRecord = {
      id: 'session',
      cwd: '/workspace',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:01:00.000Z',
      messages: [],
      history: [
        {
          id: 'main',
          timestamp: new Date('2026-09-24T00:01:00.000Z'),
          category: 'event',
          type: 'usage-observation',
          data: {
            usageObservationId: 'main-turn',
            turnId: 'main-turn',
            outcome: 'success',
            usage: {
              kind: 'exact',
              scope: 'turn',
              totalTokens: 5,
              promptTokens: 4,
              completionTokens: 1,
              contextUsedTokens: 5,
              contextMaxTokens: 100,
              contextUsedPercentage: 5,
              costStatus: 'unknown',
            },
          },
        },
        {
          id: 'child',
          timestamp: new Date('2026-09-24T00:01:00.000Z'),
          category: 'event',
          type: 'usage-summary',
          data: {
            kind: 'exact',
            scope: 'turn',
            totalTokens: 7,
            promptTokens: 6,
            completionTokens: 1,
            contextUsedTokens: 0,
            contextMaxTokens: 0,
            contextUsedPercentage: 0,
            costStatus: 'unknown',
            source: { scope: 'background', label: 'private work' },
          },
        },
      ],
    };
    const payload = createOtlpUsageSnapshot([record], new Date('2026-09-24T02:00:00.000Z'), 'test');
    const metrics = (
      payload.resourceMetrics[0] as {
        scopeMetrics: [
          { metrics: Array<{ name: string; gauge: { dataPoints: [{ asDouble: number }] } }> },
        ];
      }
    ).scopeMetrics[0].metrics;
    const value = (name: string) =>
      metrics.find((metric) => metric.name === name)?.gauge.dataPoints[0].asDouble;
    expect(value('robota.turn.count')).toBe(1);
    expect(value('robota.token.total')).toBe(12);
  });

  it('marks a failed canonical turn with no usage as unknown cost and token split', () => {
    const record: IInteractiveSessionRecord = {
      id: 'session',
      cwd: '/workspace',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:01:00.000Z',
      messages: [],
      history: [
        {
          id: 'failed',
          timestamp: new Date('2026-09-24T00:01:00.000Z'),
          category: 'event',
          type: 'usage-observation',
          data: { usageObservationId: 'failed', turnId: 'failed', outcome: 'failure' },
        },
      ],
    };
    const payload = createOtlpUsageSnapshot([record], new Date('2026-09-24T02:00:00.000Z'), 'test');
    const metrics = (
      payload.resourceMetrics[0] as {
        scopeMetrics: [
          { metrics: Array<{ name: string; gauge: { dataPoints: [{ asDouble: number }] } }> },
        ];
      }
    ).scopeMetrics[0].metrics;
    const value = (name: string) =>
      metrics.find((metric) => metric.name === name)?.gauge.dataPoints[0].asDouble;
    expect(value('robota.turn.count')).toBe(1);
    expect(value('robota.token.split_unknown_observations')).toBe(1);
    expect(value('robota.cost.unknown_observations')).toBe(1);
  });
});
