---
title: 'PROC-024: record RULE-023 continuation artifact declaration before the B2 gate'
issue: https://github.com/woojubb/robota/issues/2063
status: in-progress
created: 2026-08-30
priority: medium
urgency: now
area: workflow governance
depends_on: []
---

# PROC-024: record RULE-023 continuation artifact declaration before the B2 gate

## Objective

Make the approved RULE-023 B2 continuation mechanically reachable without changing its migration
semantics or mutating GitHub. Record the exact three persistent RULE-023 artifacts in its governing
Decision before a later branch attempts GATE-IMPLEMENT continuation.

## Plan

- [ ] TC-01 — add the exact three-artifact `Continuation artifacts` declaration to RULE-023 without
      changing any prior GATE-IMPLEMENT PASS bytes.
- [ ] TC-02 — prove this correction has its own approved checkpoint before the active RULE-023 spec
      changes and that staged/history plan-order scans pass.
- [ ] TC-03 — run affected harness scans and verify that no package/runtime or GitHub Issue state changes.

## Test Plan

- Run `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` and
  assert that the parser returns the exact three paths.
- Run `node scripts/harness/scan-user-execution-plan-order.mjs` against staged and committed transitions.
- Run `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this corrects repository-internal planning order and changes no runnable product
surface or GitHub Issue state.
