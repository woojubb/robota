---
title: 'ARCH-103: move background, subagent and workspace contracts to the execution owner'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: apps/agent-server, packages/agent-command, packages/agent-executor,
  packages/agent-framework, packages/agent-interface-execution,
  packages/agent-interface-transport, packages/agent-session, packages/agent-subagent-runner,
  packages/agent-transport, packages/agent-transport-gui, packages/agent-transport-protocol,
  packages/agent-transport-tui, scripts/harness
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

- [x] `agent-interface-execution` exists at layer 0 with the four modules and manifest deps
      `{agent-core}` only.
- [x] `workspace-contracts` imports `IBackgroundJobGroupState` from its declaring module.
- [x] No execution symbol is exported from `agent-interface-transport`'s barrel.
- [x] Every consumer imports execution contracts from the new package.
- [x] `interface-family-owner` reports the new placement and a legal layer graph.
- [x] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 10 consumer packages, unchanged, are the regression surface.
- `interface-family-owner` PLACEMENT arms itself once the owner package exists.
- Full harness scan and CI mirror.

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

**Layer 0, four modules, deps `{agent-core}`** — confirmed.
`workspace-contracts.ts:9` imports `IBackgroundJobGroupState` from `./background-group-contracts.js`,
its declaring module, which was this leaf's one-line correction and removed 2 of the 12 module cycles
the omnibus carried.

**What this leaf produced that is not in the plan above** (arrived during execution, added here
2026-08-24): the codemod that rewrote consumers matched `import` but not `export … from`, and the
build failed with 24 `MISSING_EXPORT` errors. That reproduced the exact blind spot HARNESS-116 had
fixed in the accompanying scan the same morning — **a codemod inherits the parser blind spots of the
scan it accompanies, and nothing links them.** Filed as issue #2206.

## Result

Delivered by PR #2203 (`bd50f8b28`) on 2026-08-23. A 2026-08-28 reconciliation re-ran
`scan-interface-family-owner` and `check-dependency-direction`: 22 contract modules were
placement-checked, all four manifest edges matched the projection, and both commands exited 0.
The execution owner remains at layer 0, consumers resolve through it, and no execution-family symbol
is reachable through the transport owner. The batch also passed `pnpm harness:scan` (145 scans),
workspace `pnpm typecheck` (109 projects), focused Vitest (15 files, 58 tests), and
`pnpm harness:verify-like-ci` (all 13 stages). This Task is complete; the paired planning document is
rejected separately because implementation preceded its GATE-IMPLEMENT checkpoint.
