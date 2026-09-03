---
title: 'AGREEMENT-013: coordinate the remaining correctness-leaf absorption'
issue: https://github.com/woojubb/robota/issues/2079
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: session event decoding and configured-hook reachability
depends_on: [RULE-023]
children: [TRANS-016, SEC-021]
---

# AGREEMENT-013: coordinate the remaining correctness-leaf absorption

## Objective

Coordinate session event decoding and configured-hook reachability as one exact Issue-to-Task migration graph rooted in [issue #2079](https://github.com/woojubb/robota/issues/2079). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] TRANS-016 — todo — `.agents/tasks/TRANS-016-decode-jsonl-events-by-event-name-before-replay.md`
- [ ] SEC-021 — todo — `.agents/tasks/SEC-021-reject-configured-hook-types-without-reachable-executors.md`

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

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.
