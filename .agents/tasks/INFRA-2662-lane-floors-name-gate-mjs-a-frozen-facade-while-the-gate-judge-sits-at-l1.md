---
title: 'INFRA-2662: Lane floors name gate.mjs, a frozen facade, while the gate judge sits at L1'
issue: https://github.com/woojubb/robota/issues/2662
status: todo
created: 2026-09-07
priority: medium
urgency: soon
area: harness governance
depends_on: []
---

# INFRA-2662: Lane floors name gate.mjs, a frozen facade, while the gate judge sits at L1

## Objective

Align the L2 lane floor with the actual gate-judging module family so changes to gate evaluation and
approval records cannot enter through the delegated L0/L1 approval class. The change remains limited to
the lane-floor rule and its regression test; the gate scanner implementation and unrelated enforcement
surfaces are not changed.

## Plan

- [ ] TC-01 — Add the live-rule regression covering all matching gate modules and excluding neighbouring
      scans, then prove the test goes red when the approved rule row is reverted.
- [ ] TC-02 — Run the affected harness scan set on the approved rule/test pair and record its exit code.
- [ ] TC-03 — Run the complete `scan-lane-declaration` test file and record its exit code.
- [ ] TC-04 — Run the end-to-end lane declaration refusal for a changed `gate-operations.mjs` path with
      `Lane: L1`, confirming the output names the L2 floor.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository governance and lane admission only. It is not shipped through the
SDK, runtime, CLI, TUI, browser UI, or public example surface, so an end user cannot observe it through
a product interaction; the internal scanner refusal is covered by the engineering Test Plan.

## Test Plan

- Focused: `pnpm exec vitest run scripts/harness/__tests__/scan-lane-declaration.test.mjs`.
- Affected harness set: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`.
- End to end: `node scripts/harness/scan-lane-declaration.mjs` against a changed
  `scripts/harness/gate-operations.mjs` diff with `Lane: L1`, expecting non-zero output naming the L2 floor.
