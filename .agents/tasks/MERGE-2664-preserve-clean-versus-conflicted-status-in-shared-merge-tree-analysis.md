---
title: 'MERGE-2664: Preserve clean versus conflicted status in shared merge-tree analysis'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: medium
urgency: soon
area: harness git merge attribution
depends_on: []
---

# MERGE-2664: Preserve clean versus conflicted status in shared merge-tree analysis

## Objective

Preserve Git's clean-versus-conflicted merge result as first-class data in the shared plan-order
merge attribution abstraction. A committed conflict-marker tree must never become indistinguishable
from a clean automatic merge merely because both have the same tree object.

This root item was found while BRANCH-2664 added fail-closed integration-history checks. The bounded
BRANCH-2664 containment rejects conflicted integration merges at its call site; this Task owns the
shared correction across existing committed-merge and staged-merge callers without changing their
established attribution semantics accidentally.

## Plan

- [ ] Characterize every caller of `automaticMergeTree` and `mergeOwnPaths`, including staged merges.
- [ ] Return both the merge tree identity and clean/conflicted status from the shared abstraction.
- [ ] Make each caller state whether conflicts are admissible and how manual resolutions are attributed.
- [ ] Add clean, manually resolved, and persisted conflict-marker regression fixtures for every caller class.
- [ ] Remove the BRANCH-2664 call-site containment only after the shared contract lands and stays green.

## Evidence

- Finding record: https://github.com/woojubb/robota/issues/2664#issuecomment-5747991049
- Foundational depth verdict during BRANCH-2664 retained-reviewer convergence on 2026-09-20.
- `git merge-tree --write-tree` exits 1 while still printing a conflict-marker tree; the current helper
  reduces exit 0 and exit 1 to the same tree-only value.
- Root implementation predates BRANCH-2664 in commit `0c4491a10`; the helper is shared by committed
  history and staged-merge analysis, so changing all callers belongs in a separate planned unit.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal Git history attribution used by harness checks and has no
runnable Robota product surface; observable behavior is covered by executed temporary-repository
fixtures for clean, conflicted, and manually resolved merges.
