# DAG Orchestration Client Specification

## Scope

Thin operational HTTP client and response contracts for Robota DAG orchestration endpoints.
This package is consumed by command-line and MCP clients that call `dag-orchestrator-server`.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own API controller composition. That belongs to `@robota-sdk/dag-api`.
- Does not own server route implementations. Those belong to `dag-orchestrator-server`.
- Does not render UI or own CLI/MCP command behavior.
- Depends only on `@robota-sdk/dag-core` for request payload domain types.

## Architecture Overview

- `orchestration-http-client.ts` owns endpoint path construction, request serialization, response parsing, and the injectable fetch port.
- The client is intentionally thin: it forwards server response payloads without converting them into CLI or MCP-specific output.
- Endpoint inventory remains intentionally limited to the routes currently consumed by operational clients.

## Endpoint Coverage Policy

`DagOrchestrationHttpClient` exposes only endpoint groups whose operational request/response
contracts are already package-owned.

| Endpoint Group                        | Status  | Contract Owner                                         | Notes                                      |
| ------------------------------------- | ------- | ------------------------------------------------------ | ------------------------------------------ |
| Definition CRUD/publish/validate      | active  | `dag-api` + this package                               | Current CLI/MCP surface.                   |
| Node catalog list                     | active  | `dag-api` + this package                               | Current CLI/MCP surface.                   |
| Run create/start/status/result        | active  | `dag-orchestrator` + this package                      | Current CLI/MCP surface.                   |
| Run drafts                            | blocked | `dag-core` domain types, route-local HTTP aliases      | Add aliases before client methods.         |
| Published workflow runs               | blocked | route-local HTTP aliases                               | Add aliases before client methods.         |
| Asset upload/metadata/content         | blocked | `dag-core` asset store types, route-local HTTP aliases | Add aliases before client methods.         |
| Cost metadata                         | blocked | `dag-cost` domain types, route-local HTTP envelopes    | Normalize envelopes before client methods. |
| Admin bootstrap                       | local   | `dag-orchestrator-server`                              | Not planned for operational clients.       |
| ComfyUI proxy and runtime asset proxy | local   | Backend-native compatibility shape                     | Not wrapped by this package.               |
| Run progress WebSocket                | blocked | `dag-core` event type, route-local envelope            | Add bridge contract tests before clients.  |

Client expansion rule: CLI and MCP packages may add a command or tool only after the endpoint group
is `active` in this table.

## Type Ownership

This package is SSOT for:

- `TDagOrchestrationFetch`
- `TDagOrchestrationPayloadValue`
- `IDagOrchestrationJsonObject`
- `IOrchestrationProblemDetails`
- `IDagOrchestrationHttpClientConfig`
- `IDagOrchestrationHttpPayload`
- `IDagOrchestrationHttpResponse`
- `IDagOrchestrationListDefinitionsInput`
- `IDagOrchestrationUpdateDraftInput`
- `IDagOrchestrationCreateRunInput`
- `IDagOrchestrationHttpClient`

Imported from other packages:

- `IDagDefinition`, `IPartialRunRequest`, and `TPortPayload` from `@robota-sdk/dag-core`

## Public API Surface

- `DagOrchestrationHttpClient` -- shared HTTP client for definition, node catalog, and run lifecycle endpoints.

## Extension Points

- `TDagOrchestrationFetch` allows tests, CLIs, MCP servers, and alternate runtimes to inject a fetch-compatible implementation.
- Consumers own their own command, tool, and output formatting layers.

## Error Taxonomy

Server-originated errors are represented structurally as `IOrchestrationProblemDetails`. The canonical server-side `IProblemDetails` mapping remains owned by `@robota-sdk/dag-api`; this package keeps only the structural client-facing payload shape needed by operational clients.

## Class Contract Registry

### Interface Implementations

| Interface                     | Implementor                  | Kind       | Location                           |
| ----------------------------- | ---------------------------- | ---------- | ---------------------------------- |
| `IDagOrchestrationHttpClient` | `DagOrchestrationHttpClient` | production | `src/orchestration-http-client.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Port/Type Owner | Consumer                     | Location                           |
| --------------- | ---------------------------- | ---------------------------------- |
| `dag-core`      | `DagOrchestrationHttpClient` | `src/orchestration-http-client.ts` |

## Test Strategy

- Unit tests verify endpoint path construction, query encoding, request method selection, body serialization, and response pass-through.
- Tests inject a fake fetch implementation; no network access is required.
- Run: `pnpm --filter @robota-sdk/dag-orchestration-client test`
