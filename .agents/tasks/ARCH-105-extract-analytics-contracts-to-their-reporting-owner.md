---
title: 'ARCH-105: extract analytics and usage contracts to their reporting owner'
status: in-progress
created: 2026-08-23
priority: medium
urgency: now
area: packages/agent-interface-analytics, packages/agent-interface-transport
depends_on: []
---

# ARCH-105: extract analytics and usage contracts to their reporting owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2112.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.
Third and last wave-1 leaf, after ARCH-103 (execution) and ARCH-104 (command).

## Problem

The analytics/usage contracts are declared inside `session-contracts.ts` in a transport-named package.
`agent-session-analytics` — the package that produces these reports — imports them from there.

**This leaf is a file SPLIT, not a move.** The owner map records that family boundaries and file
boundaries do not coincide here: there is no `analytics-contracts.ts` to relocate, so a file-level
plan does nothing at all.

## Existing Evidence

Measured on `origin/develop` @ `0c9c9fd59`.

- **7 symbols**, all declared in `session-contracts.ts` lines 105–210: `IUsageSource`,
  `IUsageSnapshot`, `ISpanEntry`, `IUsageSourceTotals`, `IRunTraceSpan`, `IRunTraceTurn`,
  `IUsageBySourceReport`.
- **4 consumer packages, 10 statements, 3 MIXED** — an order of magnitude smaller than ARCH-104's
  9/110/12. The risk here is the operation, not the volume.
- Three transport modules name one: `index.ts` (barrel), `session-contracts.ts` (declares them), and
  `turn-contracts.ts` (`ITurnHandle.usage?: IUsageSnapshot`).
- **The extraction is clean.** Every field of the seven is a primitive or another member of the set.
  A first pass reported six outside types — `IExecutionOrigin`, `IHistoryEntry`,
  `IInteractiveSessionRecord`, `ISpanCompletionEventData`, `TServerMessage`, `TUI` — and **all six are
  comment mentions**, not field types. Filtering to real field positions is what settled it.

## Directions Considered

- Extract the seven declarations into `agent-interface-analytics` at layer 0 and rewire (chosen).
- Move `session-contracts.ts` wholesale. Rejected: it would take the entire session family with it,
  which is issue #2110's work under a different owner.

## Completion Criteria

- [ ] `agent-interface-analytics` exists at layer 0 with the seven declarations.
- [ ] `session-contracts.ts` no longer declares them and imports what it still needs.
- [ ] No analytics symbol is exported from `agent-interface-transport`'s barrel.
- [ ] Every consumer imports them from the new package.
- [ ] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 4 consumer packages, unchanged, are the regression surface.
- Workspace `pnpm typecheck` — for a type-level extraction the compiler is the assertion.
- Full harness scan and CI mirror; `file-size` baseline regenerated for the shrink, reported exactly.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it relocates type declarations between packages with no
change to any runtime value, signature or shipped surface. The verification surface is the harness
gate and the consumer packages' own suites, recorded in the Test Plan above.
