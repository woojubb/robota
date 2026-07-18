import { describe, expect, it, vi } from 'vitest';

import { defineEval, runEval } from '../runner.js';

import type { IMetric, TEvalRunFn } from '../eval-types.js';
import type { IExecutionResult, IToolSummary, IUsageSnapshot } from '../../interactive/types.js';

/**
 * SELFHOST-011 P1 — the neutral eval runner. Tests inject a fake `runFn` returning a synthetic
 * `IExecutionResult`; no live provider (TC-01/02/06).
 */

/** Build a synthetic run-result (mirrors the goal-controller test fixture). */
function makeResult(overrides: Partial<IExecutionResult> = {}): IExecutionResult {
  return {
    response: '',
    history: [],
    toolSummaries: [],
    contextState: { maxTokens: 0, usedTokens: 0, usedPercentage: 0, remainingPercentage: 0 },
    ...overrides,
  };
}

/** A run function that returns a fixed result for every input. */
function fixedRunFn(result: IExecutionResult): TEvalRunFn {
  return () => Promise.resolve(result);
}

describe('defineEval', () => {
  const metric: IMetric = { name: 'always', score: () => true };

  it('defaults the threshold to 1', () => {
    const def = defineEval({ cases: [{ input: 'a' }], metrics: [metric] });
    expect(def.threshold).toBe(1);
  });

  it('rejects an empty case or metric set', () => {
    expect(() => defineEval({ cases: [], metrics: [metric] })).toThrow(/at least one case/);
    expect(() => defineEval({ cases: [{ input: 'a' }], metrics: [] })).toThrow(
      /at least one metric/,
    );
  });

  it('rejects an out-of-range threshold', () => {
    expect(() =>
      defineEval({ cases: [{ input: 'a' }], metrics: [metric], threshold: 1.5 }),
    ).toThrow(/\[0, 1\]/);
    expect(() =>
      defineEval({ cases: [{ input: 'a' }], metrics: [metric], threshold: -0.1 }),
    ).toThrow(/\[0, 1\]/);
  });
});

describe('runEval — TC-01: scores cases + threshold pass/fail', () => {
  it('runs every case, applies each metric, and reports per-case scores + overall verdict', async () => {
    const mentionsFile: IMetric = {
      name: 'mentions-file',
      score: (r) => r.response.includes('index.ts'),
    };
    const runFn = vi.fn<TEvalRunFn>((input) =>
      Promise.resolve(makeResult({ response: input === 'q1' ? 'see index.ts' : 'nope' })),
    );

    const report = await runEval(
      { name: 'demo', cases: [{ input: 'q1' }, { input: 'q2' }], metrics: [mentionsFile] },
      runFn,
    );

    expect(runFn).toHaveBeenCalledTimes(2);
    expect(report.name).toBe('demo');
    expect(report.results).toHaveLength(2);
    expect(report.results[0].scores[0]).toMatchObject({ metric: 'mentions-file', normalized: 1 });
    expect(report.results[1].scores[0]).toMatchObject({ metric: 'mentions-file', normalized: 0 });
    // one of two cases passes → overall 0.5; default threshold 1 → fail
    expect(report.overallScore).toBe(0.5);
    expect(report.threshold).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('passes when the aggregate meets a lowered threshold (boolean aggregate = pass rate)', async () => {
    const pass: IMetric = { name: 'half', score: (r) => r.response === 'ok' };
    const runFn = vi.fn<TEvalRunFn>((input) =>
      Promise.resolve(makeResult({ response: input === 'a' ? 'ok' : 'no' })),
    );
    const report = await runEval(
      { cases: [{ input: 'a' }, { input: 'b' }], metrics: [pass], threshold: 0.5 },
      runFn,
    );
    expect(report.overallScore).toBe(0.5);
    expect(report.passed).toBe(true);
  });
});

describe('runEval — TC-02: metric is a pure fn over the full IExecutionResult; runner is IO-free', () => {
  it('a metric scores tool trajectory + usage, not just the response string', async () => {
    const usage: IUsageSnapshot = {
      kind: 'exact',
      scope: 'turn',
      totalTokens: 15,
      contextUsedTokens: 15,
      contextMaxTokens: 1000,
      contextUsedPercentage: 1.5,
      costStatus: 'unknown',
    };
    const wrote: IToolSummary = { name: 'Write', args: '{}' };

    const usedWriteUnderBudget: IMetric = {
      name: 'wrote-under-budget',
      score: (r) =>
        r.toolSummaries.some((t) => t.name === 'Write') && (r.usage?.totalTokens ?? 0) <= 100,
    };

    const report = await runEval(
      { cases: [{ input: 'x' }], metrics: [usedWriteUnderBudget], threshold: 1 },
      fixedRunFn(makeResult({ response: '', toolSummaries: [wrote], usage })),
    );
    expect(report.passed).toBe(true);
    expect(report.results[0].scores[0].normalized).toBe(1);
  });

  it('runEval performs no IO given an injected runFn (pure over runFn)', async () => {
    // The only external interaction is the injected runFn — asserted by call count + a deterministic result.
    const runFn = vi.fn<TEvalRunFn>(() => Promise.resolve(makeResult({ response: 'hi' })));
    const numeric: IMetric = { name: 'len', score: (r) => (r.response.length >= 2 ? 1 : 0) };
    const report = await runEval({ cases: [{ input: 'z' }], metrics: [numeric] }, runFn);
    expect(runFn).toHaveBeenCalledOnce();
    expect(report.passed).toBe(true);
  });
});

describe('runEval — TC-06: reaches the agent only through the injected runFn seam', () => {
  it('never constructs a provider/session itself — the runFn is the sole run source', async () => {
    const seam = vi.fn<TEvalRunFn>(() => Promise.resolve(makeResult({ response: 'ok' })));
    await runEval(
      { cases: [{ input: 'a' }, { input: 'b' }], metrics: [{ name: 'm', score: () => true }] },
      seam,
    );
    // Every run went through the injected seam — the library defines no provider/agent config of its own.
    expect(seam).toHaveBeenCalledTimes(2);
    expect(seam).toHaveBeenNthCalledWith(1, 'a');
    expect(seam).toHaveBeenNthCalledWith(2, 'b');
  });
});
