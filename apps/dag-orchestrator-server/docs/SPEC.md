# dag-orchestrator-server SPEC

## Scope

Robota API gateway application that serves the dag-designer frontend. It orchestrates DAG definition lifecycle (create, validate, publish) and run execution by proxying to a ComfyUI-compatible backend runtime. The server exposes two distinct API surfaces: Robota-specific endpoints under `/v1/dag/` and ComfyUI-compatible proxy endpoints at the root level. WebSocket bridging translates ComfyUI progress messages into Robota run progress events for the designer UI.

## Boundaries

| Responsibility                                                                        | Owner                  | Not This Package                          |
| ------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------- |
| Runtime execution (ComfyUI compat)                                                    | `dag-runtime-server`   | Does not execute DAG nodes                |
| Domain types (`IDagDefinition`, `TRunProgressEvent`, `IAssetStore`, `IRunDraftStore`) | `dag-core`             | Does not define domain types              |
| Orchestration logic (`OrchestratorRunService`, `PromptOrchestratorService`)           | `dag-orchestrator`     | Does not own orchestration business logic |
| Controller composition (`DagDesignController`)                                        | `dag-api`              | Does not own controller contracts         |
| Designer UI                                                                           | `dag-designer` / `web` | Does not own frontend                     |
| Node definitions                                                                      | `dag-node-*` packages  | Does not define or bundle nodes           |

## Architecture Overview

```
Express Application (http.Server)
├── Middleware: cors, helmet, express.json (15 MB limit)
├── Health: GET /health
│
├── Robota API Routes (/v1/dag/*)
│   ├── definition-routes  → DagDesignController (dag-api)
│   ├── run-routes         → OrchestratorRunService (dag-orchestrator)
│   ├── run-draft-routes   → IRunDraftStore + dag-core reducers
│   ├── published-workflow-routes → IStoragePort + OrchestratorRunService
│   ├── asset-routes       → IAssetStore (dag-core)
│   ├── admin-routes       → DagDesignController (dag-api)
│   └── ws-routes          → WebSocket bridge to ComfyUI backend
│
├── ComfyUI Proxy Routes (root-level)
│   └── PromptOrchestratorService → HttpPromptApiClient → Backend
│
└── Services
    ├── LocalFsAssetStore (IAssetStore)
    ├── FileRunDraftStore (IRunDraftStore)
    ├── RuntimeNodeCatalogService (INodeCatalogService → /object_info)
    └── comfyui-event-translator (pure function)
```

**Bootstrap sequence:**

1. Load environment variables (`ORCHESTRATOR_PORT`, `BACKEND_URL`, `CORS_ORIGINS`, `ASSET_STORAGE_ROOT`, `COST_META_DIR`, `DAG_STORAGE_ROOT`, `RUN_DRAFT_STORAGE_ROOT`).
2. Create `HttpPromptApiClient` pointing to the backend URL.
3. Compose infrastructure ports (`FileStoragePort` for persistence, `FileRunDraftStore`, `InMemoryQueuePort`, `InMemoryLeasePort`, `SystemClockPort`).
4. Create `RuntimeNodeCatalogService` from the `HttpPromptApiClient` and inject it into `createDagControllerComposition`.
5. Initialize `LocalFsAssetStore`.
6. Register all route modules.
7. Start HTTP server and register SIGTERM/SIGINT handlers.

**Design patterns:** Dependency injection via constructor/function parameters. Route modules receive pre-configured service instances. No service locator or global state.

## Type Ownership

This application does not define SSOT domain types. All domain types are imported from upstream packages.

| Type                       | Source                                             | Purpose                                         |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `IComfyUiWsMessage`        | Local (`services/comfyui-event-translator.ts`)     | ComfyUI WebSocket message shape for translation |
| `TVersionQueryParseResult` | Local (`routes/route-utils.ts`)                    | Version query parameter parse result union      |
| `IWorkflowOverrideMap`     | Local (`routes/published-workflow-route-utils.ts`) | Request-local node config override map          |
| `IWorkflowRunRequestBody`  | Local (`routes/published-workflow-route-utils.ts`) | Parsed published workflow run request body      |

Helper functions and HTTP status constants in `route-utils.ts` are locally defined but not exported as SSOT types.

## Public API Surface

### Robota API Endpoints

All Robota endpoints use a standard response envelope:

- Success: `{ ok: true, status: <number>, data: <payload> }`
- Error: `{ ok: false, status: <number>, errors: IProblemDetails[] }`

#### Definition Routes

| Endpoint                              | Method | Purpose                                                                    | Request Body                     | Success Response                    |
| ------------------------------------- | ------ | -------------------------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| `/v1/dag/definitions`                 | POST   | Create definition                                                          | `{ definition: IDagDefinition }` | `201 { ok, data: { definition } }`  |
| `/v1/dag/definitions/:dagId/draft`    | PUT    | Update draft                                                               | `{ definition, version }`        | `200 { ok, data: { definition } }`  |
| `/v1/dag/definitions/:dagId/validate` | POST   | Validate definition                                                        | `{ version }`                    | `200 { ok, data }`                  |
| `/v1/dag/definitions/:dagId/publish`  | POST   | Publish definition                                                         | `{ version }`                    | `200 { ok, data }`                  |
| `/v1/dag/definitions/:dagId`          | GET    | Get definition                                                             | Query: `?version=<int>`          | `200 { ok, data: { definition } }`  |
| `/v1/dag/definitions`                 | GET    | List definitions                                                           | Query: `?dagId=<string>`         | `200 { ok, data: { definitions } }` |
| `/v1/dag/nodes`                       | GET    | List node catalog through `DagDesignController` and runtime `/object_info` | None                             | `200 { ok, data: <TObjectInfo> }`   |

#### Run Routes

| Endpoint                  | Method | Purpose             | Request Body             | Success Response                                |
| ------------------------- | ------ | ------------------- | ------------------------ | ----------------------------------------------- |
| `/v1/dag/runs`            | POST   | Create run          | `{ definition, input? }` | `201 { ok, data: { preparationId } }`           |
| `/v1/dag/runs/:id/start`  | POST   | Start run execution | None                     | `202 { ok, data: { dagRunId, preparationId } }` |
| `/v1/dag/runs/:id/result` | GET    | Get run result      | None                     | `200 { ok, data: { run } }`                     |
| `/v1/dag/runs/:id`        | GET    | Get run status      | None                     | `200 { ok, data: { dagRunId, status } }`        |

`POST /v1/dag/runs` also accepts `{ partialRun: { startNodeId } }`. The server passes this through to `OrchestratorRunService`, which resolves runtime `partial_execution_targets` from the start node and its downstream dependents.

#### Run Draft Routes

| Endpoint                                           | Method | Purpose                                      | Request Body                                                  | Success Response              |
| -------------------------------------------------- | ------ | -------------------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| `/v1/dag/run-drafts`                               | POST   | Create or replace execution draft            | `{ draftId?, definition, input?, nodeStateMap?, runResult? }` | `201 { ok, data: { draft } }` |
| `/v1/dag/run-drafts/:draftId`                      | GET    | Restore execution draft                      | None                                                          | `200 { ok, data: { draft } }` |
| `/v1/dag/run-drafts/:draftId`                      | PUT    | Replace execution draft                      | `{ definition, input?, nodeStateMap?, runResult? }`           | `200 { ok, data: { draft } }` |
| `/v1/dag/run-drafts/:draftId/nodes/:nodeId/reset`  | PUT    | Reset one node result and downstream results | None                                                          | `200 { ok, data: { draft } }` |
| `/v1/dag/run-drafts/:draftId/nodes/:nodeId/result` | PUT    | Manually overwrite one node result           | `{ input?, output }`                                          | `200 { ok, data: { draft } }` |

Run drafts persist execution state separately from `IDagDefinition`. Reset and overwrite operations use dag-core pure reducers and must never mutate stored definition JSON.

#### Published Workflow Routes

| Endpoint                        | Method | Purpose                          | Request Body             | Success Response                                                |
| ------------------------------- | ------ | -------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `/v1/dag/workflows/:dagId/runs` | POST   | Start a published definition run | `{ input?, overrides? }` | `202 { ok, data: { dagRunId, preparationId, dagId, version } }` |

**Published workflow execution contract:**

1. The route executes only persisted definitions whose `status` is `published`.
2. `?version=<positive-int>` selects an exact published version. Without `version`, the route selects `IStoragePort.getLatestPublishedDefinition(dagId)`.
3. `input` must be an object when provided and is forwarded as the run input payload.
4. `overrides` must be an object keyed by `nodeId`. Each value must be an object and is shallow-merged into that node's `config` for this single run only.
5. Unknown override node IDs are rejected. Overrides never mutate or persist the stored definition.
6. Asset references are validated after overrides and before prompt translation. Runtime asset synchronization uses the same `resolvePromptAssetsForRuntime` path as `/v1/dag/runs/:id/start`.
7. Published workflow runs are asynchronous. A successful request means the run was accepted by the runtime and returns identifiers for status/result polling.

#### Asset Routes

| Endpoint                          | Method | Purpose                                                           | Request Body                          | Success Response                |
| --------------------------------- | ------ | ----------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| `/v1/dag/assets`                  | POST   | Upload asset (base64) to orchestrator storage and runtime storage | `{ fileName, mediaType, base64Data }` | `201 { ok, data: { asset } }`   |
| `/v1/dag/assets/:assetId`         | GET    | Get asset metadata                                                | None                                  | `200 { ok, data: { asset } }`   |
| `/v1/dag/assets/:assetId/content` | GET    | Download asset content                                            | None                                  | Binary stream with Content-Type |

#### Cost Meta Routes

| Endpoint                  | Method | Purpose                            | Request Body                            | Success Response                        |
| ------------------------- | ------ | ---------------------------------- | --------------------------------------- | --------------------------------------- |
| `/v1/cost-meta`           | GET    | List all cost meta                 | None                                    | `200 { ok, data: [...] }`               |
| `/v1/cost-meta`           | POST   | Create cost meta                   | `ICostMeta`                             | `201 { ok, data }`                      |
| `/v1/cost-meta/validate`  | POST   | Validate CEL formula               | `{ formula }`                           | `200 { ok }` or `{ ok: false, errors }` |
| `/v1/cost-meta/preview`   | POST   | Evaluate formula with test context | `{ formula, variables?, testContext? }` | `200 { ok, result }`                    |
| `/v1/cost-meta/:nodeType` | GET    | Get single cost meta               | None                                    | `200 { ok, data }`                      |
| `/v1/cost-meta/:nodeType` | PUT    | Update cost meta                   | `ICostMeta`                             | `200 { ok, data }`                      |
| `/v1/cost-meta/:nodeType` | DELETE | Delete cost meta                   | None                                    | `200 { ok }`                            |

#### Admin Routes

| Endpoint                  | Method | Purpose                | Request Body | Success Response                                     |
| ------------------------- | ------ | ---------------------- | ------------ | ---------------------------------------------------- |
| `/v1/dag/admin/bootstrap` | POST   | Seed sample definition | None         | `201 { ok, data: { definitionId, dagId, version } }` |

#### Health

| Endpoint  | Method | Purpose      | Success Response                          |
| --------- | ------ | ------------ | ----------------------------------------- |
| `/health` | GET    | Health check | `{ status, service, backend, timestamp }` |

### ComfyUI Proxy Endpoints

These endpoints forward requests to the ComfyUI-compatible backend and return the backend's native response format.

| Endpoint                 | Method | Backend Target               | Error Response                    |
| ------------------------ | ------ | ---------------------------- | --------------------------------- |
| `/prompt`                | POST   | `POST /prompt`               | `400 { error }`                   |
| `/queue`                 | GET    | `GET /queue`                 | `502 { error }`                   |
| `/history`               | GET    | `GET /history`               | `502 { error }`                   |
| `/history/:promptId`     | GET    | `GET /history/:promptId`     | `502 { error }`                   |
| `/object_info`           | GET    | `GET /object_info`           | `502 { error }`                   |
| `/object_info/:nodeType` | GET    | `GET /object_info/:nodeType` | `502 { error }`                   |
| `/system_stats`          | GET    | `GET /system_stats`          | `502 { error }`                   |
| `/view`                  | GET    | `GET /view?filename=...`     | `400 { error }` / `502 { error }` |

### WebSocket

| URL Pattern           | Protocol            | Direction        | Envelope                       |
| --------------------- | ------------------- | ---------------- | ------------------------------ |
| `/v1/dag/runs/:id/ws` | WebSocket (upgrade) | Server to client | `{ event: TRunProgressEvent }` |

**WebSocket bridge behavior:**

1. Client connects with `id` in URL (can be `preparationId` before start, or `dagRunId` after start).
2. Server opens a parallel WebSocket to the ComfyUI backend (`/ws?clientId=orch-{id}`).
3. Server polls `runService.getDagRunId(id)` every 100ms until the `dagRunId` (= `promptId`) is available, buffering incoming ComfyUI messages.
4. Once `dagRunId` is resolved, buffered and subsequent ComfyUI messages are translated via `translateComfyUiEvent` using `dagRunId` as both the event identifier and the `promptId` filter, and forwarded to the designer client.
5. Terminal events (`execution.completed`, `execution.failed`) close both WebSocket connections.

## Extension Points

| Interface                                     | Implementation              | Purpose                                                           |
| --------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `IAssetStore` (dag-core)                      | `LocalFsAssetStore`         | File-system-based asset storage with metadata JSON files          |
| `INodeCatalogService` (dag-api)               | `RuntimeNodeCatalogService` | Runtime `/object_info` catalog discovery and node type validation |
| `ICostEstimatorPort` (dag-orchestrator)       | `CelCostEstimatorAdapter`   | CEL-based cost estimation using cost meta formulas                |
| `ICostPolicyEvaluatorPort` (dag-orchestrator) | Stub (inline)               | Cost policy evaluation (currently always passes)                  |

Consumers can swap `LocalFsAssetStore` for a cloud-backed `IAssetStore` implementation without changing route code.

## Asset Runtime Synchronization

`POST /v1/dag/assets` is the authoritative file-selection upload boundary. The route decodes the client payload, uploads the bytes to the configured runtime backend, stores the bytes in the orchestrator asset store with the returned `runtimeAssetId`, and only then returns `201`.

Persisted DAG config stores the orchestrator `assetId`; this keeps definition validation and content download server-authoritative. Runtime upload IDs stay in asset metadata as `runtimeAssetId`. When a run starts, `run-routes` rewrites prompt-local asset references from orchestrator asset IDs to runtime asset IDs before submitting to the backend. Legacy assets without `runtimeAssetId` are uploaded during run start and then rewritten for that prompt.

## Error Taxonomy

### Response Envelope

All Robota API endpoints (`/v1/dag/*`) use a consistent envelope:

- **Success:** `{ ok: true, status: <httpStatus>, data: <payload> }`
- **Error:** `{ ok: false, status: <httpStatus>, errors: [...] }`

Error objects follow RFC 7807 (IProblemDetails) structure where applicable:

```typescript
{
  type: string; // e.g. "urn:robota:problems:dag:validation"
  title: string; // e.g. "DAG validation failed"
  status: number;
  detail: string;
  instance: string; // request path
  code: string;
  retryable: boolean;
}
```

### Error Code to HTTP Status Mapping

| Error Code                                                    | HTTP Status | Context                                                          |
| ------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `DAG_VALIDATION_DEFINITION_REQUIRED`                          | 400         | Missing definition in request body                               |
| `DAG_VALIDATION_VERSION_QUERY_INVALID`                        | 400         | Invalid version query parameter                                  |
| `DAG_VALIDATION_ASSET_FILENAME_REQUIRED`                      | 400         | Missing fileName in asset upload                                 |
| `DAG_VALIDATION_ASSET_MEDIATYPE_REQUIRED`                     | 400         | Missing mediaType in asset upload                                |
| `DAG_VALIDATION_ASSET_BASE64_REQUIRED`                        | 400         | Missing base64Data in asset upload                               |
| `DAG_VALIDATION_ASSET_EMPTY_CONTENT`                          | 400         | Decoded base64 content is empty                                  |
| `DAG_VALIDATION_ASSET_BASE64_INVALID`                         | 400         | Invalid base64 encoding                                          |
| `DAG_RUNTIME_ASSET_UPLOAD_FAILED`                             | 502         | Runtime rejected or could not receive an asset upload            |
| `DAG_RUNTIME_ASSET_RESPONSE_INVALID`                          | 502         | Runtime upload response did not contain a usable asset name      |
| `DAG_VALIDATION_ASSET_REFERENCE_OBJECT_REQUIRED`              | 400         | config.asset must be a media reference object                    |
| `DAG_VALIDATION_ASSET_REFERENCE_TYPE_INVALID`                 | 400         | referenceType must be asset or uri                               |
| `DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED`                 | 400         | Exactly one of assetId or uri required                           |
| `DAG_VALIDATION_ASSET_REFERENCE_TYPE_ASSET_REQUIRES_ASSET_ID` | 400         | referenceType asset requires assetId                             |
| `DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND`                    | 400         | Referenced assetId does not exist                                |
| `DAG_VALIDATION_RUN_DEFINITION_REQUIRED`                      | 400         | Missing definition in run create request                         |
| `DAG_VALIDATION_RUN_INPUT_INVALID`                            | 400         | input must be an object when provided                            |
| `DAG_VALIDATION_RUN_PARTIAL_INVALID`                          | 400         | partialRun must contain a valid startNodeId                      |
| `DAG_VALIDATION_RUN_DRAFT_INVALID`                            | 400         | Run draft request body is invalid                                |
| `DAG_RUN_DRAFT_NOT_FOUND`                                     | 404         | Run draft not found by draftId                                   |
| `ORCHESTRATOR_PARTIAL_RUN_START_NODE_NOT_FOUND`               | 400         | Partial run start node does not exist in the definition          |
| `DAG_PUBLISHED_DEFINITION_NOT_FOUND`                          | 404         | Published workflow endpoint could not find a runnable definition |
| `DAG_PUBLISHED_DEFINITION_STATUS_INVALID`                     | 409         | Requested workflow version exists but is not published           |
| `DAG_VALIDATION_WORKFLOW_REQUEST_INVALID`                     | 400         | Published workflow request body must be an object                |
| `DAG_VALIDATION_WORKFLOW_INPUT_INVALID`                       | 400         | Published workflow input must be an object when provided         |
| `DAG_VALIDATION_WORKFLOW_OVERRIDES_INVALID`                   | 400         | Published workflow overrides must be an object map               |
| `DAG_VALIDATION_WORKFLOW_OVERRIDE_NODE_NOT_FOUND`             | 400         | Override references a node ID absent from the definition         |
| `DAG_ASSET_NOT_FOUND`                                         | 404         | Asset not found by assetId                                       |
| `ORCHESTRATOR_RUN_NOT_FOUND`                                  | 404         | Run not found by dagRunId                                        |
| `ORCHESTRATOR_RUN_NOT_COMPLETED`                              | 409         | Run result requested before completion                           |
| `WS_BRIDGE_ERROR`                                             | N/A (WS)    | WebSocket bridge failure (sent as WS event)                      |
| `COMFYUI_EXECUTION_ERROR`                                     | N/A (WS)    | ComfyUI execution error (sent as WS event)                       |

### ComfyUI Proxy Error Format

ComfyUI proxy endpoints (`/prompt`, `/queue`, `/history`, etc.) use the backend's native error format, not the Robota envelope:

- Validation errors: `400 { error: <error> }`
- Backend communication errors: `502 { error: <error> }`

## Test Strategy

### Current Coverage

| Test File                                         | Scope                                 | Tests                                                                                 |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/__tests__/comfyui-event-translator.test.ts`  | `translateComfyUiEvent` pure function | ComfyUI message type mapping, prompt_id filtering, terminal events                    |
| `src/__tests__/endpoint-contract.test.ts`         | Run route endpoint contracts          | Response envelope shapes, preparationId/dagRunId flow, error format (IProblemDetails) |
| `src/__tests__/run-draft-routes.test.ts`          | Run draft endpoint contracts          | Draft create/get/update, reset, overwrite, and response envelopes                     |
| `src/__tests__/published-workflow-routes.test.ts` | Published workflow routes             | Latest/exact published selection, draft rejection, override validation                |

### Coverage Gaps

- **Endpoint contract tests:** Definition, asset, admin routes are untested.
- **WebSocket bridge tests:** No tests for ws-routes connection lifecycle, message buffering, or cleanup.
- **Route utility tests:** No tests for `validateAssetReferences`, `parseOptionalPositiveIntegerQuery`, `toRunProblemDetails`.
- **Integration tests:** No tests for the bootstrap sequence or middleware configuration.
- **Error response shape tests:** No contract tests verifying RFC 7807 compliance of error responses.

### Recommended Test Additions

1. Route contract tests: verify each endpoint returns correct status codes and envelope shapes for success and error cases (mock service dependencies).
2. Asset validation tests: verify `validateAssetReferences` handles all reference type combinations.
3. WebSocket bridge unit tests: verify message buffering before promptId, terminal event cleanup, error forwarding.

## Class Contract Registry

| Class               | Implements               | Source Package | Purpose                                               |
| ------------------- | ------------------------ | -------------- | ----------------------------------------------------- |
| `LocalFsAssetStore` | `IAssetStore` (dag-core) | Local          | File-system asset storage with binary + JSON metadata |

### Route Registration Functions

| Function                          | Module                                | Dependencies                                              |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `registerDefinitionRoutes`        | `routes/definition-routes.ts`         | `DagDesignController`, `IAssetStore`                      |
| `registerRunRoutes`               | `routes/run-routes.ts`                | `OrchestratorRunService`, `IAssetStore`                   |
| `registerRunDraftRoutes`          | `routes/run-draft-routes.ts`          | `IRunDraftStore`                                          |
| `registerPublishedWorkflowRoutes` | `routes/published-workflow-routes.ts` | `IStoragePort`, `OrchestratorRunService`, `IAssetStore`   |
| `registerAssetRoutes`             | `routes/asset-routes.ts`              | `IAssetStore`                                             |
| `registerAdminRoutes`             | `routes/admin-routes.ts`              | `DagDesignController`                                     |
| `registerRuntimeAssetRoutes`      | `routes/runtime-asset-routes.ts`      | `backendUrl`                                              |
| `registerCostMetaRoutes`          | `routes/cost-meta-routes.ts`          | `ICostMetaStoragePort`, `CelCostEvaluator`                |
| `registerWsRoutes`                | `routes/ws-routes.ts`                 | `http.Server`, `OrchestratorRunService`, `backendBaseUrl` |

### Utility Functions (route-utils.ts)

| Function                            | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `resolveCorrelationId`              | Extract `X-Correlation-Id` header or generate one          |
| `createCorrelationId`               | Generate a scoped correlation ID                           |
| `validateAssetReferences`           | Validate all node asset references in a definition         |
| `parseOptionalPositiveIntegerQuery` | Parse optional positive integer query parameter            |
| `toRunProblemDetails`               | Convert error to RFC 7807 problem details                  |
| `toAssetReference`                  | Convert stored metadata to asset reference shape           |
| `getAssetContentUri`                | Build asset content download URI                           |
| `isAllowedInlineMediaType`          | Check if media type is safe for inline Content-Disposition |
| `sanitizeFileName`                  | Sanitize filename for Content-Disposition header           |

## Configuration

| Variable                 | Default                           | Description                                |
| ------------------------ | --------------------------------- | ------------------------------------------ |
| `ORCHESTRATOR_PORT`      | `3012`                            | HTTP server listen port                    |
| `BACKEND_URL`            | `http://127.0.0.1:3011`           | ComfyUI-compatible backend URL             |
| `CORS_ORIGINS`           | `http://localhost:3000`           | Comma-separated allowed CORS origins       |
| `ASSET_STORAGE_ROOT`     | `.local-assets` (relative to cwd) | Directory for local asset file storage     |
| `COST_META_DIR`          | `data` (relative to cwd)          | Directory for cost meta JSON storage       |
| `DAG_STORAGE_ROOT`       | `.dag-storage` (relative to cwd)  | Directory for DAG definition file storage  |
| `RUN_DRAFT_STORAGE_ROOT` | `<DAG_STORAGE_ROOT>/run-drafts`   | Directory for execution draft JSON storage |

## Dependencies

| Package                          | Role                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/dag-core`           | Domain types, node assembly, infrastructure ports                                                       |
| `@robota-sdk/dag-api`            | Controller composition, `INodeCatalogService`                                                           |
| `@robota-sdk/dag-orchestrator`   | `PromptOrchestratorService`, `OrchestratorRunService`, `HttpPromptApiClient`, `CelCostEstimatorAdapter` |
| `@robota-sdk/dag-cost`           | Cost meta types, `CelCostEvaluator`, `ICostMetaStoragePort`                                             |
| `@robota-sdk/dag-adapters-local` | `FileStoragePort`, `FileRunDraftStore`, `FileCostMetaStorage`, in-memory ports                          |
| `express`                        | HTTP framework                                                                                          |
| `ws`                             | WebSocket server and client                                                                             |
| `cors`                           | CORS middleware                                                                                         |
| `helmet`                         | Security headers                                                                                        |
| `dotenv`                         | Environment variable loading                                                                            |
