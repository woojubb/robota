import { describe, expect, it } from 'vitest';

import {
  buildResult,
  createUsageSummaryEntry,
  createSourceUsageSummaryEntry,
  createUsageObservationEntry,
} from '../interactive-session-execution.js';

import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';

const CONTEXT_STATE: IContextWindowState = {
  maxTokens: 1000,
  usedTokens: 150,
  usedPercentage: 15,
  remainingPercentage: 85,
};

describe('interactive session usage summaries', () => {
  it('extracts exact provider usage from completed assistant messages', () => {
    const sessionHistory: TUniversalMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'hello',
        state: 'complete',
        timestamp: new Date(),
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = buildResult('done', sessionHistory, [], 0, CONTEXT_STATE);

    expect(result.usage).toEqual({
      kind: 'estimated',
      scope: 'turn',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      contextUsedTokens: 150,
      contextMaxTokens: 1000,
      contextUsedPercentage: 15,
      costStatus: 'unknown',
    });
  });

  it('prices only complete, actual provider calls and labels table-derived cost estimated', () => {
    const sessionHistory: TUniversalMessage[] = [
      { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    // gpt-4o = $2.5/M input, $10/M output → (100/1e6)*2.5 + (50/1e6)*10 = 0.00075.
    const result = buildResult('done', sessionHistory, [], 0, CONTEXT_STATE, undefined, 'gpt-4o', [{
      callId: '123e4567-e89b-42d3-a456-426614174000',
      round: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      outcome: 'success',
      disposition: 'invoked',
      modelId: 'gpt-4o',
      usageProvenance: 'complete',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    }]);

    expect(result.usage?.costStatus).toBe('estimated');
    expect(result.usage?.costUsd).toBeCloseTo(0.00075, 10);
  });

  it('sums distinct rounds in one turn and prices each verified model separately', () => {
    const stamp = new Date().toISOString();
    const sessionHistory: TUniversalMessage[] = [
      { id: 'a1', role: 'assistant', content: 'first', state: 'complete', timestamp: new Date(), metadata: { usageObservationId: 'turn-1', round: 1, inputTokens: 100, outputTokens: 50 } },
      { id: 'a2', role: 'assistant', content: 'second', state: 'complete', timestamp: new Date(), metadata: { usageObservationId: 'turn-1', round: 2, inputTokens: 200, outputTokens: 100 } },
    ];
    const calls = [
      { callId: '123e4567-e89b-42d3-a456-426614174000', round: 1, startedAt: stamp, endedAt: stamp, outcome: 'success' as const, disposition: 'invoked' as const, modelId: 'gpt-4o', usageProvenance: 'complete' as const, promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { callId: '223e4567-e89b-42d3-a456-426614174000', round: 2, startedAt: stamp, endedAt: stamp, outcome: 'success' as const, disposition: 'invoked' as const, modelId: 'gpt-4o-mini', usageProvenance: 'complete' as const, promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    ];
    const result = buildResult('done', sessionHistory, [], 0, CONTEXT_STATE, undefined, 'gpt-4o', calls);
    expect(result.usage).toMatchObject({ promptTokens: 300, completionTokens: 150, totalTokens: 450, costStatus: 'estimated' });
    expect(result.usage?.costUsd).toBeCloseTo(0.00084, 8);
    expect(buildResult('done', sessionHistory, [], 0, CONTEXT_STATE, undefined, 'gpt-4o', [calls[0]!]).usage?.costStatus).toBe('unknown');
  });

  it('does not persist a non-finite estimate from an unrecognized model key', () => {
    const stamp = new Date().toISOString();
    const result = buildResult('done', [{
      id: 'a1', role: 'assistant', content: 'done', state: 'complete', timestamp: new Date(),
      metadata: { inputTokens: 1, outputTokens: 1 },
    }], [], 0, CONTEXT_STATE, undefined, 'constructor', [{
      callId: '123e4567-e89b-42d3-a456-426614174000', round: 1,
      startedAt: stamp, endedAt: stamp, outcome: 'success', disposition: 'invoked',
      modelId: 'constructor', usageProvenance: 'complete', promptTokens: 1, completionTokens: 1, totalTokens: 2,
    }]);
    expect(result.usage?.costStatus).toBe('unknown');
    expect(result.usage?.costUsd).toBeUndefined();
  });

  it('TC-06: leaves costUsd absent + costStatus unknown for an unpriced model', () => {
    const sessionHistory: TUniversalMessage[] = [
      { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = buildResult(
      'done',
      sessionHistory,
      [],
      0,
      CONTEXT_STATE,
      undefined,
      'no-such-model-xyz',
    );

    expect(result.usage?.costStatus).toBe('unknown');
    expect(result.usage?.costUsd).toBeUndefined();
  });

  // SELFHOST-004: the source-attribution entry derives no cost → costStatus 'unknown' + no costUsd,
  // honoring the invariant "costUsd present iff costStatus !== 'unknown'".
  it('TC-06: source-attributed usage carries costStatus unknown and no costUsd', () => {
    const entry = createSourceUsageSummaryEntry(
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { scope: 'subagent', id: 'agent_1' },
    );
    expect(entry.data?.costStatus).toBe('unknown');
    expect(entry.data?.costUsd).toBeUndefined();
  });

  it('creates persisted usage-summary history entries', () => {
    const usage = {
      kind: 'exact' as const,
      scope: 'turn' as const,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      contextUsedTokens: 150,
      contextMaxTokens: 1000,
      contextUsedPercentage: 15,
      costStatus: 'unknown' as const,
    };

    const entry = createUsageSummaryEntry(usage);

    expect(entry.category).toBe('event');
    expect(entry.type).toBe('usage-summary');
    expect(entry.data).toEqual(usage);
  });

  it('persists a content-free observation even when a started turn has zero usage', () => {
    const entry = createUsageObservationEntry({
      turnId: 'turn-1',
      outcome: 'failure',
      providerId: 'anthropic',
      modelId: 'gpt-5.6-sol',
      driverId: 'app',
    });

    expect(entry).toMatchObject({
      category: 'event',
      type: 'usage-observation',
      data: {
        usageObservationId: 'turn-1',
        turnId: 'turn-1',
        outcome: 'failure',
        providerId: 'anthropic',
        modelId: 'gpt-5.6-sol',
        surface: 'desktop-app',
      },
    });
    expect(entry.data?.usage).toBeUndefined();
  });

  it('uses trusted surface metadata independently from an opaque driver id', () => {
    const entry = createUsageObservationEntry({
      turnId: 'turn-remote',
      outcome: 'success',
      driverId: 'device-sha256',
      surface: 'remote',
    });

    expect(entry.data).toMatchObject({ surface: 'remote' });
  });

  it('deduplicates repeated persisted usage fragments by provider-round identity', () => {
    const duplicate = {
      role: 'assistant' as const,
      content: 'done',
      id: 'a1',
      timestamp: new Date(),
      state: 'complete' as const,
      metadata: {
        usageObservationId: 'provider-round-1',
        inputTokens: 10,
        outputTokens: 5,
      },
    };
    const result = buildResult(
      'done',
      [duplicate, { ...duplicate, id: 'a1-replayed' }],
      [],
      0,
      { usedTokens: 15, maxTokens: 1000, usedPercentage: 1.5, remainingPercentage: 98.5 },
      undefined,
      'gpt-test',
    );

    expect(result.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });
});
