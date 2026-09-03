---
title: 'AGREEMENT-016: coordinate the throughput child-Issue dispositions'
issue: https://github.com/woojubb/robota/issues/2512
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: verification receipt reuse and independent gate parallelism
depends_on: [RULE-023]
children: [INFRA-154]
---

# AGREEMENT-016: coordinate the throughput child-Issue dispositions

## Objective

Coordinate verification receipt reuse and independent gate parallelism as one exact Issue-to-Task migration graph rooted in [issue #2512](https://github.com/woojubb/robota/issues/2512). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] INFRA-154 — todo — `.agents/tasks/INFRA-154-reuse-final-tree-verification-receipts-and-parallelize-independent-gates.md`

## Plan

- [ ] TC-01 — Land every declared child Task atomically with exact source Issue identity.
- [ ] TC-02 — Preserve native dependency order and every external prerequisite.
- [ ] TC-03 — Freeze exact row-level marker, label, body, and terminal-state mutations before apply.
- [ ] TC-04 — Apply the homogeneous rows in one batch and preserve all Issue history and relationships.
- [ ] TC-05 — Reconcile the whole group once after writes and keep product Tasks open until implementation.

## Test Plan

- Validate the complete parent/child projection and exact source Issue URL for every Task.
- Compare frozen and post-write marker, label, state, body-prefix, hierarchy, dependency, and assignee fields once for the whole group.
- Run affected repository scans after the complete group evidence update.

- Execute the administrative migration as one bounded batch and reconcile it once after all authorized writes.

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.
