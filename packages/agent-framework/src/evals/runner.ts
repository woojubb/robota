/**
 * SELFHOST-011 P1 — the neutral eval runner.
 *
 * `runEval(def, runFn)` drives each case through the INJECTED `runFn`, scores the resulting `IExecutionResult`
 * with each metric, and aggregates to an overall pass/fail against the threshold. It is pure over `runFn` — no
 * IO and no provider — mirroring `@robota-sdk/agent-session-analytics`'s pure `analyzeSession`. The default
 * `runFn` (a live agent run) is built by the caller via `createSessionRunFn`; the runner itself never spawns one.
 */

import type {
  IEvalCaseResult,
  IEvalDefinition,
  IEvalMetricScore,
  IEvalReport,
  TEvalRunFn,
} from './eval-types.js';

/** Default aggregate bar: every case×metric must be perfect. */
const DEFAULT_THRESHOLD = 1;

/** Normalize a metric score to `[0, 1+]`: a boolean → 1/0, a number → itself (higher is better). */
function normalizeScore(score: number | boolean): number {
  return typeof score === 'boolean' ? (score ? 1 : 0) : score;
}

/** Arithmetic mean; an empty set scores 0 (no evidence of passing). */
function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Validate + normalize an eval definition. Throws on an empty case/metric set or an out-of-range threshold;
 * returns the definition with `threshold` defaulted to `1`. Exposed so a caller can fail fast before a run.
 */
export function defineEval(def: IEvalDefinition): IEvalDefinition {
  if (def.cases.length === 0) {
    throw new Error('eval definition requires at least one case');
  }
  if (def.metrics.length === 0) {
    throw new Error('eval definition requires at least one metric');
  }
  const threshold = def.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(
      `eval threshold must be a number in [0, 1] (received ${String(def.threshold)})`,
    );
  }
  return { ...def, threshold };
}

/**
 * Run every case through `runFn`, score each run-result with each metric, and aggregate to a report.
 *
 * Cases run sequentially (deterministic; a shared provider is not hammered in parallel). `overallScore` is the
 * mean of every case×metric normalized score, and `passed = overallScore >= threshold` — the verdict the CI
 * gate maps to an exit code.
 */
export async function runEval(def: IEvalDefinition, runFn: TEvalRunFn): Promise<IEvalReport> {
  const normalized = defineEval(def);
  const threshold = normalized.threshold ?? DEFAULT_THRESHOLD;

  const results: IEvalCaseResult[] = [];
  for (const evalCase of normalized.cases) {
    const result = await runFn(evalCase.input);
    const scores: IEvalMetricScore[] = normalized.metrics.map((metric) => {
      const raw = metric.score(result);
      return { metric: metric.name, score: raw, normalized: normalizeScore(raw) };
    });
    results.push({
      input: evalCase.input,
      scores,
      caseScore: mean(scores.map((s) => s.normalized)),
    });
  }

  const overallScore = mean(results.flatMap((r) => r.scores.map((s) => s.normalized)));
  return {
    ...(normalized.name !== undefined ? { name: normalized.name } : {}),
    results,
    overallScore,
    threshold,
    passed: overallScore >= threshold,
  };
}
