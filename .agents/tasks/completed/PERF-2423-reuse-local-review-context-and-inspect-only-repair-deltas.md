---
title: 'PERF-2423: reuse local review context and inspect only repair deltas'
issue: https://github.com/woojubb/robota/issues/2423
status: done
created: 2026-09-20
completed: 2026-09-20
priority: medium
urgency: soon
area: .agents review orchestration, .claude reviewer agents, scripts/harness
depends_on: []
---

# PERF-2423: reuse local review context and inspect only repair deltas

Spec: `.agents/spec-docs/done/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md`

## Objective

Reduce repeated local PR-review cost without weakening the review by preserving one
`pr-review-reviewer` context across repair rounds. The first round reviews the complete branch diff;
follow-up rounds verify the previous findings against source and inspect only the repair delta plus
changed tests. Keep the existing dynamic execution, regression RED-proof, and no-progress protections.

## Plan

- [x] TC-01: Amend the execution-cadence rule and both local-review orchestrators to resume the same reviewer and pass only the previous-head repair delta after round one.
- [x] TC-02: Give `pr-review-reviewer` an explicit follow-up contract that verifies prior findings from source and preserves dynamic/test-truthfulness checks.
- [x] TC-03: Extend `scan-review-findings` with red-first coverage for reviewer continuity and delta scoping, then run its whole test file.
- [x] TC-04: Run the affected harness scan suite in PR context.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No Robota command, SDK, screen, or runtime output changes; this only changes how repository agents conduct repeated local code-review rounds.

## Results

- TC-01 — removing the two new local-orchestrator assertions made the focused test fail with the two
  missing-contract findings (exit 1); restoring them produced 2 passed tests (exit 0).
- TC-02 — the complete `scan-review-findings.test.mjs` file passed 20/20.
- TC-03 — the live scan passed and reported exactly 5 reviewed artifacts.
- TC-04 — the affected PR-context suite exited 0: 73 scans passed, 1 skipped, with the existing
  SCREEN-2002 merged-citation advisory tolerated as designed in PR context.
