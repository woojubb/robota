---
title: 'INFRA-141: make multi-task AGREEMENT conversion atomic across commit ordering and issue handoff'
issue: https://github.com/woojubb/robota/issues/2484
status: done
created: 2026-08-29
completed: 2026-08-29
priority: critical
urgency: now
area: issue-to-backlog, user-execution plan order, GitHub issue triage
depends_on: []
---

# INFRA-141: make multi-task AGREEMENT conversion atomic across commit ordering and issue handoff

## Objective

Make the repository's mandated multi-cause Issue → AGREEMENT conversion one mechanically valid and
unambiguous work unit. The same single-Task assumption currently breaks two required paths:

- `scan-user-execution-plan-order.mjs --staged` rejects the AGREEMENT parent/spec plus its declared
  child Task records as multiple planning units, but a parent-only prelude fails the AGREEMENT child
  resolution invariant.
- `github-issue-triage.mjs audit` sees every child source citation and can select a child as the issue
  authority even after the handoff marker names the AGREEMENT parent.

The outcome is not a hook bypass or a relaxation for unrelated Tasks. It is an explicit atomic
conversion shape: one exact-basename AGREEMENT parent/spec pair, its declared new todo child Task
records and exact projections, and the parent marker as canonical issue authority.

## Plan

- [x] Specify the admissible AGREEMENT conversion manifest and reject undeclared, pre-existing,
      nested-AGREEMENT, non-todo, or implementation paths.
- [x] Add RED fixtures proving the current staged scanner rejects the valid atomic conversion and the
      current triage audit selects a child instead of the marker-owned parent.
- [x] Update planning-order classification to accept only the validated parent/spec + declared child
      creation shape while preserving single-work-unit and clean-worktree enforcement.
- [x] Update issue handoff discovery to prefer the read-back marker's canonical Task and report
      ambiguous/mismatched source citations rather than choosing by traversal order.
- [x] Verify the real stashed issue #1987 conversion can commit and audit as `AGREEMENT-004`, then
      restore issue #1987's handoff authority.

## Result

- The shared staged/history guard accepts only one newly added exact-basename AGREEMENT parent/spec
  and its exact newly added todo child projection, both in the proposed index and after the same
  transaction becomes a commit; named negative fixtures cover every rejected manifest class.
- GitHub audit collects every Task citation and resolves a unique exact AGREEMENT parent marker;
  missing, conflicting, child, nested, or child-set-mismatched markers fail as malformed.
- The preserved issue #1987 manifest produced zero staged findings and its five live candidates
  resolved to `AGREEMENT-004` with no audit problem, without adding issue #1987 files to this branch.
- A stage→commit fixture proves the same atomic manifest passes staged validation and post-commit
  history replay; targeted tests, the full 6,584-test harness suite, affected scans, and full scans
  passed.

## Constraints

- Do not permit unrelated Task files, existing child rewrites, implementation paths, or more than one
  AGREEMENT parent in the atomic prelude.
- Every declared child must be a newly added non-AGREEMENT Task in `todo`, cite the same source issue,
  and appear exactly once in both parent projections.
- A marker/source-citation mismatch must be visible and fail closed; iteration order is never authority.
- Preserve the existing one-Task/one-PR rule after the conversion checkpoint.

## Test Plan

- Unit/Git fixtures for valid and invalid staged AGREEMENT conversion manifests plus post-commit
  history replay of the same valid transaction.
- Triage audit fixtures for canonical parent marker, child citations, missing marker, conflicting marker,
  and single-Task conversions.
- RED proof that the pre-fix history path rejects a staged-valid committed manifest, then GREEN after
  both paths share the strict validator.
- `pnpm harness:scan`, affected harness tests, and CI-equivalent verification before merge.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable — this changes repository governance/harness behavior rather than a Robota product
surface. The exact staged Git fixture, CLI audit fixture, and restored issue #1987 conversion are
recorded as engineering verification evidence in the Test Plan.
