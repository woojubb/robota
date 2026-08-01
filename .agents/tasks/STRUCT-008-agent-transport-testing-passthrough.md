---
title: 'STRUCT-08: remove the load-bearing agent-transport/testing pass-through of agent-core/testing'
status: todo
created: 2026-07-21
priority: low
urgency: later
area: packages/agent-transport, packages/agent-transport-tui, packages/agent-cli
depends_on: ['ARCH-004']
---

# Remove the load-bearing `agent-transport/testing` pass-through re-export

ARCH-004 (STRUCT-07) removed the pass-through re-export of `createScriptedProvider` /
`IScriptedProvider` / `TScriptedTurn` from `agent-framework/src/testing/index.ts` (no importer used it). The
`proposal-reviewer` flagged the **identical same-class violation** in `agent-transport/src/testing/index.ts:9-10`,
which was deliberately left out of ARCH-004's scope because — unlike the framework one — it **is load-bearing**:
`agent-transport-tui` and `agent-cli` import `createScriptedProvider` via `@robota-sdk/agent-transport/testing`.
Removing it is a breaking change to those importers, so it needs its own item to apply the no-pass-through-re-exports
rule consistently rather than leave it silently exempted.

## What

1. Repoint the `agent-transport-tui` + `agent-cli` importers to `@robota-sdk/agent-core/testing` directly.
2. Remove the `createScriptedProvider` / `IScriptedProvider` / `TScriptedTurn` re-exports from
   `agent-transport/src/testing/index.ts`.
3. Confirm `check-dependency-direction` / no-pass-through stays green and all importers resolve.

## Test Plan

- The repointed importers' tests stay green; `pnpm --filter` builds of `agent-transport-tui` + `agent-cli` pass.

## User Execution Test Scenarios

- Not applicable (test-fixture import-path cleanup; the dependency-direction scan is the maintained gate).
- Evidence: the repointed importers build + test green.
