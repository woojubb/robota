---
title: 'AGREEMENT-010: coordinate the remote-control host extraction'
issue: https://github.com/woojubb/robota/issues/2071
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: remote-control reducer, ports, trust repositories, and CLI host wiring
depends_on: [RULE-023]
children: [REMOTE-015, REMOTE-016, REMOTE-017, REMOTE-018]
---

# AGREEMENT-010: coordinate the remote-control host extraction

## Objective

Coordinate remote-control reducer, ports, trust repositories, and CLI host wiring as one exact Issue-to-Task migration graph rooted in [issue #2071](https://github.com/woojubb/robota/issues/2071). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] REMOTE-015 — todo — `.agents/tasks/REMOTE-015-extract-the-pure-remote-control-host-state-reducer.md`
- [ ] REMOTE-016 — todo — `.agents/tasks/REMOTE-016-define-the-remote-control-host-facade-and-effect-ports.md`
- [ ] REMOTE-017 — todo — `.agents/tasks/REMOTE-017-implement-node-identity-and-trusted-device-repository-adapters.md`
- [ ] REMOTE-018 — todo — `.agents/tasks/REMOTE-018-wire-the-host-service-into-cli-and-delete-the-controller.md`

## Plan

- [ ] TC-01 — Land every declared child Task atomically with exact source Issue identity.
- [ ] TC-02 — Preserve native dependency order and every external prerequisite.
- [ ] TC-03 — Freeze exact row-level marker, label, body, and terminal-state mutations before apply.
- [ ] TC-04 — Apply the homogeneous rows in one batch and preserve the complete parent map, body prefixes, assignees, history, and relationships.
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
