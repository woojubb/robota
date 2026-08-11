# WORKFLOW-003 — `/workflows` agent-cli command

Spec: .agents/spec-docs/done/WORKFLOW-003-workflows-command.md
Status: done (list/catalog/validate/run) — build subcommand deferred (needs LLM-integration design: how a command module reaches the session provider). Committed incrementally; harness green.

## Decision (recorded)

- New bridge package `packages/agent-command-workflows` — depends on `@robota-sdk/agent-framework`
  (command contracts) + DAG engine packages (`dag-framework` etc.). Keeps `agent-command` dag-free.
- agent-cli registers the module in its default composition. No `@robota-sdk/dag-cli` dependency.
- Canonical command name `workflows` (slash-free); subcommands list/build/validate/run/catalog.

## Phases

### Phase 1 — Bridge package skeleton

- [x] `packages/agent-command-workflows` (package.json/tsconfig/tsdown/docs SPEC+README) — AGPL license.
- [x] Workspace + harness registration (project-structure `agent-command-*`, capability-placement already patterned).

### Phase 2 — Command module

- [x] `workflows` `ICommandModule` (commandSources + systemCommands) with subcommands, composing
      `createDagFramework`/`LocalDagRuntimeProvider`. No dag-cli import.
- [x] Subcommand executors: list (nodes/catalog), validate, run (.dag.json), build, catalog.

### Phase 3 — Wire into agent-cli

- [x] Register the module in agent-cli default composition (`createDefaultCommandModules` consumer or command-setup).

### Phase 4 — Verify

- [x] typecheck + agent-cli test green; module dispatch test; `rg` no dag-cli import in agent-\*; harness:scan green.

## TC Coverage Map

| TC                                       | Covered by       |
| ---------------------------------------- | ---------------- |
| TC-01 (module + subcommands, slash-free) | Phase 2          |
| TC-02 (no dag-cli import)                | Phase 2          |
| TC-03 (dispatch test)                    | Phase 2, Phase 4 |
| TC-04 (typecheck + agent-cli test)       | Phase 4          |
| TC-05 (harness:scan)                     | Phase 1, Phase 4 |

## Test Plan / 검증

Mechanical. TC-01/02: `rg` over the module + agent-\*. TC-03: dispatch unit test. TC-04: typecheck +
agent-cli test exit 0. TC-05: `pnpm harness:scan` exit 0. No manual rows.
