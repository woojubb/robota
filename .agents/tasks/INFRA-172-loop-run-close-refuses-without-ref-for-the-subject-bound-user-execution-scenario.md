---
title: 'INFRA-172: loop-run close refuses without --ref for the subject-bound user-execution-scenario ledger'
issue: https://github.com/woojubb/robota/issues/2587
status: todo
created: 2026-09-05
priority: medium
urgency: soon
area:
  - scripts/harness/loop-run.mjs
depends_on: []
---

# INFRA-172: loop-run close refuses without --ref for the subject-bound user-execution-scenario ledger

## Objective

`closeRun` in `scripts/harness/loop-run.mjs` accepted `ref = null` unconditionally for every loop it
manages. That default is correct for the other ~14 loop skills under `.agents/skills/*/SKILL.md` —
none of them are subject-bound by any scan. Only the `user-execution-scenario` ledger is: per
`scan-user-execution-plan-order.mjs`'s own `UES_LEDGER` special case, its closed records are
subject-bound to the exact paired Task. Closing that one loop without `--ref` used to succeed silently
and seal the record with `ref: null` — unamendable (a closed record is never amended; a new run is
opened instead) and unusable as the checkpoint the plan-order gate requires. The fix refuses that close
outright, naming the missing flag, instead of sealing a record that can never satisfy the gate it was
opened for (issue #2587).

## Plan

- [x] Add `REF_REQUIRED_SKILLS` (currently just `user-execution-scenario`) to `loop-run.mjs` and refuse
      `closeRun` for a listed skill when `ref` is null or blank, before the ledger is written.
- [x] Add a fixture test proving the refusal fires for `user-execution-scenario` and that closing with
      a real ref still succeeds and is not left sealed by the refused attempt.
- [x] Add a fixture test proving every other loop kind is unaffected — still closes with no `--ref`.

## Completion Criteria

- TC-01: Command — `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` — the new
  `user-execution-scenario` refusal and unaffected-siblings tests pass alongside the existing 34.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                          | Notes                                        |
| ----- | --------- | -------------------------------------------------------- | -------------------------------------------- |
| TC-01 | automated | `vitest run scripts/harness/__tests__/loop-run.test.mjs` | red-first: refusal, then unaffected siblings |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository commit-ordering guard consumed by the pre-commit/pre-push planning
checkpoint, not a product surface. No end user runs `loop-run.mjs` directly; only an authoring session
following a skill does, and the refused/accepted behavior is exercised by the fixture tests above.
