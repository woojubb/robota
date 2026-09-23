---
title: 'AGREEMENT-013: coordinate the remaining correctness-leaf absorption'
issue: https://github.com/woojubb/robota/issues/2079
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: session event decoding and configured-hook reachability
depends_on: [RULE-023]
children: [TRANS-016, SEC-021]
---

# AGREEMENT-013: coordinate the remaining correctness-leaf absorption

## Current disposition — 2026-09-23

The issue #2664 dependency is the retained issue #2075 configured-hook slice, delivered by SEC-021 and its PR #2838 source-provenance follow-up (`fe48835ca6c53ada790ec61ee1fd00c437441ba1`). TRANS-016 was separately delivered by PR #2841 (`242a6444bb7489c9edf169f1b53f7fb4e1a90507`) with v1 replay fixtures repaired in PR #2843 (`8e1e77df4f3183d10adc594e96e3a63d21840d25`).

Both product children are implemented. This parent remains in-progress because its broader issue #2079 administrative acceptance and map remain owned here. issue #2664 consumes the completed issue #2075 slice without claiming this entire parent or issue #2423 complete. The old administrative gate procedure below is historical under PR #2827.

## Objective

Coordinate session event decoding and configured-hook reachability as one exact Issue-to-Task migration graph rooted in [issue #2079](https://github.com/woojubb/robota/issues/2079). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [x] TRANS-016 — implemented by PR #2841, with checked-in v1 replay fixtures repaired alongside this status update — `.agents/tasks/TRANS-016-decode-jsonl-events-by-event-name-before-replay.md`
- [x] SEC-021 — implemented — `.agents/tasks/SEC-021-reject-configured-hook-types-without-reachable-executors.md`; source-aware startup refusal is verified through the framework and real CLI. Its PR and issue #2664 completion record own remote landing evidence.

Both product children have implementations. This parent remains `in-progress` because its own
administrative acceptance and the broader issue #2079 contract map still need reconciliation. The
historical administrative plan below records the earlier Issue-to-Task migration; current product
delivery follows the entry and completion boundaries adopted in PR #2827.

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
