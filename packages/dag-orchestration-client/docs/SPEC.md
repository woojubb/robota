# DAG Orchestration Client Specification

## Scope

Thin operational HTTP client and response contracts for Robota DAG orchestration endpoints.
This package is consumed by command-line and MCP clients that call `dag-orchestrator-server`.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core` and endpoint-specific domain packages such as `@robota-sdk/dag-cost`.
- Does not own API controller composition. That belongs to `@robota-sdk/dag-api`.
- Does not own server route implementations. Those belong to `dag-orchestrator-server`.
- Does not render UI or own CLI/MCP command behavior.
- Depends on `@robota-sdk/dag-core` and `@robota-sdk/dag-cost` for request payload domain types.

## Architecture Overview

- `orchestration-http-contracts.ts` owns exported request, response, payload, fetch, and HTTP client interface contracts.
- `orchestration-http-client.ts` owns concrete endpoint path construction, request serialization, response parsing, and fetch execution.
- The client is intentionally thin: it forwards server response payloads without converting them into CLI or MCP-specific output.
- Endpoint inventory remains intentionally limited to routes with package-owned request/response contracts.

## Endpoint Coverage Policy

`DagOrchestrationHttpClient` exposes only endpoint groups whose operational request/response
contracts are already package-owned.

| Endpoint Group                        | Status  | Contract Owner                              | Notes                                      |
| ------------------------------------- | ------- | ------------------------------------------- | ------------------------------------------ |
| Definition CRUD/publish/validate      | active  | `dag-api` + this package                    | Current CLI/MCP surface.                   |
| Node catalog list                     | active  | `dag-api` + this package                    | Current CLI/MCP surface.                   |
| Run create/start/status/result        | active  | `dag-orchestrator` + this package           | Current CLI/MCP surface.                   |
| Run drafts                            | active  | `dag-core` domain types + this package      | Current package contract surface.          |
| Published workflow runs               | active  | `dag-core` definition types + this package  | Current package contract surface.          |
| Asset upload/metadata/content         | active  | `dag-core` asset store types + this package | Binary content remains transport-specific. |
| Cost metadata                         | active  | `dag-cost` domain types + this package      | Current package contract surface.          |
| Admin bootstrap                       | local   | `dag-orchestrator-server`                   | Not planned for operational clients.       |
| ComfyUI proxy and runtime asset proxy | local   | Backend-native compatibility shape          | Not wrapped by this package.               |
| Run progress WebSocket                | blocked | `dag-core` event type, route-local envelope | Add bridge contract tests before clients.  |

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
- `IDagOrchestrationAssetUploadRequest`
- `IDagOrchestrationAssetReference`
- `IDagOrchestrationAssetData`
- `IDagOrchestrationAssetSuccessPayload`
- `IDagOrchestrationAssetContentDownloadInfo`
- `TDagOrchestrationCostMetaRequest`
- `IDagOrchestrationCostMetaListData`
- `IDagOrchestrationCostMetaData`
- `IDagOrchestrationCostMetaDeleteData`
- `IDagOrchestrationCostMetaValidateRequest`
- `IDagOrchestrationCostMetaValidationData`
- `IDagOrchestrationCostMetaPreviewRequest`
- `IDagOrchestrationCostMetaPreviewData`
- `IDagOrchestrationCostMetaListSuccessPayload`
- `IDagOrchestrationCostMetaSuccessPayload`
- `IDagOrchestrationCostMetaDeleteSuccessPayload`
- `IDagOrchestrationCostMetaValidationSuccessPayload`
- `IDagOrchestrationCostMetaPreviewSuccessPayload`
- `TDagOrchestrationCreateRunDraftRequest`
- `TDagOrchestrationReplaceRunDraftRequest`
- `IDagOrchestrationOverwriteRunDraftNodeResultRequest`
- `IDagOrchestrationRunDraftData`
- `IDagOrchestrationRunDraftSuccessPayload`
- `IDagOrchestrationWorkflowOverrideMap`
- `IDagOrchestrationPublishedWorkflowRunRequest`
- `IDagOrchestrationPublishedWorkflowRunData`
- `IDagOrchestrationPublishedWorkflowRunSuccessPayload`
- `IDagOrchestrationHttpClient`

Imported from other packages:

- `IDagDefinition`, `IPartialRunRequest`, `IRunDraft`, `ISaveRunDraftInput`, `TNodeConfigRecord`, and `TPortPayload` from `@robota-sdk/dag-core`
- `ICostMeta` from `@robota-sdk/dag-cost`

## Public API Surface

- `DagOrchestrationHttpClient` -- shared HTTP client for definition, node catalog, run lifecycle, and run draft endpoints.
- `createRunDraft(input)` -- `POST /v1/dag/run-drafts`.
- `getRunDraft(draftId)` -- `GET /v1/dag/run-drafts/:draftId`.
- `replaceRunDraft(draftId, input)` -- `PUT /v1/dag/run-drafts/:draftId`.
- `resetRunDraftNodeResult(draftId, nodeId)` -- `PUT /v1/dag/run-drafts/:draftId/nodes/:nodeId/reset`.
- `overwriteRunDraftNodeResult(draftId, nodeId, input)` -- `PUT /v1/dag/run-drafts/:draftId/nodes/:nodeId/result`.
- `startPublishedWorkflowRun(dagId, input?, version?)` -- `POST /v1/dag/workflows/:dagId/runs`.
- `uploadAsset(input)` -- `POST /v1/dag/assets`.
- `getAssetMetadata(assetId)` -- `GET /v1/dag/assets/:assetId`.
- `getAssetContentDownloadInfo(assetId)` -- encoded `GET /v1/dag/assets/:assetId/content` URL and response header names for transport-specific binary download.
- `listCostMeta()` -- `GET /v1/cost-meta`.
- `getCostMeta(nodeType)` -- `GET /v1/cost-meta/:nodeType`.
- `createCostMeta(input)` -- `POST /v1/cost-meta`.
- `updateCostMeta(nodeType, input)` -- `PUT /v1/cost-meta/:nodeType`.
- `deleteCostMeta(nodeType)` -- `DELETE /v1/cost-meta/:nodeType`.
- `validateCostMetaFormula(input)` -- `POST /v1/cost-meta/validate`.
- `previewCostMetaFormula(input)` -- `POST /v1/cost-meta/preview`.

Binary asset content is intentionally not fetched or buffered by `DagOrchestrationHttpClient`.
CLI/MCP consumers may use `getAssetContentDownloadInfo()` to locate the streaming endpoint, then
own their transport-specific byte handling and output formatting.

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

| Port/Type Owner | Consumer                     | Location                              |
| --------------- | ---------------------------- | ------------------------------------- |
| `dag-core`      | HTTP contract aliases        | `src/orchestration-http-contracts.ts` |
| `dag-core`      | `DagOrchestrationHttpClient` | `src/orchestration-http-client.ts`    |
| `dag-cost`      | Cost metadata HTTP aliases   | `src/orchestration-http-contracts.ts` |

## Test Strategy

- Unit tests verify endpoint path construction, query encoding, request method selection, body serialization, and response pass-through.
- Tests inject a fake fetch implementation; no network access is required.
- Run: `pnpm --filter @robota-sdk/dag-orchestration-client test`
