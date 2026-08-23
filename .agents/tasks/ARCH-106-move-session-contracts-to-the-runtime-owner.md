---
title: 'ARCH-106: move session, interaction, event and persistence contracts to the runtime owner'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-interface-session, packages/agent-interface-transport
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

- [ ] `agent-interface-session` exists at layer 1 with the eight modules.
- [ ] Each of the 38 mixed statements is split by the recorded rule, and the result is checked
      against that rule rather than against the build.
- [ ] `agent-interface-transport` is declared at layer 0, in its own commit with its own reasoning.
- [ ] No session symbol is exported from `agent-interface-transport`'s barrel.
- [ ] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 15 consumer packages, unchanged, are the regression surface.
- Rule-conformance checks over the split, independent of compilation — see the spec's split rule.
- Workspace `pnpm typecheck`; full harness scan and CI mirror.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it relocates type contracts between packages with no
change to any runtime value, signature or shipped surface. The verification surface is the harness
gate and the consumer packages' own suites, recorded in the Test Plan above.
