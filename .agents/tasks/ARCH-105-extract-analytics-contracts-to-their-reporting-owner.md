---
title: 'ARCH-105: extract analytics and usage contracts to their reporting owner'
status: in-progress
created: 2026-08-23
priority: medium
urgency: now
area: packages/agent-framework, packages/agent-interface-analytics,
  packages/agent-interface-transport, packages/agent-session-analytics,
  packages/agent-transport-protocol, packages/agent-transport-tui, scripts/harness
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

This task delivers no runnable user-facing behavior, so the rule is satisfied by this reasoned
not-applicable entry rather than by scenarios.

**The reason first recorded here was false, and is corrected rather than deleted (2026-08-24).** It
read "no change to any runtime value, signature or shipped surface". The decomposition moved **15
runtime values**, not only types, and four of them — `readAssistantReplies`, `readLastAssistantText`,
`readToolCalls`, `readErrors` — are exported from the published
`@robota-sdk/agent-interface-transport@3.0.0-beta.79` tarball and now live in
`agent-interface-session`, which is not on the registry (`npm view` → E404). So the shipped surface
did change.

**Why scenarios are still not required.** The rule's trigger is runnable user-facing _behavior_.
Every consumer inside this workspace was rewired in the same change, so nothing a user can run
against this repository behaves differently. What the surface change reaches is the **registry**, and
that is a release-configuration problem rather than a property of this task: the next publish would
ship a transport without those four symbols and no published package that owns them. Issue #2260
owns it. Recording that here is part of the reason — the consequence was measured and handed to an
owner, not waved past.

## Verification against the tree (2026-08-24)

Every criterion above was **measured against `develop` @ `81a4ab97c`**. They are recorded here and
left **unticked**: the spec document has not passed its gates, so ticking them would claim a
completion the pipeline has not granted. The measurement is evidence for a later gate, not a
substitute for one. The shared measurements, run once for all six leaves:

| Owner            | Symbols declared | Still reachable through transport's built surface |
| ---------------- | ---------------- | ------------------------------------------------- |
| execution        | 60               | 0                                                 |
| command          | 21               | 0                                                 |
| analytics        | 7                | 0                                                 |
| session          | 91               | 0                                                 |
| session-mobility | 21               | 0                                                 |

`agent-interface-transport` declares `@robota-sdk/agent-core` and nothing else, at layer 0. Checked
against the BUILT `.d.ts` of both published entries rather than the source barrel, because a
source-level check cannot see what a re-export chain publishes.

**Layer 0, seven declarations, no dependencies at all** — confirmed:
`IUsageSource`, `IUsageSnapshot`, `ISpanEntry`, `IUsageSourceTotals`, `IRunTraceSpan`,
`IRunTraceTurn`, `IUsageBySourceReport`. `session-contracts.ts` declares none of them.

This was the leaf that had to extract a family **by symbol rather than by file**, because the seven
declarations shared a module with contracts belonging to another owner. The owner map records that as
a note precisely so a later reader does not assume file-granularity was always available.
