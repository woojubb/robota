---
title: 'PROC-001: reconcile the 17 completed/-dir backlog files still carrying status: todo'
status: todo
created: 2026-07-02
priority: low
urgency: later
area: .agents/backlog, scripts/harness
depends_on: []
---

# completed/ status reconciliation

The `backlog-placement` scan (added 2026-07-02) enforces the backlog-execution.md Status Invariants
(terminal status ⇔ `completed/`). It found 17 files that PR #589 (2026-05-25, "implement all 45
backlog items") archived into `completed/` while leaving `status: todo` in their frontmatter. Their
true state needs item-by-item verification — some may be genuinely shipped (flip to `done` +
`completed: 2026-05-25`), some partially shipped (reopen or split), some obsolete (`superseded`).
They are pinned in the scan's `LEGACY_COMPLETED_TODO` allowlist until reconciled.

## What

For each file in the scan's `LEGACY_COMPLETED_TODO` list (CLI-032/034/042/043/044/046/047/048,
PM-026/027/028/029/030/031/033/034, SITE-004):

1. Verify the item's actual state against the current code/product (not just PR #589's claim).
2. Set the truthful terminal status (`done` + `completed:` date, `superseded`, `skipped`) — or move
   it back to the root if genuinely unfinished and still wanted.
3. Delete its allowlist entry. Done when `LEGACY_COMPLETED_TODO` is empty.

## Test Plan

- `node scripts/harness/check-backlog-placement.mjs` exit 0 with a shrinking (then deleted)
  allowlist; `pnpm harness:scan` green.

## User Execution Test Scenarios

- Not applicable (backlog bookkeeping; the scan is the maintained gate). Evidence: per-item
  verification notes recorded in each reconciled file.
- Evidence: _to fill per item._
