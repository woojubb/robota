---
title: 'INFRA-025: interface-transport contract SSOT — stop type-importing from implementation packages'
status: done
completed: 2026-07-04
created: 2026-07-04
priority: high
urgency: now
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

## Approved design (user-confirmed 2026-07-04 — "전체 진행"; 대대적 리팩토링 허용, 레거시 무보존)

Deep-measurement upgrade of the original scope. The single root cause: transport-facing
DATA contracts are owned by three packages (executor: background-task states/events;
session: `ICompactEvent`; framework: `IExecutionResult`, `IToolState`, `ICommandResult`,
workspace snapshots), forcing (a) the contract package to reverse-import implementations,
(b) framework to pass-through re-export executor types (`TBackgroundTaskEvent` reaches
transport-ws via framework), and (c) transport-ws — with ZERO framework value imports —
to carry the whole assembly layer for 8 type imports while `-http`/`-mcp` are already
contract-pure.

Target state:

```
interface-transport = sole SSOT of transport-facing contracts; deps: agent-core ONLY
executor / session / framework = import contracts FROM interface-transport
transport-ws = interface-transport(+core) only — framework dependency deleted
framework   = pass-through re-exports of relocated contracts removed;
              testing harness usageReport() deleted (callers compose
              summarizeUsageBySource themselves) → session-analytics demoted to devDep
mechanized  = "interface-* package deps ⊆ {agent-core}" invariant added to the deps scan
```

Phases (initiative base branch `feat/infra-025-contract-ssot`, child PRs per phase,
final PR to develop left to the user):

1. **Contract inventory + relocation**: typecheck-driven inventory of every
   transport-facing contract type consumed across the transport family; relocate to
   interface-transport; reverse the executor/session edges.
2. **transport-ws framework-free** + framework re-export removal for relocated types.
3. **Harness decoupling**: delete `usageReport()` from scripted-session-harness
   (breaking allowed — no-legacy); migrate the two agent-command functional-test callers;
   session-analytics → framework devDependencies.
4. **Docs + mechanization**: SPEC updates (interface-transport, executor, session,
   framework, transport-ws, session-analytics), Interaction Channel Contract section
   fixed (doc drift: `IInteractionChannel` already lives in interface-transport), the
   interface-package dependency invariant added to the deps scan with fixture tests.

## What (original scope, superseded by the approved design above)

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

## Evidence (engineering verification, 2026-07-04)

Initiative `feat/infra-025-contract-ssot`, child PRs #943 (P1) / #944 (P2) / #945 (P3) / P4.

- **Target state reached**: `agent-interface-transport` deps 3 → **1 (agent-core only)**;
  owns `background-task-contracts` (25 decls) / `subagent-contracts` / `compact-contracts`.
  `agent-executor`/`agent-session` edges REVERSED (they now import the contracts; public
  indexes no longer re-export them). `transport-ws` deps = core + interface-transport + ws —
  the framework edge is deleted; `-ws`/`-http`/`-mcp` are all contract-pure. `agent-framework`
  public index: 78 pass-through re-exports removed; session-analytics demoted to
  devDependencies (harness exposes neutral `sessionLog()`; `usageReport()` deleted).
- **Mechanized + proven (red/green)**: ① `INTERFACE-DEPS` rule in the deps scan — planting
  the pre-fix `interface-transport → executor` dep fails the scan, clean state passes;
  ② `interface-imports` scan now also matches `export … from` pass-throughs — planting the
  exact pre-P2 transport-ws re-export fails, clean state passes. Fixture tests:
  `scripts/harness/__tests__/check-interface-package-deps.test.mjs` (harness suite 238).
- **Docs**: SPECs updated (interface-transport, executor, session, framework, transport-ws,
  session-analytics), `project-structure.md` (Interface Package Rule invariant, Interaction
  Channel Contract ownership drift fixed, transport-family purity), README examples
  (framework, transport-mcp). REFACTOR-018 (done 2026-05-16, deferred inversion) annotated
  as completed by this work.
- **Suites**: repo typecheck 0 errors; full build green; full test suite green (framework
  1035, incl. agent-definition-loader isolation fix absorbed in P1); 45 harness scans;
  lint 0 errors.
