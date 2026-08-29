---
title: 'RULE-020: Require a published ground after a review findings verdict'
issue: https://github.com/woojubb/robota/issues/2477
status: in-progress
created: 2026-08-29
priority: high
urgency: immediate
area: RULE
depends_on: []
---

# RULE-020: Require a published ground after a review findings verdict

## Objective

Prevent repeated edits and pushes to an open pull request after any published review findings verdict
unless a head-bound, maintainer-approved reason is recorded on the pull request.

## Plan

- [x] Add the canonical latest-verdict comment grammar to the branch rule and review-loop skills.
- [x] Enforce the grammar in the pre-push hook for zero and non-zero verdicts.
- [x] Add focused regression coverage and run repository verification.

## Test Plan

- [x] Verify missing, stale-head, unapproved, and approved comment fixtures.
- [x] Verify direct finding, red-check, and rebase grounds remain explicit and auditable.
- [x] Run affected harness scans and the required CI-equivalent verification.

## User Execution Test Scenarios

Not applicable — this changes repository workflow enforcement, not a product-facing runtime surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this task changes repository workflow enforcement and has no
product-facing runtime scenario for a user to execute.

## Result

Implemented and verified; pending PR review and merge.
