---
title: 'ARCH-100: agent-interface-transport contract families have no owner map or acyclic target graph'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: .agents/project-structure.md, ARCHITECTURE.md, packages/agent-interface-transport
depends_on: []
---

# ARCH-100: agent-interface-transport contract families have no owner map or acyclic target graph

Registered as GitHub issue https://github.com/woojubb/robota/issues/2080.
Parent tracker: issue #2068. Execution map: issue #2079.

## Problem

`agent-interface-transport` is described by its own manifest as a transport-contract package
(`ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`). It is not one. It is an omnibus
public-contract hub: 21 contract modules, 4,500 lines, consumed by 21 workspace packages and apps.

The repository rule in `.agents/project-structure.md` § Interface Package Rule does not merely
tolerate this — it **blesses** it, assigning the session, workspace, command, event, and usage
families to this package by name. So the architecture document is the thing to amend, not a baseline
to preserve.

Six migration leaves (issues #2108–#2113) are blocked on this one. None of them can start safely,
because moving a family out of this package without a target owner map risks a **package cycle**, and
this task establishes that the risk is real rather than theoretical: the current module graph already
contains cycles, which are invisible today only because they sit inside one package where TypeScript
tolerates type-level circularity.

## Existing Evidence

Measured on `origin/develop` @ `73dff3344`; scripts retained under this task's spec-doc.

- **21 consumer packages/apps** depend on `@robota-sdk/agent-interface-transport`.
- **12 module cycles** exist inside `src/`. Every one passes through `session-contracts.ts`. Example:
  `session-contracts → workspace-contracts → session-contracts`.
- **The largest family is not the transport family.** `session-contracts` has 15 consumer packages
  and 212 import sites; `command-contracts` has 9 and 137; `transport-adapter` — the family the
  package is named for — has 7 and 43.
- **One cycle edge is a pass-through, not a real dependency.** `workspace-contracts.ts:15` imports
  `IBackgroundJobGroupState` from `./session-contracts.js`, but that type is declared in
  `background-group-contracts.ts:26` and merely re-exported by `session-contracts.ts:76`.
- **The analytics family is not a file.** `IUsageSource`, `IUsageSnapshot`, `ISpanEntry`,
  `IUsageSourceTotals`, `IRunTraceSpan`, `IRunTraceTurn`, and `IUsageBySourceReport` — the family
  issue #2112 must move — are declared inside `session-contracts.ts`, not in a module of their own.
  Family boundaries and file boundaries do not coincide, so a file-level move plan would silently
  fail.
- **`capability-contracts` has no external consumer.** It is exported from the root barrel and
  imported by no package outside this one. Filed as a sibling under issue #2068, not resolved here.

## Directions Considered

- **Amend the rule to name one owner per family, then migrate** (chosen). The rule is the artefact
  that made the omnibus legitimate; it has to change before any symbol moves.
- **Move symbols first and document after.** Rejected: with 12 existing cycles and 21 consumers, the
  first move decides the graph by accident.
- **Keep the omnibus and add subpath exports.** Rejected by issue #2068's stated end state — no
  umbrella facade, and the audited API is prerelease so no compatibility shim is owed.

## Completion Criteria

- [ ] Every exported family in `agent-interface-transport` has exactly one named target owner.
- [ ] The proposed package graph is proven acyclic against current consumers, mechanically.
- [ ] A migration order is published that introduces no temporary cycle.
- [ ] The rule amendment names the mechanical owner/dependency guard to add.
- [ ] No production TypeScript is moved by this task.

## Test Plan

- The acyclicity proof runs as a script over the real source, not as prose.
- `pnpm harness:scan` exit 0; `pnpm harness:verify-like-ci` green.
- Document-guard scans (`architecture map`, `project-structure`) accept the amended rule.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it amends architecture and rule documents and moves no
production TypeScript (a stated acceptance criterion of issue #2080). The verification surface is the
harness gate, recorded in the Test Plan above.
