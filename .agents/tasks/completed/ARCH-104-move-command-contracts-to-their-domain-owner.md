---
title: 'ARCH-104: move command and capability contracts to their domain owner'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: packages/agent-command, packages/agent-command-workflows, packages/agent-framework,
  packages/agent-interface-command, packages/agent-interface-transport, packages/agent-transport,
  packages/agent-transport-gui, packages/agent-transport-protocol, packages/agent-transport-tui,
  packages/dag-nodes, packages/dag-nodes-default, scripts/harness
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

- [x] `agent-interface-command` exists at layer 0 with both modules and manifest deps `{agent-core}`.
- [x] `capability-contracts` moves and keeps its barrel export, per the issue #2177 ruling.
- [x] No command symbol is exported from `agent-interface-transport`'s barrel.
- [x] Every consumer imports command contracts from the new package.
- [ ] `agent-interface-transport` stays declared at layer 1 — it still holds the session family. — allow-unmet-criterion: this current-state condition was true at the delivery commit, then ARCH-106 and ARCH-108 intentionally superseded it; the independent `backlog-gate-guard` verdict recorded below requires it to remain unticked.
- [x] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 9 consumer packages, unchanged, are the regression surface.
- Workspace `pnpm typecheck` — for a type-level move the compiler is the assertion.
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

**Layer 0, two modules, deps `{agent-core}`** — confirmed. `capability-contracts` moved with its
barrel export per the issue #2177 ruling.

**One criterion cannot be ticked, and the reason is a distinction I got half right** (recorded
2026-08-24). The criterion reads: "`agent-interface-transport` stays declared at layer 1 — it still
holds the session family."

I first ticked it as _superseded rather than failed_ — correct at this leaf's merge (`0c9c9fd59`,
where the owner map read "transport is at layer 1 TODAY") and no longer true, because ARCH-106 moved
the session family out and ARCH-108 brought the row to 0.

A `backlog-gate-guard` verdict reversed the conclusion while keeping the distinction:

> **An expired criterion is not a met criterion.** Nor is it a failure — the implementation did hold
> layer 1 at the time. But the gate asks whether the document satisfies its criterion **now**, and
> what the criterion points at no longer exists.

It remained unticked while the invalid planning lifecycle was unresolved and remains unticked in the
completed archive. This reconciliation records that the Task's implementation was delivered while
preserving the guardian's current-state verdict: transport was at layer 1 in `0c9c9fd59`, then ARCH-106
and ARCH-108 intentionally superseded that temporary fact. Archival does not convert the expired
criterion into a current-state pass.

## Result

Delivered by PR #2209 (`0c9c9fd59`) on 2026-08-23. A 2026-08-28 reconciliation re-ran
`scan-interface-family-owner` and `check-dependency-direction`; both exited 0 with the command family
owned at layer 0 and no command-family transport export. The temporary transport-layer criterion
remains unticked because ARCH-106 and ARCH-108 intentionally superseded it after the delivery commit.
The batch also
passed `pnpm harness:scan` (145 scans), workspace `pnpm typecheck` (109 projects), focused Vitest
(15 files, 58 tests), and `pnpm harness:verify-like-ci` (all 13 stages). This Task is
complete; the paired planning document is rejected separately because implementation preceded its
GATE-IMPLEMENT checkpoint.
