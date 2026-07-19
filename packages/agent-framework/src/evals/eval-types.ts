/**
 * SELFHOST-011 P1 — neutral evals-as-code contracts.
 *
 * An eval is `{ dataset of cases } × { metrics that score a run } × { pass threshold }` (the shape shared by
 * Mastra scorers / Google ADK evalsets / OpenAI Agents traces). Robota's library layer stays NEUTRAL: it ships
 * only these definition/runner contracts + the metric-as-function type. Concrete metrics and datasets are
 * CONSUMER-supplied (an example lives in `examples/`, never in `packages/`).
 *
 * A metric is a pure function over the SSOT run-result `IExecutionResult` (response + tool trajectory + usage +
 * history) — NOT over the response string alone — mirroring the pure metrics-over-a-run sibling
 * `@robota-sdk/agent-session-analytics`. Boundary: analytics scores a persisted session RECORD
 * (`IInteractiveSessionRecord`); an eval metric scores a single RUN RESULT (`IExecutionResult`).
 */

import type { IExecutionResult } from '../interactive/types.js';

/**
 * A metric scores one run's SSOT result. A `boolean` is a direct pass/fail; a `number` is a score in `[0, 1]`
 * where higher is better (compared against the definition threshold). A numeric score outside `[0, 1]` is
 * clamped by the runner. Pure — no IO, no provider.
 */
export interface IMetric {
  readonly name: string;
  // SELFHOST-011 P3: the eval CASE is threaded in (optional, backward-compatible — an existing `(result) => …`
  // metric still satisfies this) so a per-case metric (e.g. `exactMatch()`) can read `evalCase.expected`.
  score(result: IExecutionResult, evalCase?: IEvalCase): number | boolean;
}

/** One eval case: the prompt driven through the agent, plus an optional expected reference for a metric to use. */
export interface IEvalCase {
  readonly input: string;
  readonly expected?: string;
}

/**
 * An eval definition: a dataset of cases scored by metrics against a pass threshold.
 * `threshold` is the aggregate mean-score bar in `[0, 1]` (default `1`). Because a `boolean` score normalizes to
 * `1`/`0`, for boolean metrics the aggregate IS the pass rate (e.g. One-Shot CI Pass Rate ≥ 0.8).
 */
export interface IEvalDefinition {
  readonly name?: string;
  readonly cases: readonly IEvalCase[];
  readonly metrics: readonly IMetric[];
  readonly threshold?: number;
}

/** One metric's outcome for one case: the raw score and its `[0, 1]`-normalized value. */
export interface IEvalMetricScore {
  readonly metric: string;
  readonly score: number | boolean;
  readonly normalized: number;
}

/** One case's outcome: each metric's score plus the case's mean normalized score. */
export interface IEvalCaseResult {
  readonly input: string;
  readonly scores: readonly IEvalMetricScore[];
  readonly caseScore: number;
}

/**
 * The eval report: per-case results, the aggregate `overallScore` (mean of every case×metric normalized score),
 * the resolved `threshold`, and the overall `passed` verdict (`overallScore >= threshold`). This verdict is what
 * the `robota eval` CI gate (P2) maps to a process exit code.
 */
export interface IEvalReport {
  readonly name?: string;
  readonly results: readonly IEvalCaseResult[];
  readonly overallScore: number;
  readonly threshold: number;
  readonly passed: boolean;
}

/**
 * The injected run function: produce a run result for one case input. The library defines NO provider and NO
 * agent config — the caller supplies this (the default is built from `createAgentRuntime().createSession()`,
 * capturing the terminal `complete`-event `IExecutionResult`; see `createSessionRunFn`).
 */
export type TEvalRunFn = (input: string) => Promise<IExecutionResult>;
