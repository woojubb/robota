# Agent Command Workflows Specification

## Scope

Provides the agent-cli `/workflows` command module — a bridge that surfaces the DAG workflow engine
inside the agent CLI by composing `@robota-sdk/dag-framework` in-process. Owns the `workflows`
`ICommandModule`, its subcommand dispatch, the per-subcommand executors (`create`, `list`, `catalog`,
`validate`, `run`), and the **natural-language authoring pipeline** behind `create` (FLOW-007).

## Boundaries

- Does NOT own DAG execution — that belongs to `@robota-sdk/dag-framework` (and the DAG subsystem).
- Does NOT depend on `@robota-sdk/dag-cli` (a sibling product shell); it composes the reusable DAG
  framework material directly.
- Does NOT own command contracts — those belong to `@robota-sdk/agent-framework` /
  `@robota-sdk/agent-interface-transport`.
- Does NOT own CLI composition — `@robota-sdk/agent-cli` registers this module in its default set.

## Architecture Overview

A bridge package. `createWorkflowsCommandModule({ workspace?, providerDefinitions? })` returns an
`ICommandModule` whose `ISystemCommand.execute` parses a leading subcommand token and dispatches to an
executor. Read/run executors construct a `LocalDagRuntimeProvider` (default node registry) from
`dag-framework` and return an `ICommandResult`. No state is held; providers are created per invocation.

### NL authoring pipeline (`create`, FLOW-007)

`/workflows create "<description>" [--input k=v] [--name <name>]` runs a deterministic pipeline where
the LLM only **authors** and the runtime **executes**:

1. **Node catalog** — `createDefaultNodeRegistrySync()` (+ any prompt nodes already saved under
   `<root>/nodes/`) → `INodeManifest[]` via `buildNodeDefinitionAssembly` (`@robota-sdk/dag-node`).
2. **Author** — the ACTIVE provider (resolved with `createProviderFromSettings` +
   injected `providerDefinitions`) is prompted with the catalog and must return a JSON-only workflow
   spec (`authoring/spec.ts` validates it).
3. **Instant nodes (Phase 3)** — any `newNodes` become prompt-backed nodes
   (`createPromptBackedNodeDefinition`, `@robota-sdk/dag-node-instant-node`), saved to
   `<root>/nodes/<type>.node.json` and reusable on later `create`s.
4. **Assemble** — `buildDagFromPipeline` (`@robota-sdk/dag-builder`) → `IDagDefinition`; the resolved
   run input is baked into the `input` node so the artifact is self-contained.
5. **Save + run** — the legible `IDagDefinition` is written flat to `<root>/<name><ext>` and executed
   in-process; `run`/`create` convert it to the runtime workflow-file format via `toDagWorkflowFile`.

The `workflows` command is **model-invocable** (FLOW-007 Phase 4): the agent can author + run a
workflow from a chat request.

## Type Ownership

| Type                                     | Location | Purpose                                               |
| ---------------------------------------- | -------- | ----------------------------------------------------- |
| (none — this package owns no SSOT types) | —        | Consumes command + DAG contracts from owner packages. |

## Public API Surface

| Export                                 | Kind      | Description                                                                    |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `createWorkflowsCommandModule`         | function  | Returns the `workflows` `ICommandModule` for agent-cli composition.            |
| `IWorkflowsCommandModuleDeps`          | interface | Injected deps: `workspace?`, `providerDefinitions?`.                           |
| `createWorkflowsCommandEntry`          | function  | Returns the `workflows` `ICommand` metadata entry.                             |
| `WorkflowsCommandSource`               | class     | `ICommandSource` exposing the `workflows` command.                             |
| `executeWorkflowsCreate`               | function  | Executor for `/workflows create` (NL authoring + run).                         |
| `IWorkflowsCreateDeps`                 | interface | Create seam: `workspace?`, `providerDefinitions?`, `resolveProvider?`, `now?`. |
| `parseCreateArgs`                      | function  | Parse `create` args (description + `--input`/`--name`).                        |
| `executeWorkflowsList`                 | function  | Executor for `/workflows list`.                                                |
| `executeWorkflowsRun`                  | function  | Executor for `/workflows run <file>`.                                          |
| `AGENT_COMMAND_WORKFLOWS_PACKAGE_NAME` | const     | Package-name constant.                                                         |

## Extension Points

New subcommands are added by extending the dispatch in `workflows-command-module.ts` and adding an
executor module. Subcommands compose `dag-framework` (and other DAG packages) — never `dag-cli`.

## Error Taxonomy

Executors return `ICommandResult` with `success: false` and a human-readable `message` for terminal
failures (missing file, unreadable/invalid DAG, failed run). Errors are surfaced, never silently
swallowed; no fallback to a default workflow.

## Test Strategy

`src/__tests__/workflows-command-module.test.ts` covers: module shape + slash-free name + subcommands
(incl. `create`); model-invocability (Phase 4); `list` dispatch; usage/unknown-subcommand handling;
`run` usage error; catalog/validate.

`src/__tests__/create-command.test.ts` covers the authoring pipeline with an **injected provider
stub** (deterministic): arg parsing; spec validation; TC-02 author→save→run (uppercased output);
`--input` precedence over `sampleInput`; TC-03 self-contained re-run reproduces the result; TC-04
no-provider → actionable error + no write; TC-05 prompt-node create/save/reuse. The live LLM call is
exercised out-of-band (one live UE per phase) since unit tests must stay deterministic.

## Class Contract Registry

### Interface Implementations

| Interface        | Implementor                              | Kind       | Location                          |
| ---------------- | ---------------------------------------- | ---------- | --------------------------------- |
| `ICommandSource` | `WorkflowsCommandSource`                 | production | `src/workflows-command-module.ts` |
| `ICommandModule` | (factory) `createWorkflowsCommandModule` | production | `src/workflows-command-module.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                                              | Consumer       | Location                                                                         |
| ------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------- |
| `agent-framework` command contracts + `createProviderFromSettings` | this module    | `src/`                                                                           |
| `agent-core` `IAIProvider` + message factories                     | authoring      | `src/authoring/author.ts`                                                        |
| `dag-framework` `LocalDagRuntimeProvider` + registry               | executors      | `src/list-command.ts`, `src/run-command.ts`, `src/authoring/execute-workflow.ts` |
| `dag-builder` `buildDagFromPipeline` / converters                  | assembly + run | `src/authoring/assemble.ts`, `src/run-command.ts`                                |
| `dag-node` `buildNodeDefinitionAssembly`                           | node catalog   | `src/authoring/node-catalog.ts`                                                  |
| `dag-node-instant-node` prompt-node factory                        | Phase 3 nodes  | `src/create-command.ts`, `src/persistence/instant-node-loader.ts`                |
