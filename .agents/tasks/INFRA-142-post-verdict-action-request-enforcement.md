---
title: 'INFRA-142: enforce post-verdict action requests on every PR update'
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: .claude/hooks/pre-push-check.sh, review-before-push tests
depends_on: []
no-issue: repository hook enforcement gap tracked by INFRA-142; no GitHub issue exists yet
---

# INFRA-142: enforce post-verdict action requests on every PR update

## Objective

Close the enforcement gap demonstrated by PR #2500: once a GitHub-actions review publishes
`ACTIONABLE FINDINGS: 0`, no subsequent push/rebase/merge may proceed without a matching, maintainer-
approved `POST_FINDINGS_ACTION_REQUEST` comment.

## Plan

- [ ] TC-01/TC-02: Reproduce the PR #2500 sequence and enforce exact request binding.
- [ ] TC-03: Fix the fail-open path and preserve valid pre-verdict behavior.
- [ ] TC-04: Verify focused regression tests for agent and Git hook boundaries.
- [ ] TC-05: Verify full scans and CI-equivalent checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this task changes repository workflow enforcement and has no
product-facing runtime scenario for a user to execute.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/review-before-push.test.mjs`
- `pnpm harness:scan`
- CI-equivalent verification after the L2 approval and implementation gates.
