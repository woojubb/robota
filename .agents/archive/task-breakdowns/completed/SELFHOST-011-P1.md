# SELFHOST-011 P1 — neutral `agent-framework/src/evals/` definition API + runner (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-011-evals-as-code.md`](../spec-docs/active/SELFHOST-011-evals-as-code.md)
(EPIC; P1 = this slice; design-gated GATE-APPROVAL ENDORSE iteration 2). Mirror the pure `src/self-hosting/` +
`src/goal/` subsystem template and the `agent-session-analytics` metrics-over-a-run sibling. Neutral: NO concrete
metric or dataset **content** in `packages/`. Commit per logical slice (commit-cadence).

## Design (approved, P1)

- **agent-framework `src/evals/eval-types.ts`** (new): pure contracts —
  - `IMetric` = `{ name: string; score(result: IExecutionResult): number | boolean }` — a metric is a **pure
    function over the SSOT run-result** `IExecutionResult` (`@robota-sdk/agent-interface-transport`,
    re-exported via `interactive/types.js` like `query.ts`), scoring response + `toolSummaries` + `usage` +
    `history` — NOT just the response string (Alternative 4 REJECTED).
  - `IEvalCase` = `{ input: string; expected?: string }`.
  - `IEvalDefinition` = `{ name?: string; cases: IEvalCase[]; metrics: IMetric[]; threshold?: number }` —
    `threshold` is the aggregate mean-score bar in `[0, 1]` (default `1`); a `boolean` score normalizes to
    `1`/`0`, so for boolean metrics the aggregate IS the pass rate (the dominant prior-art shape, e.g.
    One-Shot CI Pass Rate ≥ 0.8).
  - `IEvalMetricScore` = `{ metric: string; score: number | boolean; normalized: number }`,
    `IEvalCaseResult` = `{ input; scores: IEvalMetricScore[]; caseScore: number }`,
    `IEvalReport` = `{ name?; results: IEvalCaseResult[]; overallScore: number; threshold: number; passed: boolean }`.
- **agent-framework `src/evals/runner.ts`** (new): pure behavior, IO-free / provider-free —
  - `defineEval(def): IEvalDefinition` — validate (non-empty `cases`, non-empty `metrics`, `threshold` in
    `[0,1]`) + normalize (`threshold ?? 1`).
  - `runEval(def, runFn): Promise<IEvalReport>` — `runFn: (input: string) => Promise<IExecutionResult>` is
    **injected**. Runs each case through `runFn`, applies each metric to the resulting `IExecutionResult`,
    normalizes boolean→1/0, computes `caseScore` = mean of a case's normalized metric scores, `overallScore`
    = mean over all case×metric normalized scores, `passed = overallScore >= threshold`.
  - The **default `runFn`** (a small helper, e.g. `createSessionRunFn(runtime, opts)`) is built from
    `createAgentRuntime().createSession()`, capturing that session's terminal **`complete`-event**
    `IExecutionResult` (the full result — NOT `createQuery`, which resolves only to `result.response`, a
    `string`, dropping `toolSummaries`/`usage`/`history`). The consumer owns provider/agent config → the
    library stays neutral.
- **agent-framework `src/evals/index.ts`** (new): barrel (values then `export type`), mirror
  `src/self-hosting/index.ts`.
- **agent-framework `src/index.ts`**: re-export a `// ── Evals ──` block (mirror the Goal/Self-Hosting blocks).
- **No `agent-interface-transport` change for P1** — the eval report is a pure library return value, not
  persisted or sent over transport in this slice (a `usage_report`-style carrier is a P2 concern only if the
  CLI needs it as a `TServerMessage`).

## Status

**DONE (2026-07-19).** S1–S4 implemented + green; TC-01/TC-02/TC-06 satisfied (8 unit tests, injected fake
`runFn` + synthetic `IExecutionResult`). agent-framework 1207 tests, typecheck, lint (0 evals warnings),
57/57 harness scans. See the spec's Evidence Log `[P1 IMPLEMENTED]` entry. TC-03/TC-04/TC-05 + the agent-run
capability verification are pending P2/P3 per the capability-reachability rule.

## Slices (each green + committed)

1. **S1 — pure contracts** `src/evals/eval-types.ts` (mirror the self-hosting/goal type modules).
2. **S2 — runner** `src/evals/runner.ts` (`defineEval` + `runEval` over an injected `runFn`) (TC-01/TC-02).
3. **S3 — default `runFn` helper** built from `createAgentRuntime().createSession()` capturing the
   `complete`-event `IExecutionResult` (TC-06); NOT `createQuery`.
4. **S4 — barrel + root re-export** (`src/evals/index.ts` + `// ── Evals ──` block) + agent-framework SPEC.md
   note.

## Test Plan

Unit (vitest), no live provider — inject a fake `runFn` returning a synthetic `IExecutionResult`:

- **TC-01** `runEval` runs every case, applies each metric, returns per-case scores + overall pass/fail vs threshold.
- **TC-02** metric = pure fn over `IExecutionResult` (scores response + `toolSummaries` + `usage`, not just the
  string); `runEval` is IO-free/provider-free given an injected `runFn` (mirrors `agent-session-analytics` purity).
- **TC-06** the default `runFn` seam reaches the agent through `createAgentRuntime().createSession()` capturing the
  `complete`-event `IExecutionResult` — the library defines no provider/agent config (unit on the injected-`runFn`
  seam; default `runFn` constructed by the caller). NOT built from `createQuery`.
  Regression: `pnpm --filter @robota-sdk/agent-framework test`, typecheck, lint, `pnpm harness:scan`.

## P1 scope boundary + capability-reachability (per `.agents/rules/backlog-execution.md`)

P1 ships the **neutral SDK library seam only** (definition API + runner over an injected `runFn`). The
user-facing capability — `robota eval` producing a real coding-agent run's `IExecutionResult`, scoring it, and
**exit-coding CI on a metric breach** — first becomes **surface-reachable at P2** (`agent-cli`
`robota eval` + `HeadlessInteractionChannel`). Per the capability-reachability rule (a capability is not done
until surface-reachable AND agent-run-verified), the **AGENT-RUN verification is a required P2 / epic-close
deliverable**: drive a real coding agent through `robota eval` on a real definition, confirm exit 1 on a failing
metric and exit 0 on pass, and save the run as scenario evidence under `.agents/evals/scenarios/`. P1's done-gate
is the library slice (TC-01/02/06 unit); TC-03 (CLI exit contract), TC-04 (example), TC-05 (neutrality floor) and
the agent-run verification are named here as pending P2/P3 work, not silently deferred.
