---
title: 'INFRA-025: interface-transport contract SSOT — stop type-importing from implementation packages'
status: todo
created: 2026-07-04
priority: medium
urgency: later
area: packages/agent-interface-transport, packages/agent-executor, packages/agent-session
depends_on: []
---

# Interface-transport contract SSOT

Architecture audit finding F2 (2026-07-04): `agent-interface-transport` — the pure
contract SSOT per the Interface Package Rule — type-imports from implementation packages:
`TBackgroundTaskStatus`/`IBackgroundTaskError` from `@robota-sdk/agent-executor`
(`background-group-contracts.ts`, `session-contracts.ts`, `workspace-contracts.ts`) and
`ICompactEvent` from `@robota-sdk/agent-session` (`session-contracts.ts`). Type-only, so
no runtime coupling — but the contract package cannot be consumed without pulling two
implementation packages into the install tree, and for exactly these types the
"implementations depend on contracts" direction is inverted.

## What (spec-first — contract change, design confirmation required before implementation)

1. Relocate the transport-facing contract types (`TBackgroundTaskStatus`,
   `IBackgroundTaskError`, `ICompactEvent` — audit the full import surface for others) into
   `agent-interface-transport` as their SSOT.
2. Reverse the edges: `agent-executor` and `agent-session` import (or re-export for their
   own consumers, within the no-pass-through rule) the contract types from
   `agent-interface-transport`.
3. Target state: `agent-interface-transport` deps shrink toward `agent-core`-only (or
   zero); document the final dependency posture in the Interface Package Rule.
4. Update SPEC.md of all three packages (type ownership tables) + typecheck-driven sweep of
   all importers.

## Test Plan

- Full repo typecheck (the relocation is type-SSOT movement; tsc catches every importer).
- `interface-imports` + `deps` + `dependency-direction` scans green.
- No runtime behavior change expected — full test suite green as regression evidence.

## User Execution Test Scenarios

Not applicable — type-ownership relocation with no runnable behavior change; evidence is
the Test Plan (typecheck + suites + scans).
