# DAG CLI Specification

## Scope

Local-first command-line workflow tool for building, running, and inspecting Robota DAG workflows. This package is an operational tool for humans and AI agents that author, validate, execute, and inspect DAG workflows locally (no server required) via an in-process runner, plus supporting commands for cost estimation, MCP serving, node inspection, cataloging, sharing, and diagnostics. When a server URL is configured it can additionally delegate the orchestration command groups (definitions, runs, run-drafts, cost metadata, assets, published workflows) to `dag-orchestrator-server` over HTTP.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own operational HTTP client contracts. Those belong to `@robota-sdk/dag-orchestration-client`.
- Does not own server-side API problem detail mapping. That belongs to `@robota-sdk/dag-api`.
- Does not import or extend `@robota-sdk/agent-cli`; the agent TUI remains a separate thin UI.
- Supports local execution mode (default) that runs DAGs in-process via a composition built by `createExecutionComposition` from `@robota-sdk/dag-framework` over `dag-adapters-local` in-memory adapters, requiring no server.
- HTTP server mode is available via `--server <url>` for compatibility with `dag-orchestrator-server`.

## Architecture Overview

- `bin.ts` is the executable entrypoint for `robota-dag`.
- `runner.ts` parses argv, applies environment/default config, dispatches the local-first top-level commands, and writes JSON output.
- `src/commands/` holds one handler module per top-level command (see Command Surface).
- `src/local-runner/` executes DAGs in-process by composing a runtime via `createExecutionComposition` from `@robota-sdk/dag-framework` over `dag-adapters-local` adapters; `createCliNodeRegistry()` supplies the built-in node definitions.
- `@robota-sdk/dag-builder` supplies pipeline/spec build and workflow-file conversion helpers (`buildDagFromPipeline`, `fromDagWorkflowFile`, `isWorkflowFileFormat`) used by the build/convert/explain/view/migrate/cost commands.
- `@robota-sdk/dag-orchestration-client` owns the shared `DagOrchestrationHttpClient` used for HTTP server-mode calls.
- `json.ts` owns JSON parsing, file input decoding, and JSON output formatting.

## Command Surface

The CLI is local-first: `runner.ts` dispatches the following top-level commands to in-process
handlers under `src/commands/`, none of which require a server. A global `--workspace <dir>` flag
(FLOW-007) and a `--server`/`--server-url` flag (HTTP server mode) may precede a command.

Local-first top-level commands (`src/commands/`):

- `run <file>` — execute a workflow locally (routes to HTTP server mode when `--server` is present)
- `runs` — detached-run provider management (PROVIDER-011); falls through to the server runs API when a server URL is configured
- `validate <file>` — validate a DAG without executing
- `node <subcommand>` — inspect the local node registry
- `init` — scaffold a new DAG project
- `mcp` — start the local MCP server (also `mcp schema`, `--inspect`)
- `catalog <subcommand>` — manage the local workflow catalog
- `template <subcommand>` — built-in topology templates
- `migrate` — migrate DAG file formats
- `doctor` — environment diagnostics
- `build` — generate a DAG file from a simplified spec
- `convert` — convert spec formats (linear, mermaid → IBuildSpec JSON)
- `diff` — structural diff between two DAG files
- `cost <subcommand>` — cost estimation
- `share` — share a DAG via GitHub Gist
- `demo` — run a local demo (no API key required)
- `explain <file>` — describe a DAG's structure
- `compare` — compare providers
- `tutorial` — interactive onboarding walkthrough
- `lock <subcommand>` — lockfile management
- `telemetry <subcommand>` — telemetry opt-in/out management
- `lint <file>` — lint a DAG file
- `keys <subcommand>` — API key management
- `benchmark` — multi-run latency/cost benchmarking (ECO-011)
- `perf` — in-process execution overhead measurement (PERF-010)
- `aav` — Agent Authoring Velocity benchmark (COMPOSE-006)
- `pipe` — stdin text → pipeline → stdout
- `save` — save a pipeline to a catalog file
- `alias <subcommand>` — alias management (add/list/remove)
- `from-mermaid` — convert Mermaid → DAG JSON
- `describe` — natural-language → DAG generation (requires `ANTHROPIC_API_KEY`)
- `fix <file>` — analyze and repair a broken DAG
- `studio` — start the local web UI server
- `view <file>` — ASCII flow diagram viewer
- `session <subcommand>` — bounded agent session management

### HTTP server mode

Server URL resolution:

1. `--server-url <url>`
2. `ROBOTA_DAG_SERVER_URL`
3. `http://localhost:3012`

When a server URL is configured, unmatched commands fall through to `dispatchDagCliCommand`, which
proxies the orchestration command groups to `dag-orchestrator-server` over HTTP:

- `assets upload|get|download`
- `cost-meta list|get|create|update|delete|validate|preview`
- `definitions list|get|create|publish`
- `nodes list`
- `runs create|start|status|result`
- `run-drafts create|get|replace|reset|overwrite`
- `workflows start <dagId> [--version <version>] [--json <json|@file>]`

Output is JSON. Success responses are printed as returned by the server. CLI validation failures use a JSON envelope with `ok: false`, `status: 2`, and a single problem entry.

## Workspace (FLOW-007)

A global `--workspace <dir>` flag selects the on-disk workspace root. When set, the dispatch root
resolves an `IWorkspaceLayout` (root dir + workflow extension) and threads it through as
`IDagCliRunOptions.workspace`. The default layout is `.workflows/` under the working directory.
Authored workflows and their local prompt/code node files are read from this workspace layout.

## Instant-Node Persistence (DATA-004)

The local runner's instant-node reload path
(`src/local-runner/persistence/store.ts`) delegates parsing and rehydration to
`@robota-sdk/dag-node-instant-node` via `parsePersistedInstantNode` (parse the persisted record)
and `rehydrateInstantNode` (rebuild the live definition, injecting a `compositeRunner`). The CLI
no longer owns the instant-node persistence schema.

## Type Ownership

This package is SSOT for:

- `IDagCliEnvironment`
- `IDagCliIo`
- `IDagCliRunOptions` — carries the FLOW-007 `workspace?: IWorkspaceLayout` field.
- `IDagCliFailure`
- `IDagCliCommandResult`
- `TDagCliFetch`
- `TDagCliServerResponse`
- `TDagCliOutputPayload`
- `TDagCliValueResult<TValue>`

Only `runDagCli` and the types re-exported by the barrel (`IDagCliEnvironment`, `IDagCliIo`,
`IDagCliRunOptions`, `TDagCliFetch`, `TDagCliOutputPayload`, `TDagCliServerResponse`) are part of
the public surface. Remaining types in `src/types.ts` are package-internal.

Imported from other packages:

- `IDagDefinition`, `IPartialRunRequest`, `TPortPayload`, `IDagNodeDefinition`, `LifecycleTaskExecutorPort`, `IWorkspaceLayout` from `@robota-sdk/dag-core`
- `parsePersistedInstantNode`, `rehydrateInstantNode` from `@robota-sdk/dag-node-instant-node` (instant-node reload, DATA-004)
- `IOrchestrationProblemDetails`, `DagOrchestrationHttpClient`, asset request aliases, cost metadata request aliases, run draft request aliases, `IDagOrchestrationPublishedWorkflowRunRequest`, and orchestrator HTTP response types from `@robota-sdk/dag-orchestration-client`
- `IDagExecutionComposition`, `IRuntimeRunProgressEventBusPort` from `@robota-sdk/dag-api`
- `createExecutionComposition` (in-process run composition), `createDefaultNodeRegistrySync`, `scanWorkspaceCatalog`, `HttpDagRuntimeProvider`, `LocalDagRuntimeProvider` from `@robota-sdk/dag-framework`
- `buildDagFromPipeline`, `fromDagWorkflowFile`, `isWorkflowFileFormat`, `IDagBuildInput`, `IPipelineNodeSpec` from `@robota-sdk/dag-builder`
- `InMemoryStoragePort`, `InMemoryQueuePort`, `InMemoryLeasePort`, `SystemClockPort` from `@robota-sdk/dag-adapters-local`
- `buildNodeDefinitionAssembly`, `StaticNodeLifecycleFactory`, `StaticNodeManifestRegistry`, `StaticNodeTaskHandlerRegistry` from `@robota-sdk/dag-node`
- Node definition classes from `@robota-sdk/dag-node-*` packages

## `dag run --watch` Flags

| Flag          | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `--watch`     | Re-run automatically when the file changes                    |
| `--no-diff`   | Disable output diff between runs (show full output each time) |
| `--show-full` | Show full diff even when it exceeds 50 changed lines          |

When `--no-diff` is not set, each re-run prints only the lines that changed vs. the previous run. Removed lines are prefixed with `- ` (red), added lines with `+ ` (green). Identical output prints `[Run #N] Output unchanged.`. Diffs exceeding 50 changed lines are truncated with a count hint; use `--show-full` to bypass truncation.

## Public API Surface

The barrel (`src/index.ts`) exports exactly:

- `runDagCli(args, options)` — programmatic command runner used by the bin entrypoint and tests.
- Types: `IDagCliEnvironment`, `IDagCliIo`, `IDagCliRunOptions`, `TDagCliFetch`,
  `TDagCliOutputPayload`, `TDagCliServerResponse`.

The following are **package-internal** (not exported by the barrel):

- `LocalDagRunner` — in-process DAG runner that embeds the runtime, worker, and adapters without a server (`src/local-runner/`).
- `createCliNodeRegistry()` — returns all built-in node definitions for use with `LocalDagRunner` (`src/local-runner/`).
- `computeLineDiff(before, after, options?)` — LCS-based line diff utility (`src/lib/line-diff.ts`).
- `getMainOutput(result)` — extracts primary string output from a run result for diff comparison.

## stderr / stdout Contract

| Channel    | Content                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stdout** | Result data — `--result` final text, `--output json` run result, `--keys` picked values, `--dry-run` JSON, `dag validate --output json` validation result                              |
| **stderr** | All error messages, warnings, and diagnostics — `--node-config` node-not-found and unknown-key warnings, usage/setup error JSON (`{ "ok": false, ... }`), runtime execution error text |

Scripts capturing `--result` or `--output json` output should read stdout only. Error handling should read stderr.

## Error Taxonomy

- `DAG_CLI_USAGE_ERROR` — invalid command, missing argument, or invalid option.
- `DAG_CLI_JSON_PARSE_ERROR` — JSON argument or file content could not be parsed.
- Server-originated problem detail payloads are passed through unchanged.

## Class Contract Registry

### Interface Implementations

None.

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Contract Owner                                      | Consumer       | Location            |
| --------------------------------------------------- | -------------- | ------------------- |
| `dag-core` domain types                             | CLI runner     | `src/`              |
| `dag-orchestration-client` HTTP client and payloads | CLI runner     | `src/`              |
| `dag-api` composition and event bus                 | LocalDagRunner | `src/local-runner/` |
| `dag-framework` `createExecutionComposition`        | LocalDagRunner | `src/local-runner/` |
| `dag-builder` build/workflow-file helpers           | CLI commands   | `src/commands/`     |
| `dag-adapters-local` in-memory adapters             | LocalDagRunner | `src/local-runner/` |
| `dag-node` lifecycle and registry                   | LocalDagRunner | `src/local-runner/` |
| `dag-node-*` node definitions                       | node-registry  | `src/local-runner/` |

## Test Strategy

- Unit tests cover command parsing, server URL resolution, file JSON payloads, run creation payloads, run draft routing, published workflow version/override routing, asset upload/metadata/content download routing, cost metadata CRUD/formula routing, cost metadata argument validation, and JSON output.
- Tests inject a fake fetch and fake file reader; no network or filesystem access is required.
- Run: `pnpm --filter @robota-sdk/dag-cli test`
