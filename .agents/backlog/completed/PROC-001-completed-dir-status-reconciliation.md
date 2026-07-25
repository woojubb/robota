---
title: 'PROC-001: reconcile the 17 completed/-dir backlog files still carrying status: todo'
status: done
completed: 2026-07-25
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
- Evidence: see Outcome below — each file carries its own Outcome/supersession/Progress note.

## Outcome (2026-07-25)

All 17 files verified item-by-item against the code, `git log --all`, and related closed items;
`LEGACY_COMPLETED_TODO` emptied and the scan passes with no allowlist.

- **done, completed 2026-05-25 (shipped in PR #589, re-verified in today's code):** CLI-043
  (glob pLimit(100)), CLI-046 (`--denied-tools`), CLI-047 (exit codes + `error_code`, later
  hardened by CLI-064), CLI-048 (WebSearch BRAVE_API_KEY docs + graceful message), PM-033 (init
  inline provider prompt, later fixed by CLI-049/065), PM-034 (`ICommand.example` in /help).
- **superseded:** CLI-044 (→ CLI-071/075 shutdown lifecycle), PM-027 (→ MKT-001; README-KO
  shipped, community posts never made), PM-028 (→ WEB-008; beta page shipped, program never ran),
  PM-029 (→ starter-nextjs shipped + EXAMPLES-002/DOCS-014), PM-030 (→ AUDIT-001 removed
  telemetry entirely), SITE-004 (→ DEPLOY-001 apex migration made the www-redirect plan obsolete).
- **reopened (moved back to the root, `status: todo`, with Progress notes):** CLI-032 (no git
  slash commands exist — #589 claim false), CLI-034 (no plugin package exists — claim false),
  CLI-042 (grep-tool still sequential — claim false), PM-026 (apps/action shipped; Marketplace
  publish + real-PR verification remain), PM-031 (README references a 41-byte placeholder
  demo.gif — broken image).
