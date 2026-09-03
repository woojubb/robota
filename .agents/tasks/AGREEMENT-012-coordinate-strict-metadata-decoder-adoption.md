---
title: 'AGREEMENT-012: coordinate strict metadata decoder adoption'
issue: https://github.com/woojubb/robota/issues/2066
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: skill, plugin, and agent-definition metadata trust
depends_on: [RULE-023]
children: [SECURITY-003, SECURITY-004]
---

# AGREEMENT-012: coordinate strict metadata decoder adoption

## Objective

Coordinate skill, plugin, and agent-definition metadata trust as one exact Issue-to-Task migration graph rooted in [issue #2066](https://github.com/woojubb/robota/issues/2066). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] SECURITY-003 — todo — `.agents/tasks/SECURITY-003-migrate-skill-and-plugin-discovery-to-the-strict-decoder.md`
- [ ] SECURITY-004 — todo — `.agents/tasks/SECURITY-004-migrate-agent-definition-loading-to-the-strict-decoder.md`

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
