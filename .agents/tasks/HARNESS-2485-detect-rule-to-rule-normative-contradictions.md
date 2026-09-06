---
title: 'HARNESS-2485: detect rule-to-rule normative contradictions'
issue: https://github.com/woojubb/robota/issues/2485
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: scripts/harness, .agents/rules
depends_on: []
---

# HARNESS-2485: detect rule-to-rule normative contradictions

## Objective

Detect cross-rule normative claims that share a normalized subject and predicate but differ in modal
strength or polarity. Keep the detector intentionally structural and fail-closed so it reports only
claims it can compare, with line-level evidence and a reviewed inline suppression for intentional
exceptions. This is the fresh executable Task for issue #2485; the archived HARNESS-072 record is
historical and remains skipped.

## Plan

- [x] TC-01: Add the claim extractor/comparator and register the fail-closed scan.
- [x] TC-02: Add red-proof and regression tests for weaker, negated and suppressed pairs.
- [x] TC-03: Run the affected scan/test gate and archive the Task with the paired spec.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs`
- `node scripts/harness/scan-rule-contradictions.mjs`
- `pnpm harness:scan -- --context pr --skip dist --skip build-contracts`

## Progress

- 2026-09-06 — Added the structural cross-rule claim comparator, inline suppression handling, and
  registry entry; focused tests and the real rule corpus pass.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change adds repository governance only: it reads `.agents/rules/*.md` during the
harness scan and changes no product package, CLI command, API, or user-facing runtime surface.
