# DAG CLI Specification

## Scope

Command-line client for the Robota DAG orchestration HTTP API. This package is an operational tool for humans and AI agents that need to inspect definitions, list runtime nodes, create runs, start runs, and fetch run status/results from `dag-orchestrator-server`.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own operational HTTP client contracts. Those belong to `@robota-sdk/dag-orchestration-client`.
- Does not own server-side API problem detail mapping. That belongs to `@robota-sdk/dag-api`.
- Does not import or extend `@robota-sdk/agent-cli`; the agent TUI remains a separate thin UI.
- Does not execute DAGs locally. All execution commands call `dag-orchestrator-server`.

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

- `IDagDefinition`, `IPartialRunRequest`, `TPortPayload` from `@robota-sdk/dag-core`
- `IOrchestrationProblemDetails`, `DagOrchestrationHttpClient`, run draft request aliases, `IDagOrchestrationPublishedWorkflowRunRequest`, and orchestrator HTTP response types from `@robota-sdk/dag-orchestration-client`

## Public API Surface

- `runDagCli(args, options)` — programmatic command runner used by the bin entrypoint and tests.

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

| Contract Owner                                      | Consumer   | Location |
| --------------------------------------------------- | ---------- | -------- |
| `dag-core` domain types                             | CLI runner | `src/`   |
| `dag-orchestration-client` HTTP client and payloads | CLI runner | `src/`   |

## Test Strategy

- Unit tests cover command parsing, server URL resolution, file JSON payloads, run creation payloads, run draft routing, published workflow version/override routing, and JSON output.
- Tests inject a fake fetch and fake file reader; no network or filesystem access is required.
- Run: `pnpm --filter @robota-sdk/dag-cli test`
