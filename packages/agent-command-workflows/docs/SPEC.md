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

A bridge package. `createWorkflowsCommandModule({ project?, workspace?, providerDefinitions?, settingsSources? })` returns an
`ICommandModule` whose `ISystemCommand.execute` parses a leading subcommand token and dispatches to an
executor. `project` is an exact-instance `IWorkflowProject` derived from a framework authority; absence
is Restricted for every workflow subcommand. Executors return an `ICommandResult`. No state is held;
providers are created per invocation from explicit settings sources.

### One surface, four shared seams (WORKFLOW-005 P3)

The six subcommands are one surface, not six ad-hoc executors. Everything a subcommand shares with
its siblings has exactly one owner module:

| Seam                | Owner                       | Consumers                                                       |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| Subcommand registry | `src/subcommands.ts`        | the module's `ICommand[]`, the usage block, every `Usage:` line |
| Argument grammar    | `src/args.ts`               | `parseFileArg` (`validate`/`run`), `tokenize` (authoring args)  |
| Node catalog        | `src/workspace-runtime.ts`  | `list`, `validate`, `run`                                       |
| Authoring pipeline  | `src/authoring/pipeline.ts` | `create`, `build`                                               |

- **Subcommand registry.** `WORKFLOWS_SUBCOMMANDS` is the SSOT for the subcommand list, each
  `argumentHint`, the `/workflows` usage block (`renderWorkflowsUsage()`), and the per-subcommand
  `Usage:` line an executor emits on a bad argument (`subcommandUsage(name)`) — a hint and its usage
  text cannot drift apart, and an advertised verb cannot be unroutable (both mechanically tested).
- **Argument grammar.** One quote-aware tokenizer serves both shapes: the authoring subcommands
  (`parseAuthoringArgs` — description + `--input`/`--name`) and the file-taking subcommands
  (`parseFileArg` — exactly one quote-aware path). `validate`/`run` therefore accept a quoted path
  and reject surplus/unknown tokens with their usage line instead of folding them into the path.
- **Node catalog.** `createWorkspaceRuntime(project, layout)` is the ONLY place a
  `LocalDagRuntimeProvider` is constructed for a workspace: built-in registry **plus** the instant
  nodes saved under `<root>/nodes/`. So the catalog a workflow is _validated_ and _listed_ against is
  exactly the catalog it _runs_ against. (Before P3, `validate` and `list` built a bare provider and
  were blind to the workspace's own nodes — which made `build`'s "Next steps: /workflows validate
  `<path>`" hand-off fail with `unknown node type` for every workflow `build` authored with a
  `newNodes` prompt node.) `list` marks the saved ones `[saved in <root>/nodes]`.
- **Authoring pipeline.** See below.

### NL authoring pipeline (`create` + `build`, FLOW-007 / WORKFLOW-004)

`authoring/pipeline.ts` owns the whole author→save half, shared verbatim by BOTH authoring
subcommands (P3 — previously each carried its own copy of these steps, free to diverge). The LLM only
**authors**; the runtime **executes**:

1. **Node catalog** — `createDefaultNodeRegistrySync()` plus prompt nodes read root-relatively through
   `IWorkflowProject` under `<root>/nodes/` → `INodeManifest[]` via `buildNodeDefinitionAssembly`
   (`@robota-sdk/dag-node`).
2. **Author** — the ACTIVE provider (resolved with `createProviderFromSettings` +
   injected `providerDefinitions`) is prompted with the catalog and must return a JSON-only workflow
   spec (`authoring/spec.ts` validates it).
3. **Instant nodes (Phase 3)** — any `newNodes` become prompt-backed nodes
   (`createPromptBackedNodeDefinition`, `@robota-sdk/dag-node-instant-node`), written through the
   separately approved project mutation capability to
   `<root>/nodes/<type>.node.json` and reusable on later `create`s.
4. **Assemble** — `buildDagFromPipeline` (`@robota-sdk/dag-builder`) → `IDagDefinition`; the resolved
   run input is baked into the `input` node so the artifact is self-contained.
5. **Save** — the legible `IDagDefinition` is written root-relatively to `<root>/<name><ext>`. This is where the
   shared pipeline ends and the two subcommands diverge: `create` then executes the definition
   in-process (converting to the runtime workflow-file format via `toDagWorkflowFile`); `build`
   stops and reports the saved path.

The `workflows` command is **model-invocable** (FLOW-007 Phase 4): the agent can author + run a
workflow from a chat request.

### Author-without-run (`build`, WORKFLOW-004)

`/workflows build "<description>" [--input k=v] [--name <name>]` is the **generate-for-review**
counterpart to `create`: literally the same `authorAndSaveWorkflow` call (same arg grammar, same
provider seam, same catalog, same persistence) — it just stops there and reports the saved path with
the explicit next steps (`/workflows validate <path>`, `/workflows run <path>`), which now succeed
even when the artifact uses a node `build` itself authored (P3 shared catalog). **`build` never
executes**: neither `build-command.ts` nor the shared `authoring/pipeline.ts` imports
`authoring/execute-workflow.ts`, so no module on `build`'s import path can construct a DAG runtime —
enforced by a static import guard AND the runtime execute-canary. Failures before assembly leave
nothing on disk (no provider / invalid or unassemblable spec → failed `ICommandResult`, fs
untouched). `build` is model-invocable — strictly less privileged than `create` (it cannot execute
anything).

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

| Export                                 | Kind      | Description                                                                                                        |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `createWorkflowsCommandModule`         | function  | Returns the `workflows` `ICommandModule` for agent-cli composition.                                                |
| `IWorkflowsCommandModuleDeps`          | interface | Injected deps: authority-backed `project?`, `workspace?`, `providerDefinitions?`, and explicit `settingsSources?`. |
| `createWorkspaceWorkflowProject`       | function  | Derive the workflow read view from an accepted authority and optional same-authority mutation capability.          |
| `IWorkflowProject`                     | interface | Exact-instance root-relative workflow read/write capability; its marker cannot be structurally forged.             |
| `createWorkflowsCommandEntry`          | function  | Returns the `workflows` `ICommand` metadata entry.                                                                 |
| `WorkflowsCommandSource`               | class     | `ICommandSource` exposing the `workflows` command.                                                                 |
| `executeWorkflowsCreate`               | function  | Executor for `/workflows create` (NL authoring + run).                                                             |
| `executeWorkflowsBuild`                | function  | Executor for `/workflows build` (NL authoring + save — never executes).                                            |
| `IWorkflowsAuthoringDeps`              | interface | Authoring seam: `workspace?`, `providerDefinitions?`, `settingsSources?`, `resolveProvider?`, `model?`, `now?`.    |
| `parseAuthoringArgs`                   | function  | Parse `create`/`build` args (description + `--input`/`--name` — shared grammar).                                   |
| `IParsedAuthoringArgs`                 | interface | Result of `parseAuthoringArgs`: `description`, `nameOverride?`, `inputs`.                                          |
| `WORKFLOWS_SUBCOMMANDS`                | const     | The subcommand registry (SSOT for names, hints, descriptions, model-invocability).                                 |
| `IWorkflowsSubcommand`                 | interface | One registry entry.                                                                                                |
| `subcommandUsage`                      | function  | The `Usage: /workflows <name> <hint>` line for one subcommand, derived from the registry.                          |
| `renderWorkflowsUsage`                 | function  | The multi-line `/workflows` usage block, derived from the registry.                                                |
| `executeWorkflowsList`                 | function  | Executor for `/workflows list` over the explicit project capability.                                               |
| `executeWorkflowsRun`                  | function  | Executor for `/workflows run <file>`.                                                                              |
| `AGENT_COMMAND_WORKFLOWS_PACKAGE_NAME` | const     | Package-name constant.                                                                                             |

The `workflows` command dispatches six first-class subcommands (in `workflows-command-module.ts`):
`create`, `build`, `list`, `catalog`, `validate`, and `run`. The `catalog` and `validate` executors
(`executeWorkflowsCatalog`, `executeWorkflowsValidate`) are **internal** — dispatched inside the module
but not re-exported from the package root (`src/index.ts`) — so they are part of the command surface,
not the public API. Only `create`/`build`/`list`/`run` executors are root-exported (above).

**Not exposed as a subcommand: a standalone `save`.** Persisting is not a user-facing verb on this
surface — `create` and `build` both end in a save (`persistence/workspace-writer.ts`), and
`list`/`catalog` read back what they wrote. A separate `save <json>` verb would be an _import_ of
externally-supplied graph/node data, i.e. a new capability (and the dag-cli MCP toolset's
`dag_import` / `dag_instant_node_save` already cover the MCP-side need), not part of P3's
surface-unification intent.

## Extension Points

New subcommands are added by extending the dispatch in `workflows-command-module.ts` and adding an
executor module. Subcommands compose `dag-framework` (and other DAG packages) — never `dag-cli`.

## Error Taxonomy

Executors return `ICommandResult` with `success: false` and a human-readable `message` for terminal
failures (missing authority/mutation, missing file, unreadable/invalid DAG, failed run). Errors are
surfaced, never silently swallowed; no fallback to `cwd`, generic filesystem access, or a default workflow.

## Test Strategy

`src/__tests__/workflows-command-module.test.ts` covers: module shape + slash-free name + subcommands
(incl. `create`); model-invocability (Phase 4); `list` dispatch; usage/unknown-subcommand handling;
`run` usage error; catalog/validate. Plus two P3 **anti-drift guards** over the subcommand SSOT:
every registered subcommand is actually dispatched (no advertised-but-unroutable verb), and every
registered `argumentHint` is advertised verbatim AND matches the `Usage:` line derived for it.

`src/__tests__/surface-unification.test.ts` (WORKFLOW-005 P3) covers the two cross-subcommand
invariants: **one catalog** — a workflow `build` authored with a `newNodes` prompt node validates
cleanly (it previously failed `unknown node type` on the node `build` had just saved) and `list`
shows the workspace-saved node alongside the built-ins; **one grammar** — `validate`/`run` accept a
quoted path and reject surplus arguments with their usage line instead of folding them into the path.

`src/__tests__/create-command.test.ts` covers the authoring pipeline with an **injected provider
stub** (deterministic): arg parsing; spec validation (incl. Markdown code-fence tolerance); TC-02
author→save→run (uppercased output); `--input` precedence over `sampleInput`; TC-03 self-contained
re-run reproduces the result; TC-04 no-provider → actionable error + no write; TC-05 prompt-node
create/save/reuse — which **clears all provider keys** (`vi.stubEnv`) so the key-using node run is
deterministic and free of any network call, and **explicitly asserts** the missing-key failure is
detected/surfaced (never silently tolerated, never a real LLM call in the unit suite).

`src/__tests__/build-command.test.ts` covers `build` with the same injected provider stub:
author→save with NO run output and a **mechanical non-execution canary** (the `dag-framework`
runtime execute path is spied and asserted at 0 calls) plus a **static import guard** proving neither
`build-command.ts` nor the shared `authoring/pipeline.ts` imports the execution module (the canary
proves it for the tested runs; the guard proves it for all inputs); the saved artifact round-trips
through the existing `validate` and `run` executors; invalid/unassemblable spec → failed result + fs untouched;
no provider → actionable error + no write; `newNodes` manifests persisted inert under
`<root>/nodes/` without execution.

`src/__tests__/workspace-writer.test.ts` covers the instant-node persistence round-trip on real fs:
a prompt node save→reload; a **composite (DAG-wrapping) node** save→reload→**run** (WORKFLOW-005 P2 —
the reloaded composite executes its inner DAG on the in-process runtime via the injected sub-runner
`loadInstantNodes` builds, and its exposed output flows through); and a non-instant (built-in) node is
skipped. Prompt and composite nodes both persist through the shared
`@robota-sdk/dag-node-instant-node` `toPersisted()`/`parse`/`rehydrate` abstraction — a composite's
behavioral sub-runner is never serialized, it is rebuilt on reload.

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
| `dag-framework` `LocalDagRuntimeProvider` + registry               | executors      | `src/workspace-runtime.ts`, `src/authoring/execute-workflow.ts`, `src/persistence/instant-node-loader.ts`       |
| `dag-builder` `buildDagFromPipeline` / converters                  | assembly + run | `src/authoring/assemble.ts`, `src/run-command.ts`                                                               |
| `dag-node` `buildNodeDefinitionAssembly`                           | node catalog   | `src/authoring/node-catalog.ts`                                                                                 |
| `dag-node-instant-node` prompt-node factory                        | Phase 3 nodes  | `src/authoring/pipeline.ts`, `src/persistence/instant-node-loader.ts`                                           |
