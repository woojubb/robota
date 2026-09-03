---
title: 'AGREEMENT-009: coordinate the kind-safe background-task migration'
issue: https://github.com/woojubb/robota/issues/2062
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: background task requests, runners, persisted state, and command views
depends_on: [RULE-023]
children: [DATA-010, ARCH-117, DATA-011]
---

# AGREEMENT-009: coordinate the kind-safe background-task migration

## Objective

Coordinate background task requests, runners, persisted state, and command views as one exact Issue-to-Task migration graph rooted in [issue #2062](https://github.com/woojubb/robota/issues/2062). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] DATA-010 — todo — `.agents/tasks/DATA-010-define-the-kind-indexed-background-task-contract-map.md`
- [ ] ARCH-117 — todo — `.agents/tasks/ARCH-117-type-the-runner-registry-and-migrate-background-runners.md`
- [ ] DATA-011 — todo — `.agents/tasks/DATA-011-migrate-persisted-background-state-and-command-views-to-kind-safe-variants.md`

## Plan

- [ ] TC-01 — Land every declared child Task atomically with exact source Issue identity.
- [ ] TC-02 — Preserve native dependency order and every external prerequisite.
- [ ] TC-03 — Freeze exact row-level marker, label, body, and terminal-state mutations before apply.
- [ ] TC-04 — Apply the homogeneous rows in one batch and preserve the complete parent map, body prefixes, assignees, history, and relationships.
- [ ] TC-05 — Reconcile the whole group once after writes and keep product Tasks open until implementation.

## Test Plan

- Execute the administrative migration as one bounded batch and reconcile it once after all authorized writes.
- Validate the complete parent/child projection and exact source Issue URL for every Task.
- Compare frozen and post-write marker, label, state, body-prefix, hierarchy, dependency, and assignee fields once for the whole group.
- Run affected repository scans after the complete group evidence update.

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.
