---
title: 'AGREEMENT-011: coordinate the session-mobility handoff migration'
issue: https://github.com/woojubb/robota/issues/2073
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: handoff authority, refusal policy, orchestration, and protocol codecs
depends_on: [RULE-023]
children: [HANDOFF-002, HANDOFF-003, HANDOFF-004, HANDOFF-005]
---

# AGREEMENT-011: coordinate the session-mobility handoff migration

## Objective

Coordinate handoff authority, refusal policy, orchestration, and protocol codecs as one exact Issue-to-Task migration graph rooted in [issue #2073](https://github.com/woojubb/robota/issues/2073). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] HANDOFF-002 — todo — `.agents/tasks/HANDOFF-002-move-authority-transitions-into-session-mobility.md`
- [ ] HANDOFF-003 — todo — `.agents/tasks/HANDOFF-003-move-inventory-and-refusal-policy-into-session-mobility.md`
- [ ] HANDOFF-004 — todo — `.agents/tasks/HANDOFF-004-move-source-and-destination-orchestration-into-session-mobility.md`
- [ ] HANDOFF-005 — todo — `.agents/tasks/HANDOFF-005-reduce-transport-protocol-to-codecs-and-remove-the-cli-bridge.md`

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

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.
