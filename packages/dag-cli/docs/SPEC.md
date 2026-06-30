# DAG CLI Specification

## Scope

Command-line client for the Robota DAG orchestration HTTP API. This package is an operational tool for humans and AI agents that need to inspect definitions, list runtime nodes, manage cost metadata, create runs, start runs, and fetch run status/results from `dag-orchestrator-server`.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own operational HTTP client contracts. Those belong to `@robota-sdk/dag-orchestration-client`.
- Does not own server-side API problem detail mapping. That belongs to `@robota-sdk/dag-api`.
- Does not import or extend `@robota-sdk/agent-cli`; the agent TUI remains a separate thin UI.
- Supports local execution mode (default) that embeds `dag-runtime`, `dag-worker`, and `dag-adapters-local` in-process, requiring no server.
- HTTP server mode is available via `--server <url>` for compatibility with `dag-orchestrator-server`.

## Architecture Overview

- `bin.ts` is the executable entrypoint for `robota-dag`.
- `runner.ts` parses argv, applies environment/default config, dispatches commands, and writes JSON output.
- `@robota-sdk/dag-orchestration-client` owns the shared `DagOrchestrationHttpClient` used for HTTP calls.
- `json.ts` owns JSON parsing, file input decoding, and JSON output formatting.

## Command Surface

Server URL resolution:

1. `--server-url <url>`
2. `ROBOTA_DAG_SERVER_URL`
3. `http://localhost:3012`

Commands:

- `assets upload --json <json|@file>`
- `assets get <assetId>`
- `assets download <assetId> --output <path>`
- `cost-meta list`
- `cost-meta get <nodeType>`
- `cost-meta create --json <json|@file>`
- `cost-meta update <nodeType> --json <json|@file>`
- `cost-meta delete <nodeType>`
- `cost-meta validate --json <json|@file>`
- `cost-meta preview --json <json|@file>`
- `definitions list`
- `definitions get <dagId> [--version <version>]`
- `definitions create --file <definition.json>`
- `definitions publish <dagId> [--version <version>]`
- `nodes list`
- `runs create --file <definition.json> [--input <json|@file>] [--partial-start <nodeId>]`
- `runs start <preparationId>`
- `runs status <dagRunId>`
- `runs result <dagRunId>`
- `run-drafts create --json <json|@file>`
- `run-drafts get <draftId>`
- `run-drafts replace <draftId> --json <json|@file>`
- `run-drafts reset <draftId> <nodeId>`
- `run-drafts overwrite <draftId> <nodeId> --json <json|@file>`
- `workflows start <dagId> [--version <version>] [--json <json|@file>]`

Output is JSON. Success responses are printed as returned by the server. CLI validation failures use a JSON envelope with `ok: false`, `status: 2`, and a single problem entry.

## Type Ownership

This package is SSOT for:

- `IDagCliEnvironment`
- `IDagCliIo`
- `IDagCliRunOptions`
- `TDagCliCommandResult`

Imported from other packages:

- `IDagDefinition`, `IPartialRunRequest`, `TPortPayload`, `IDagNodeDefinition`, `LifecycleTaskExecutorPort` from `@robota-sdk/dag-core`
- `IOrchestrationProblemDetails`, `DagOrchestrationHttpClient`, asset request aliases, cost metadata request aliases, run draft request aliases, `IDagOrchestrationPublishedWorkflowRunRequest`, and orchestrator HTTP response types from `@robota-sdk/dag-orchestration-client`
- `IDagExecutionComposition`, `RunProgressEventBus` from `@robota-sdk/dag-api`
- `RunOrchestratorService`, `RunQueryService`, `RunCancelService` from `@robota-sdk/dag-runtime`
- `createWorkerLoopService` from `@robota-sdk/dag-worker`
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

- `runDagCli(args, options)` — programmatic command runner used by the bin entrypoint and tests.
- `LocalDagRunner` — in-process DAG runner that embeds the runtime, worker, and adapters without a server.
- `createDefaultNodeRegistry()` — returns all built-in node definitions for use with `LocalDagRunner`.
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
| `dag-runtime` orchestration services                | LocalDagRunner | `src/local-runner/` |
| `dag-worker` worker loop service                    | LocalDagRunner | `src/local-runner/` |
| `dag-adapters-local` in-memory adapters             | LocalDagRunner | `src/local-runner/` |
| `dag-node` lifecycle and registry                   | LocalDagRunner | `src/local-runner/` |
| `dag-node-*` node definitions                       | node-registry  | `src/local-runner/` |

## Test Strategy

- Unit tests cover command parsing, server URL resolution, file JSON payloads, run creation payloads, run draft routing, published workflow version/override routing, asset upload/metadata/content download routing, cost metadata CRUD/formula routing, cost metadata argument validation, and JSON output.
- Tests inject a fake fetch and fake file reader; no network or filesystem access is required.
- Run: `pnpm --filter @robota-sdk/dag-cli test`
