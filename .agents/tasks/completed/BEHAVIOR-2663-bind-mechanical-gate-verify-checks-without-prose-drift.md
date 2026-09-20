---
title: 'BEHAVIOR-2663: Bind mechanical GATE-VERIFY checks without prose drift'
issue: https://github.com/woojubb/robota/issues/2663
status: done
created: 2026-09-20
completed: 2026-09-20
priority: high
urgency: now
area: scripts/harness gate catalogue bindings
depends_on: [BEHAVIOR-2664]
---

# BEHAVIOR-2663: Bind mechanical GATE-VERIFY checks without prose drift

## Objective

Bind the two Task-plan GATE-VERIFY criteria to their mechanical evaluators through a stable catalogue
identity, so editorial wording changes cannot silently route decidable checks to a guardian.

Spec: `.agents/spec-docs/done/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`

## Plan

- [x] TC-01 — Reproduce both current catalogue sentences and prove the intended evaluators run.
- [x] TC-02 — Introduce or consume a stable criterion identity without duplicating catalogue policy.
- [x] TC-03 — Fail closed when a mechanical criterion has no registered evaluator.
- [x] TC-04 — Run gate catalogue, gate evaluator, and Task-plan focused tests plus affected scans.

## Test Plan

Use focused catalogue/evaluator fixtures that vary criterion prose while preserving the stable identity,
then mutate or omit the identity to prove fail-closed behavior. Run the relevant gate and Task-plan
Vitest files and affected harness verification.

## Progress

- RED: the four BEHAVIOR-2663 regression cases failed against the pre-fix implementation while the
  existing 110 focused gate tests passed.
- GREEN: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` passes all 115 tests,
  including the correction regression for explanatory prose after a stable-ID annotation.
- Repository verification: the affected PR-context scan passes 62 checks with one intentional skip;
  its two advisories predate and do not overlap this change.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes private repository gate routing and has no Robota CLI, TUI, browser, public
SDK, or installed-package interaction that an end user can execute.
