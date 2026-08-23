---
title: 'ARCH-103: move background, subagent and workspace contracts to the execution owner'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-interface-execution, packages/agent-interface-transport
depends_on: []
---

# ARCH-103: move background, subagent and workspace contracts to the execution owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2109.
Parent tracker: issue #2068. Owner map: `.agents/specs/contract-family-owner-map.md` (ARCH-100).
Unblocked by ARCH-101, which made a downward interface→interface edge legal.

## Problem

`agent-interface-transport` is named for transport and owns the execution-bounded contract families.
`agent-executor`, `agent-subagent-runner` and `agent-framework` reach a transport-named package for
background-task, subagent and workspace contracts that are theirs.

## Existing Evidence

Measured on `origin/develop` @ `917f849de`.

- The four modules export **60 symbols**: `background-task-contracts` (24), `workspace-contracts`
  (22), `background-group-contracts` (9), `subagent-contracts` (5).
- **10 consumer packages, 85 import statements, 69 files.** `agent-framework` alone is 42 statements
  across 36 files.
- **16 statements are MIXED** — they name moving and staying symbols in one statement and must be
  split, which is where a mechanical rewrite goes wrong.
- `workspace-contracts.ts` imports `IBackgroundJobGroupState` from `./session-contracts.js`, which
  merely re-exports it; it is declared in `background-group-contracts.ts`. This is the only **upward**
  edge in the tree.
- Scope grew from an earlier measurement (9 packages / 80 statements) because TRANS-005 and SEC-015
  added `agent-session` imports while ARCH-101 was in flight.

## Directions Considered

- Create `agent-interface-execution` at layer 0, move the four modules, redirect the pass-through, and
  rewire every consumer in one change (chosen).
- Stage behind a forwarding re-export from the transport barrel. Rejected: issue #2109's acceptance
  criteria and issue #2068's end state both forbid a compatibility shim, and the audited API is
  prerelease.

## Completion Criteria

- [ ] `agent-interface-execution` exists at layer 0 with the four modules and manifest deps
      `{agent-core}` only.
- [ ] `workspace-contracts` imports `IBackgroundJobGroupState` from its declaring module.
- [ ] No execution symbol is exported from `agent-interface-transport`'s barrel.
- [ ] Every consumer imports execution contracts from the new package.
- [ ] `interface-family-owner` reports the new placement and a legal layer graph.
- [ ] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 10 consumer packages, unchanged, are the regression surface.
- `interface-family-owner` PLACEMENT arms itself once the owner package exists.
- Full harness scan and CI mirror.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it relocates type contracts between packages with no
change to any runtime value, signature or shipped surface. The verification surface is the harness
gate and the consumer packages' own suites, recorded in the Test Plan above.
