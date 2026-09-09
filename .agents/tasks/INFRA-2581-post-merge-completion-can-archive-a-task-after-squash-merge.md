---
title: 'INFRA-2581: post-merge completion can archive a task after squash merge'
issue: https://github.com/woojubb/robota/issues/2581
status: in-progress
created: 2026-09-10
priority: high
urgency: now
area:
  - harness plan-order scan
  - post-merge lifecycle ledger
  - Task/spec archival
depends_on: []
---

# INFRA-2581: post-merge completion can archive a task after squash merge

## Objective

Allow the mandatory Task/spec completion commit to be made after a delivering PR was squash-merged
into `develop`. The plan-order guard must recognize a completion-only archival commit when it is bound
to a verified post-merge ledger record and a fully evidenced Task/spec pair, while continuing to reject
partial, unbound, or implementation-mixed archival changes.

## Spec

`.agents/spec-docs/active/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md`

## Plan

- [ ] TC-01 — capture the fresh-`origin/develop` squash-merge archival reproduction and define the
      accepted path/evidence shape plus negative cases.
- [ ] TC-02 — implement the narrow post-merge completion classifier in the plan-order scan and add
      regression coverage for staged and committed history.
- [ ] TC-03 — run the affected harness scans and the focused regression suite, then archive the
      already-delivered SECURITY-2465 Task/spec through the newly accepted closeout path.

## Completion Criteria

- [ ] TC-01: A fresh branch from `origin/develop` can stage the exact SECURITY-2465 Task/spec archive
      with one append-only verified PR merge ledger record, and the scan distinguishes it from a
      partial archive or a commit containing implementation paths.
- [ ] TC-02: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` and its committed
      history mode accept the bounded post-merge closeout shape and reject an unbound or incomplete
      terminalization.
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      and `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exit 0.

## Test Plan

- TC-01: Reproduce the fresh-origin/develop closeout in a hermetic Git fixture and verify acceptance
  of the exact archive plus ledger while rejecting partial, unbound, and implementation-mixed shapes.
- TC-02: Run the focused plan-order Vitest suite against staged and committed-history fixtures.
- TC-03: Run the affected harness scan after the implementation and completion archival are staged.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes only repository governance and CI-side history classification; it adds no
new CLI, TUI, browser, SDK, or other runnable product behavior for an end user to execute directly.
