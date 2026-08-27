---
title: 'ARCH-106: move session, interaction, event and persistence contracts to the runtime owner'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: apps/agent-server, apps/remote-signaling, packages/agent-cli, packages/agent-command,
  packages/agent-framework, packages/agent-interface-session, packages/agent-interface-transport,
  packages/agent-session, packages/agent-session-analytics, packages/agent-transport,
  packages/agent-transport-gui, packages/agent-transport-http, packages/agent-transport-mcp,
  packages/agent-transport-protocol, packages/agent-transport-tui,
  packages/agent-transport-webrtc, packages/agent-transport-ws, scripts/harness
depends_on: []
---

# ARCH-106: move session, interaction, event and persistence contracts to the runtime owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2110.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.
Wave 2, after wave 1 completed with ARCH-103, ARCH-104 and ARCH-105.

## Problem

The session, interaction, event, driver, turn and compaction contract families are the largest tenant
of `agent-interface-transport`, a package named for transport. `agent-session`, `agent-framework` and
every transport surface reach it for contracts that are theirs.

**This is the leaf where the package becomes what its name says.** After it, only
`transport-adapter`, `transport-config`, `channel-contracts` and `admission` remain, plus the three
mobility modules awaiting issue #2111.

## Existing Evidence

Measured on `origin/develop` @ `c621e4d49`. The earlier figure of 212 statements was three leaves
stale and understated the module count by seven.

- **85 symbols across 8 modules**: `session-contracts` (25), `session-capability-contracts` (21),
  `event-contracts` (14), `interaction-contracts` (10), `driver-contracts` (6), `turn-contracts` (6),
  `compact-contracts` (2), `session-summary-contracts` (1).
- **15 consumer packages, 219 statements, 38 MIXED.** `agent-framework` alone is 62 files.
- **The 38 mixed statements are the risk**, not the 219. Three times ARCH-104's 12, and the
  population where an over-applied sweep does its damage: a wrong split still compiles whenever both
  packages export the name.
- `agent-interface-transport` must drop from layer 1 to layer 0 in this leaf — it stops holding a
  family that composes downward.

## Directions Considered

- Create `agent-interface-session` at layer 1, move all eight modules, rewire in one change (chosen).
- Batch with issue #2111 (mobility). Rejected: mobility depends on session, so batching would hide a
  layer-2 → layer-1 edge inside a 219-statement diff, and the leaves are independently mergeable by
  the tracker's own rule.

## Completion Criteria

- [x] `agent-interface-session` exists at layer 1 with the eight modules.
- [x] Each of the 38 mixed statements is split by the recorded rule, and the result is checked
      against that rule rather than against the build.
- [x] `agent-interface-transport` is declared at layer 0, in its own commit with its own reasoning.
- [x] No session symbol is exported from `agent-interface-transport`'s barrel.
- [x] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 15 consumer packages, unchanged, are the regression surface.
- Rule-conformance checks over the split, independent of compilation — see the spec's split rule.
- Workspace `pnpm typecheck`; full harness scan and CI mirror.

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

**Layer 1, deps `{agent-core, analytics, command, execution}`** — confirmed, and the composition is
exactly the downward one the layer table authorises.

**The plan says "eight modules"; the package holds nine** (recorded 2026-08-24). The ninth is
`session-store-contracts.ts`, split out by TRANS-007 (issue #2231) after this leaf landed — an
unrelated change to the same package, not a miscount here.

**What this leaf produced that is not in the plan above:** its codemod derived family membership from
the barrel's `export type {…}` blocks and silently excluded **8 value exports** —
`OWNER_DRIVER_ID`, `AGENT_DRIVER_ID`, `SESSION_CAPABILITY_MEMBER_KEYS`, `isTurnNotRunError` and the
four interaction readers. It was caught by the split rule written **before** the work
("membership is decided by reading the DECLARATION in the moving module's source, not by what a
barrel re-exports"), which is the only reason it was caught at all — the build was green either way,
because a wrong split still compiles whenever both packages export the name.

Those four readers are the symbols that make issue #2260 a live release problem.

## Result

Delivered by PR #2217 (`22152ef9d`) on 2026-08-23. A 2026-08-28 reconciliation re-ran
`scan-interface-family-owner` and `check-dependency-direction`; both exited 0. The session owner
remains a legal layer-1 composition, transport is layer 0, and no session-family symbol is reachable
through transport. The ninth current module was added later by TRANS-007 and does not invalidate the
eight-module delivery claim. The batch also passed `pnpm harness:scan` (145 scans), workspace
`pnpm typecheck` (109 projects), focused Vitest (15 files, 58 tests), and
`pnpm harness:verify-like-ci` (all 13 stages). This Task is complete; the paired planning document is rejected
separately because implementation preceded its GATE-IMPLEMENT checkpoint.
