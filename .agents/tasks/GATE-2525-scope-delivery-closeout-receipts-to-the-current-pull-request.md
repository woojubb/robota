---
title: 'GATE-2525: scope delivery closeout receipts to the current pull request'
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-21
priority: medium
urgency: now
area: post-merge delivery audit
depends_on: []
---

# GATE-2525: scope delivery closeout receipts to the current pull request

## Objective

Make the required closeout audit select the one delivery-completion receipt bound to the current pull
request while still refusing zero or multiple receipts for that same pull request. Repeated partial
deliveries on one umbrella Issue must not invalidate each other.

## Plan

- [ ] Add a regression reproducing `ambiguous-completion` from valid receipts for different pull
      requests on one umbrella Issue.
- [ ] Scope completion-receipt selection to the live pull request before enforcing uniqueness.
- [ ] Preserve missing, duplicate-for-the-same-PR, trust, edit, merge-parent, and issue-state refusals.
- [ ] Run the focused authorization and post-merge delivery suites plus affected harness scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes only the repository's internal post-merge evidence selector; it does not alter
or expose any Robota CLI, SDK, TUI, browser, protocol, or other runnable product behavior.
