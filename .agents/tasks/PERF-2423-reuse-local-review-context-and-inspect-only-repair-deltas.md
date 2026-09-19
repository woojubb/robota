---
title: 'PERF-2423: reuse local review context and inspect only repair deltas'
issue: https://github.com/woojubb/robota/issues/2423
status: in-progress
created: 2026-09-20
priority: medium
urgency: soon
area: .agents review orchestration, .claude reviewer agents, scripts/harness
depends_on: []
---

# PERF-2423: reuse local review context and inspect only repair deltas

## Objective

Reduce repeated local PR-review cost without weakening the review by preserving one
`pr-review-reviewer` context across repair rounds. The first round reviews the complete branch diff;
follow-up rounds verify the previous findings against source and inspect only the repair delta plus
changed tests. Keep the existing dynamic execution, regression RED-proof, and no-progress protections.

## Plan

- [ ] TC-01: Amend the execution-cadence rule and both local-review orchestrators to resume the same reviewer and pass only the previous-head repair delta after round one.
- [ ] TC-02: Give `pr-review-reviewer` an explicit follow-up contract that verifies prior findings from source and preserves dynamic/test-truthfulness checks.
- [ ] TC-03: Extend `scan-review-findings` with red-first coverage for reviewer continuity and delta scoping, then run its whole test file.
- [ ] TC-04: Run the affected harness scan suite in PR context.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No Robota command, SDK, screen, or runtime output changes; this only changes how repository agents conduct repeated local code-review rounds.
