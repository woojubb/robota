---
title: 'HARNESS-2724: remove the retired post-merge ledger requirement from plan-order completion'
issue: https://github.com/woojubb/robota/issues/2724
status: todo
created: 2026-09-15
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-2724: remove the retired post-merge ledger requirement from plan-order completion

## Objective

Complete the PROC-2724 TC-05 implementation by removing the stale requirement that a newly archived
post-merge Task/spec pair append `.agents/loop-runs/post-merge-cycle.jsonl`. Accept the canonical
GitHub completion receipt only when its PR merge commit is an actual ancestor of the topic base, while
retaining read compatibility for historical ledger-backed closeouts.

**Source:** [GitHub Issue #2724](https://github.com/woojubb/robota/issues/2724), reopened after the
current `origin/develop` reproduced the omitted plan-order path.

**Approved governing decision:** PROC-2724 TC-05 and its done spec require new post-merge runs to use
the GitHub `DELIVERY_COMPLETION_RECORD` without appending a tracked post-merge ledger row.

## Plan

- [ ] Add a regression fixture for a `verifying` source spec that archives with a GitHub completion
      receipt and no new post-merge ledger row; prove it RED against the current scanner.
- [ ] Make post-merge completion consume the archived Task Result's PR, merge ancestor, and issue-comment
      receipt while retaining the historical ledger route and bounded parent projections.
- [ ] Record the spec/code conformance pass, run only the focused post-merge scanner matrix and affected
      PR-context harness scan, then archive this Task/spec.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This correction changes only repository-maintainer commit validation and exposes no Robota
runtime, CLI, provider, API, or other product surface an end user can execute.
