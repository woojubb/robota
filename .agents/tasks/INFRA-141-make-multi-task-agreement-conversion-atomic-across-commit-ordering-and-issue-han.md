---
title: 'INFRA-141: make multi-task AGREEMENT conversion atomic across commit ordering and issue handoff'
issue: https://github.com/woojubb/robota/issues/2484
status: todo
created: 2026-08-29
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

- [ ] Specify the admissible AGREEMENT conversion manifest and reject undeclared, pre-existing,
      nested-AGREEMENT, non-todo, or implementation paths.
- [ ] Add RED fixtures proving the current staged scanner rejects the valid atomic conversion and the
      current triage audit selects a child instead of the marker-owned parent.
- [ ] Update planning-order classification to accept only the validated parent/spec + declared child
      creation shape while preserving single-work-unit and clean-worktree enforcement.
- [ ] Update issue handoff discovery to prefer the read-back marker's canonical Task and report
      ambiguous/mismatched source citations rather than choosing by traversal order.
- [ ] Verify the real stashed issue #1987 conversion can commit and audit as `AGREEMENT-004`, then
      restore issue #1987's handoff authority.

## Constraints

- Do not permit unrelated Task files, existing child rewrites, implementation paths, or more than one
  AGREEMENT parent in the atomic prelude.
- Every declared child must be a newly added non-AGREEMENT Task in `todo`, cite the same source issue,
  and appear exactly once in both parent projections.
- A marker/source-citation mismatch must be visible and fail closed; iteration order is never authority.
- Preserve the existing one-Task/one-PR rule after the conversion checkpoint.

## Test Plan

- Unit fixtures for valid and invalid staged AGREEMENT conversion manifests.
- Triage audit fixtures for canonical parent marker, child citations, missing marker, conflicting marker,
  and single-Task conversions.
- RED proof against the pre-fix implementation, then GREEN after restoration.
- `pnpm harness:scan`, affected harness tests, and CI-equivalent verification before merge.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable — this changes repository governance/harness behavior rather than a Robota product
surface. The exact staged Git fixture, CLI audit fixture, and restored issue #1987 conversion are
recorded as engineering verification evidence in the Test Plan.
