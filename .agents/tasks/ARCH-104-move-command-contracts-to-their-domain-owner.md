---
title: 'ARCH-104: move command and capability contracts to their domain owner'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-interface-command, packages/agent-interface-transport
depends_on: []
---

# ARCH-104: move command and capability contracts to their domain owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2108.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.
Second wave-1 leaf, after ARCH-103 moved the execution family.

## Problem

`agent-interface-transport` is named for transport and owns the command contract families.
`agent-command` — the package whose entire subject is commands — imports its own domain's contracts
from a transport-named package, across 64 files.

## Existing Evidence

Measured on `origin/develop` @ `bd50f8b28`.

- **21 symbols**: `command-contracts` (18), `capability-contracts` (3).
- **9 consumer packages, 110 statements, 12 MIXED.** `agent-command` alone is 64 files — more
  concentrated than ARCH-103's `agent-framework`.
- Two transport modules still name command types: `driver-contracts` and
  `session-capability-contracts`. So this creates a second downward `transport(1) → command(0)` edge,
  the same shape ARCH-103 created for execution.
- `capability-contracts` has no consumer outside the package; its only importer is `command-contracts`.
  The owner ruled on issue #2177 that it **stays publicly exported**, so it moves with its export
  intact.

## Directions Considered

- Create `agent-interface-command` at layer 0, move both modules, rewire every consumer in one change
  (chosen) — the shape ARCH-103 proved.
- Move `command-contracts` and leave `capability-contracts` behind. Rejected: `command-contracts` is
  its only importer, so leaving it would create a `command(0) → transport(1)` **upward** edge, which
  ARCH-101's rule refuses.

## Completion Criteria

- [ ] `agent-interface-command` exists at layer 0 with both modules and manifest deps `{agent-core}`.
- [ ] `capability-contracts` moves and keeps its barrel export, per the issue #2177 ruling.
- [ ] No command symbol is exported from `agent-interface-transport`'s barrel.
- [ ] Every consumer imports command contracts from the new package.
- [ ] `agent-interface-transport` stays declared at layer 1 — it still holds the session family.
- [ ] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 9 consumer packages, unchanged, are the regression surface.
- Workspace `pnpm typecheck` — for a type-level move the compiler is the assertion.
- Full harness scan and CI mirror.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it relocates type contracts between packages with no
change to any runtime value, signature or shipped surface. The verification surface is the harness
gate and the consumer packages' own suites, recorded in the Test Plan above.
