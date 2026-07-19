---
title: 'HARNESS-034: mechanical neutrality floor — no eval dataset/metric CONTENT in packages/'
status: done
created: 2026-07-19
priority: medium
urgency: later
area: scripts
depends_on: ['SELFHOST-011']
---

## Resolution (2026-07-19)

Added `scripts/harness/scan-evals-neutrality.mjs`, registered in `run-all-scans.mjs` as `evals-neutrality`,
mirroring the `scan-memory-neutrality.mjs` convention (pure `findX(src, file)` + live `findX()` +
`allow-evals-content: <reason>` suppression with reason-less anti-rot):

- **Class 1 `evals-dataset-content`** (exact path/name, zero-FP): a `.json`/`.jsonl`/`.csv`/`.ya?ml` DATA file
  that is eval-corpus-shaped — under an `/evals/` dir segment, or a corpus-marked basename
  (`*.evalset.*`/`*.cases.*`/`*.dataset.*`).
- **Class 2 `library-eval-content`** (source, evals-subsystem-scoped): an `export` of a concrete
  metric/dataset VALUE — a `cases`/`dataset`/`evalset` array literal, a `: IEvalDefinition =` value, or a
  `: IMetric =` value. The neutral mechanism (the `IMetric` TYPE, the runner contract, and the parameterized
  FACTORIES declared `export function name(...): IMetric {`) is NOT matched.

Test `scripts/harness/__tests__/scan-evals-neutrality.test.mjs` (8 tests: TC-01 data-file class, TC-02
value class + neutral-surface negatives, TC-03 suppression + anti-rot, TC-04 live tree green). Live tree +
`run-all-scans` both green. Closes SELFHOST-011 P2 TC-05 (the manual-grep neutrality check is now mechanized).

# Mechanical neutrality floor for evals-as-code content (HARNESS-034)

## Problem

SELFHOST-011 (evals-as-code) ships a **neutral** library surface: `packages/agent-framework/src/evals/` holds
only the definition/runner contract + the metric-as-function type; concrete **metrics and datasets are
consumer-supplied** (the reference lives in `examples/capabilities/agent-eval/`, never in `packages/`). The
epic's own adversarial note (spec `## Validated Recommendation`) flags the primary risk: a contributor adding
concrete metric/dataset **content** into `packages/` (turning the neutral surface into a Mastra-style
opinionated one).

Per [enforcement-architecture.md](../rules/enforcement-architecture.md) — every guardian needs a mechanical
floor — this must not rest on review alone. Today TC-05 (neutrality) is a **manual grep**: no `pnpm harness:scan`
rule fences eval content in `packages/`.

## Scope

Add a scan (e.g. `scripts/harness/scan-evals-neutrality.mjs`, registered in `run-all-scans.mjs`) that flags
eval **content** shipped under `packages/`:

- a dataset/case-corpus file under a `packages/**/evals/` path (e.g. `*.evalset.json`, a `cases`/`dataset`
  file), or
- a concrete named metric implementation shipped as library content (as opposed to the neutral `IMetric`
  **type** + runner mechanism).

Mirror the existing neutrality-scan conventions (`scan-orchestration-neutrality.mjs`,
`scan-memory-neutrality.mjs`, `scan-no-fallback.mjs`): pure `findX(src, file)` + live `findX()` + an
`allow-evals-content: <reason>` suppression with reason-less anti-rot. Use `packages/<pkg>/src` (not
`packages/*/src`) to avoid the block-comment `*/` hazard.

## Done when

- The scan is registered in `run-all-scans.mjs` and green on the current tree (no eval content in `packages/`).
- Adding a dataset/metric-content file under `packages/**/evals` FAILS the scan; the neutral definition/runner
  - `IMetric` type do NOT.
- A unit test covers a positive (content) + negative (neutral surface) case.

## Notes

Filed as the TC-05 guardian for SELFHOST-011 P2. See the epic spec's `## Validated Recommendation` (Adversarial)
and `## Completion Criteria` TC-05. Follow the spec-gate.
