---
title: 'BRANCH-2664: make stacked child ancestry publishable under pre-push branch hygiene'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: medium
urgency: soon
area: repository branch policy and multi-backlog initiative orchestration
depends_on: []
---

# BRANCH-2664: make stacked child ancestry publishable under pre-push branch hygiene

## Objective

Make the supported multi-backlog child-branch route compatible with pre-push branch hygiene. A child
must be publishable while preserving the actual integration-parent ancestry that defines its review
base; an equal-tree synthetic replacement is not an acceptable substitute because it widens the
three-dot diff and invalidates the base-bound review.

This Task records a foundational process defect discovered while integrating `RULE-2582`. It does
not authorize bypassing hooks, hiding merge commits, or weakening review scope.

## Plan

- [ ] Reproduce the refusal with a child stacked on an integration parent that contains merged child PRs.
- [ ] Establish one authoritative branch-base model shared by multi-backlog orchestration, local review,
      pre-push verification, and PR creation.
- [ ] Add regression coverage proving valid stacked ancestry is publishable and foreign ancestry remains refused.
- [ ] Migrate the active `AGREEMENT-2664` continuation to the corrected route without widening child diffs.

## Evidence

- Issue record: https://github.com/woojubb/robota/issues/2664#issuecomment-5747691655
- The real parent is `origin/fix/2664-gate-correctness@153a3a412ade7212cae15d9d475b6da47d68c58f`
  and contains merge commits from PRs #2757 and #2758; pre-push rejects those commits because they are
  not ancestors of `origin/develop@f05926ecac6d25ddca74c58aaf6eead8b4dff219`.
- The rejected synthetic replacement at local head
  `67861dfa7b575f2f017e61f58fe1bdca3e052171` preserves the final tree but moves the merge base to
  `origin/develop`, expanding the three-dot review scope from 12 child paths to 27 aggregate paths.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal branch, review-base, and pre-push orchestration. It has no
runnable Robota product surface that an end user can execute; its observable contract belongs in
harness integration tests and a real stacked-branch push verification.
