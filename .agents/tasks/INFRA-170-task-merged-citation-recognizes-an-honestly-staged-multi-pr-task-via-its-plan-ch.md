---
title: 'INFRA-170: task-merged-citation recognizes an honestly staged multi-PR Task via its Plan checklist'
issue: https://github.com/woojubb/robota/issues/2586
status: todo
created: 2026-09-05
priority: medium
urgency: soon
area:
  - scripts/harness/scan-task-merged-citation.mjs
depends_on: []
---

# INFRA-170: task-merged-citation recognizes an honestly staged multi-PR Task via its Plan checklist

## Objective

`scan-task-merged-citation.mjs` fails on `develop` under `--context integration`: STRUCT-012
(`.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`) is a large,
owner-directed, five-unit (S1–S5) refactor. S1 and S2 are complete and merged; S3–S5 are not started,
and the owner explicitly directed stopping after the S2 delivery until they resume. The `in-progress`
status is accurate. The scan's own header comment anticipates a Task spanning several pull requests,
but its only mechanism for one — `LEGACY_BASELINE` — is explicitly closed to new entries ("Records
already in this state when the scan was adopted... No additions."), so an honestly staged task has no
way to stay green short of lying about its status or landing every unit in one shot.

The repository's own convention already tags which unit a commit delivers — the merged commit reads
`feat(harness): arm the name-derived FAMILY-SIBLINGS dependency gate (STRUCT-012 S1)` — and the Task's
own Plan checklist already marks that unit `- [x] S1 — ...`. The fix teaches the scanner to read both:
a delivering commit citing a Plan unit the record itself already marks complete is staged, honest
progress, not a premature-completion claim, and does not reconcile as a finding. A commit citing the
bare ID with no unit suffix, or a unit still unchecked, is unaffected and still reconciles (issue
#2586).

## Plan

- [x] Add `citedUnitOf(subject, id)` — the unit token cited alongside a work-item ID inside its own
      parenthetical (`S1` in `(STRUCT-012 S1)`), null for a bare-ID or outside-parens citation.
- [x] Add `completedPlanUnits(content)` — the set of unit tokens a Task's own body marks `- [x]`.
- [x] In `findTaskMergedCitationFindings`, filter `delivering` commits down to `unreconciled` ones
      whose cited unit (if any) is not already in the record's `completedPlanUnits`, and report only
      those.
- [x] Add fixture tests: a completed-unit citation does not reconcile; a still-unchecked-unit citation
      still reconciles; a bare-ID citation (no unit suffix) still reconciles; direct unit tests for
      `citedUnitOf` and `completedPlanUnits`.
- [x] Run the real scan against this clone and confirm STRUCT-012 no longer appears in findings while
      the 16 pre-existing frozen-baseline notices are unaffected.

## Completion Criteria

- TC-01: Command — `pnpm exec vitest run scripts/harness/__tests__/scan-task-merged-citation.test.mjs`
  — all tests (existing 6 plus the 4 new ones) pass.
- TC-02: Command — `node scripts/harness/scan-task-merged-citation.mjs` on this clone — exits 0,
  reports `task-merged-citation scan passed.`, and the 16 frozen-baseline notice is unchanged.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                           | Notes                                    |
| ----- | --------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| TC-01 | automated | `vitest run scripts/harness/__tests__/scan-task-merged-citation.test.mjs` | red-first: completed/uncompleted/bare-ID |
| TC-02 | automated | `node scripts/harness/scan-task-merged-citation.mjs`                      | real-history regression proof on develop |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository integration scan judging commit history against Task records, not a
product surface. No end user runs it; only the harness's own CI mirror and `pnpm harness:scan` do, and
the corrected behavior is exercised by the fixture tests and the real-history run above.
