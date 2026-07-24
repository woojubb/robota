# Agent Command Workflows Specification

## Scope

Provides the agent-cli `/workflows` command module — a bridge that surfaces the DAG workflow engine
inside the agent CLI by composing `@robota-sdk/dag-framework` in-process. Owns the `workflows`
`ICommandModule`, its subcommand dispatch, the per-subcommand executors (`create`, `build`, `list`,
`catalog`, `validate`, `run`), and the **natural-language authoring pipeline** behind `create` and
`build` (FLOW-007, WORKFLOW-004).

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

### Author-without-run (`build`, WORKFLOW-004)

`/workflows build "<description>" [--input k=v] [--name <name>]` is the **generate-for-review**
counterpart to `create`: the SAME authoring pipeline (steps 1–4 above, identical arg grammar via the
shared `parseCreateArgs`) but it stops at **save** — author → parse/validate → assemble → bake input →
persist prompt nodes + workflow — and reports the saved path with the explicit next steps
(`/workflows validate <path>`, `/workflows run <path>`). **`build` never executes**: it does not
import `authoring/execute-workflow.ts`, so no DAG runtime is constructed and no node (LLM or
side-effecting) runs. Failures before assembly leave nothing on disk (no provider / invalid or
unassemblable spec → failed `ICommandResult`, fs untouched). `build` is model-invocable — strictly
less privileged than `create` (it cannot execute anything).

**Provider seam (the WORKFLOW-004 decision):** both authoring subcommands share ONE seam — deps
injected at the composition root (`IWorkflowsCommandModuleDeps.providerDefinitions`), the provider
resolved lazily per invocation via `createProviderFromSettings` (+ model from
`readProviderSettings`), with a `resolveProvider` test seam. The module sees only
`IAIProvider`/`IProviderDefinition` from `agent-core` and imports zero concrete provider packages. A
CMD-004 `model` host adapter was evaluated and deferred: if session-live authoring fidelity is ever
required, `create` and `build` migrate together in one follow-up.

## Type Ownership

| Type                                     | Location | Purpose                                               |
| ---------------------------------------- | -------- | ----------------------------------------------------- |
| (none — this package owns no SSOT types) | —        | Consumes command + DAG contracts from owner packages. |

## Public API Surface

| Export                                 | Kind      | Description                                                                                                              |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `createWorkflowsCommandModule`         | function  | Returns the `workflows` `ICommandModule` for agent-cli composition.                                                      |
| `IWorkflowsCommandModuleDeps`          | interface | Injected deps: `workspace?`, `providerDefinitions?`.                                                                     |
| `createWorkflowsCommandEntry`          | function  | Returns the `workflows` `ICommand` metadata entry.                                                                       |
| `WorkflowsCommandSource`               | class     | `ICommandSource` exposing the `workflows` command.                                                                       |
| `executeWorkflowsCreate`               | function  | Executor for `/workflows create` (NL authoring + run).                                                                   |
| `executeWorkflowsBuild`                | function  | Executor for `/workflows build` (NL authoring + save — never executes).                                                  |
| `IWorkflowsCreateDeps`                 | interface | Authoring seam (shared by `create`/`build`): `workspace?`, `providerDefinitions?`, `resolveProvider?`, `model?`, `now?`. |
| `parseCreateArgs`                      | function  | Parse `create`/`build` args (description + `--input`/`--name` — shared grammar).                                         |
| `executeWorkflowsList`                 | function  | Executor for `/workflows list`.                                                                                          |
| `executeWorkflowsRun`                  | function  | Executor for `/workflows run <file>`.                                                                                    |
| `AGENT_COMMAND_WORKFLOWS_PACKAGE_NAME` | const     | Package-name constant.                                                                                                   |

The `workflows` command dispatches six first-class subcommands (in `workflows-command-module.ts`):
`create`, `build`, `list`, `catalog`, `validate`, and `run`. The `catalog` and `validate` executors
(`executeWorkflowsCatalog`, `executeWorkflowsValidate`) are **internal** — dispatched inside the module
but not re-exported from the package root (`src/index.ts`) — so they are part of the command surface,
not the public API. Only `create`/`build`/`list`/`run` executors are root-exported (above).

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
stub** (deterministic): arg parsing; spec validation (incl. Markdown code-fence tolerance); TC-02
author→save→run (uppercased output); `--input` precedence over `sampleInput`; TC-03 self-contained
re-run reproduces the result; TC-04 no-provider → actionable error + no write; TC-05 prompt-node
create/save/reuse — which **clears all provider keys** (`vi.stubEnv`) so the key-using node run is
deterministic and free of any network call, and **explicitly asserts** the missing-key failure is
detected/surfaced (never silently tolerated, never a real LLM call in the unit suite).

`src/__tests__/build-command.test.ts` covers `build` with the same injected provider stub:
author→save with NO run output and a **mechanical non-execution canary** (the `dag-framework`
runtime execute path is spied and asserted at 0 calls); the saved artifact round-trips through the
existing `validate` and `run` executors; invalid/unassemblable spec → failed result + fs untouched;
no provider → actionable error + no write; `newNodes` manifests persisted inert under
`<root>/nodes/` without execution.

`src/__tests__/create-command.live.test.ts` is an **opt-in live suite** hitting a REAL provider — it
runs only when `RUN_LIVE_LLM=1` AND a provider key are both present, so normal `pnpm test` / CI skip
it (no network, cost, or key). Run it with `pnpm --filter @robota-sdk/agent-command-workflows
test:live` (key from the environment; see the `provider-keys-local-run` note). It automates the
per-phase live UEs: existing-node authoring (uppercase), a model-composed multi-step pipeline
(trim→uppercase), a Phase-3 prompt node created + persisted with the active provider + executed, and a
re-run-from-disk round-trip. A guard test fails loudly if `RUN_LIVE_LLM=1` is set without a key.

## Class Contract Registry

### Interface Implementations

| Interface        | Implementor                              | Kind       | Location                          |
| ---------------- | ---------------------------------------- | ---------- | --------------------------------- |
| `ICommandSource` | `WorkflowsCommandSource`                 | production | `src/workflows-command-module.ts` |
| `ICommandModule` | (factory) `createWorkflowsCommandModule` | production | `src/workflows-command-module.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                                              | Consumer       | Location                                                                                                        |
| ------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `agent-framework` command contracts + `createProviderFromSettings` | this module    | `src/`                                                                                                          |
| `agent-core` `IAIProvider` + message factories                     | authoring      | `src/authoring/author.ts`                                                                                       |
| `dag-core` workflow-file/node/definition + workspace-layout types  | this module    | `src/run-command.ts`, `src/validate-command.ts`, `src/catalog-command.ts`, `src/authoring/`, `src/persistence/` |
| `dag-framework` `LocalDagRuntimeProvider` + registry               | executors      | `src/list-command.ts`, `src/run-command.ts`, `src/authoring/execute-workflow.ts`                                |
| `dag-builder` `buildDagFromPipeline` / converters                  | assembly + run | `src/authoring/assemble.ts`, `src/run-command.ts`                                                               |
| `dag-node` `buildNodeDefinitionAssembly`                           | node catalog   | `src/authoring/node-catalog.ts`                                                                                 |
| `dag-node-instant-node` prompt-node factory                        | Phase 3 nodes  | `src/create-command.ts`, `src/persistence/instant-node-loader.ts`                                               |
