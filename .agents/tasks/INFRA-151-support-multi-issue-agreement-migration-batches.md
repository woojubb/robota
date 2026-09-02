---
title: 'INFRA-151: support multi-issue AGREEMENT migration batches'
status: todo
created: 2026-09-03
priority: high
urgency: now
area: issue-to-backlog and planning-order enforcement
depends_on: [INFRA-141]
---

# INFRA-151: support multi-issue AGREEMENT migration batches

## Objective

Allow one existing parent Issue and its existing child Issues to become one atomic AGREEMENT Task graph
without lying about any Task's source Issue. The current contracts cannot express that shape: the
planning-order scanner requires every child Task to cite the parent's Issue, while the conversion
finalizer requires each absorbed Issue's Task to cite that exact child Issue.

no-issue: This blocker was discovered while executing the owner-directed RULE-023 consolidation of
[issue #2061](https://github.com/woojubb/robota/issues/2061) and its existing children. Creating another
GitHub Issue would add the queue entry this fix exists to remove.

## Plan

- [x] TC-01 — Accept a strict atomic AGREEMENT prelude when every child cites one concrete GitHub Issue,
      whether all records share one source or existing hierarchy children cite distinct leaf sources.
- [x] TC-02 — Preserve rejection of missing/malformed child source URLs and every unrelated-path,
      pre-existing-child, nested-AGREEMENT, non-todo, duplicate, and projection mismatch.
- [x] TC-03 — Document the two source topologies in `issue-to-backlog` without weakening exact
      Task-to-Issue identity at conversion time.
- [x] TC-04 — Prove a five-record tracker/leaf fixture passes staged and history validation, and that
      every leaf succeeds only with its own Task while cross-pairing is refused before writes.
- [x] TC-05 — Run the focused planning-order/triage suites and the affected repository scan once after
      the complete implementation batch.

## Constraints

- `issue` remains the sole canonical source of each Task and the value checked by conversion finalization.
- Do not weaken the unrelated-path, new-file, todo-status, non-nested, or exact-projection checks.
- Do not change the conversion finalizer's exact Task-to-Issue identity guard.
- Do not perform any GitHub mutation in this work unit.

## Test Plan

- Add table-driven staged and history fixtures for the same-source and distinct-source forms plus every
  preserved rejected declaration class.
- Add a focused triage fixture proving each leaf's exact `issue` URL remains finalizer-compatible.
- Run both affected Vitest files and the affected scan once after all source, skill, and test edits land.

## User Execution Test Scenarios

Not applicable. This changes repository governance and harness validation only; it adds no runnable
Robota product behavior, public API, CLI output, TUI flow, or end-user interface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The observable contract is fully exercised by isolated Git-index/history fixtures and the
conversion finalizer fixture; there is no product user surface to exercise.
