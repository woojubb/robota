# dag-runtime-server SPEC

## Scope

`dag-runtime-server` is a ComfyUI-compatible Prompt API execution server. It receives workflow prompts in ComfyUI's native JSON format, translates them into DAG definitions, executes them through the `dag-core` execution engine, and exposes results via ComfyUI-identical HTTP endpoints and WebSocket events. The server owns no domain types; it is a composition root that wires together ports from `dag-core` and `dag-api`.

## Boundaries

| Responsibility | Owner |
|---|---|
| Prompt API types (`IPromptRequest`, `IPromptResponse`, `THistory`, `TObjectInfo`, `IQueueStatus`, `ISystemStats`) | `dag-core` (`types/prompt-types.ts`) |
| Prompt API controller (`PromptApiController`) | `dag-api` |
| Execution composition (`createDagExecutionComposition`) | `dag-api` |
| DAG execution engine (run orchestrator, worker loop, queue, lease) | `dag-core` |
| Node definitions (Input, Transform, LLM, Image, Video, etc.) | Individual `dag-node-*` packages |
| Asset store contract (`IAssetStore`) | `dag-core` (`interfaces/asset-store-port.ts`) |
| Storage port contract (`IStoragePort`) | `dag-core` |
| Task executor port contract (`ITaskExecutorPort`) | `dag-core` |
| Orchestrator API (Robota-specific endpoints for frontend) | `dag-orchestrator-server` |
| DAG designer frontend | `dag-designer` / `web` app |

This server does NOT own:

- Custom or proprietary API endpoints beyond the ComfyUI surface.
- Orchestrator-level features (richer error details, custom diagnostics).
- Node implementation logic (delegated to `dag-node-*` packages).
- Type definitions (all imported from `dag-core`).

## Architecture Overview

### Layer Structure

```
HTTP/WS Layer (Express + ws)
  ├── prompt-routes.ts      ← ComfyUI-compatible HTTP endpoints
  ├── ws-routes.ts           ← WebSocket event broadcast
  └── server.ts              ← Composition root, middleware, lifecycle

Adapter Layer
  └── dag-prompt-backend.ts  ← IPromptBackendPort implementation
                               Translates ComfyUI prompt format → IDagDefinition

Service Layer
  ├── asset-aware-task-executor.ts  ← ITaskExecutorPort decorator (binary → asset refs)
  ├── bundled-node-catalog-service.ts ← INodeCatalogService (hardcoded node registry)
  ├── file-storage-port.ts          ← IStoragePort (file-system persistence)
  └── local-fs-asset-store.ts       ← IAssetStore (local file-system asset storage)

Utility Layer
  └── env-flags.ts           ← Environment variable parsing
```

### Design Patterns

- **Composition root**: `server.ts` wires all dependencies without a DI container. All ports are constructed and injected manually.
- **Ports and adapters**: `DagPromptBackend` implements `IPromptBackendPort` from `dag-core`. `FileStoragePort` implements `IStoragePort`. `LocalFsAssetStore` implements `IAssetStore`. `AssetAwareTaskExecutorPort` implements `ITaskExecutorPort`.
- **Decorator pattern**: `AssetAwareTaskExecutorPort` wraps a delegate `ITaskExecutorPort`, intercepting binary outputs and converting them to asset references.
- **ComfyUI-native error format**: Error responses use `{ error: { type, message, details, extra_info }, node_errors }` — not `IProblemDetails`.

### Request Flow

1. Client sends `POST /prompt` with ComfyUI prompt JSON.
2. `PromptApiController` delegates to `DagPromptBackend.submitPrompt()`.
3. `DagPromptBackend` translates the prompt into an `IDagDefinition` (nodes, edges, config).
4. Definition is persisted via `FileStoragePort`, then published.
5. A DAG run is created and started via `IDagExecutionComposition`.
6. `processRunUntilTerminal()` runs asynchronously, polling `workerLoop.processOnce()`.
7. Progress events flow through `IRunProgressEventBus` to WebSocket clients.
8. On completion, the result is recorded in in-memory history.

## Type Ownership

This application owns **no SSOT types**. All domain types are imported from `dag-core` and `dag-api`. The following table lists port implementations provided by this app.

| Implementation | Implements | Location |
|---|---|---|
| `DagPromptBackend` | `IPromptBackendPort` (dag-core) | `src/adapters/dag-prompt-backend.ts` |
| `FileStoragePort` | `IStoragePort` (dag-core) | `src/services/file-storage-port.ts` |
| `LocalFsAssetStore` | `IAssetStore` (dag-core) | `src/services/local-fs-asset-store.ts` |
| `AssetAwareTaskExecutorPort` | `ITaskExecutorPort` (dag-core) | `src/services/asset-aware-task-executor.ts` |
| `BundledNodeCatalogService` | `INodeCatalogService` (dag-api) | `src/services/bundled-node-catalog-service.ts` |

### Locally-Defined Interfaces

| Interface | Location | Purpose |
|---|---|---|
| `IDagPromptBackendDependencies` | `src/adapters/dag-prompt-backend.ts` | Constructor dependency shape for `DagPromptBackend` |
| `IPromptIdResolver` | `src/routes/ws-routes.ts` | Resolves prompt IDs from DAG run IDs for WS broadcast |

## Public API Surface

### HTTP Endpoints

All endpoints are ComfyUI-compatible. The reference spec is `.design/dag-benchmark/03-comfyui.md`.

| Endpoint | Method | Status | Request Shape | Response Shape |
|---|---|---|---|---|
| `/prompt` | POST | Implemented | `IPromptRequest` | `IPromptResponse` (`{ prompt_id, number, node_errors }`) |
| `/prompt` | GET | Implemented | (none) | `{ exec_info: { queue_remaining: number } }` |
| `/queue` | GET | Implemented | (none) | `IQueueStatus` (`{ queue_running, queue_pending }`) |
| `/queue` | POST | Implemented | `IQueueAction` (`{ clear?, delete? }`) | `{}` |
| `/history` | GET | Implemented | (none) | `THistory` (`Record<string, IHistoryEntry>`) |
| `/history/:prompt_id` | GET | Implemented | (none) | `THistory` (single entry or `{}`) |
| `/object_info` | GET | Implemented | (none) | `TObjectInfo` (`Record<string, INodeObjectInfo>`) |
| `/object_info/:node_type` | GET | Implemented | (none) | `TObjectInfo` (single entry) |
| `/system_stats` | GET | Implemented | (none) | `ISystemStats` (`{ system, devices }`) |
| `/interrupt` | POST | Stub (no-op) | (none) | `{}` |
| `/free` | POST | Stub (no-op) | (none) | `{}` |
| `/health` | GET | Implemented | (none) | `{ status, service, timestamp }` |
| `/view` | GET | **Not implemented** | query params | image binary |
| `/upload/image` | POST | **Not implemented** | multipart/form-data | upload result |

**Notes:**
- `/interrupt` and `/free` are intentional no-op stubs. ComfyUI uses `/interrupt` for GPU job cancellation and `/free` for VRAM model unloading; neither applies to this Node.js runtime.
- `/view` and `/upload/image` are not yet implemented. These are required by the ComfyUI spec for image serving and upload.
- `/health` is a non-ComfyUI operational endpoint (acceptable as a server health probe).

### WebSocket Events

WebSocket endpoint: `/ws`

| Event Type | Direction | Payload | ComfyUI Equivalent |
|---|---|---|---|
| `execution_start` | Server -> Client | `{ prompt_id }` | `execution_start` |
| `executing` | Server -> Client | `{ node, prompt_id }` | `executing` |
| `executed` | Server -> Client | `{ node, output, prompt_id }` | `executed` |
| `execution_error` | Server -> Client | `{ prompt_id, node_id, exception_message }` | `execution_error` |
| `execution_success` | Server -> Client | `{ prompt_id }` | `execution_success` |

**Not implemented WebSocket events:**

| Event Type | ComfyUI Description | Status |
|---|---|---|
| `status` | Queue status broadcast (`{ exec_info: { queue_remaining } }`) | Not implemented |
| `execution_cached` | Cached node list (`{ nodes, prompt_id }`) | Not implemented |
| `progress` | Sampling progress (`{ value, max, prompt_id, node }`) | Not implemented |

## Extension Points

| Extension Point | Interface | Current Implementation | How to Extend |
|---|---|---|---|
| Storage backend | `IStoragePort` (dag-core) | `FileStoragePort` (file-system + in-memory hybrid) | Implement `IStoragePort` with a database adapter |
| Asset storage | `IAssetStore` (dag-core) | `LocalFsAssetStore` (local file-system) | Implement `IAssetStore` with cloud storage (S3, GCS) |
| Task execution | `ITaskExecutorPort` (dag-core) | `AssetAwareTaskExecutorPort` wrapping `LifecycleTaskExecutorPort` | Wrap with additional decorators (logging, metrics, caching) |
| Node catalog | `INodeCatalogService` (dag-api) | `BundledNodeCatalogService` (hardcoded list) | Implement dynamic node discovery |
| Node types | `IDagNodeDefinition` (dag-core) | 11 bundled node types | Add new `dag-node-*` packages and register in `server.ts` |

### Bundled Node Types

The server registers the following node definitions at startup:

| Node Package | Definition Class |
|---|---|
| `dag-node-input` | `InputNodeDefinition` |
| `dag-node-transform` | `TransformNodeDefinition` |
| `dag-node-llm-text-openai` | `LlmTextOpenAiNodeDefinition` |
| `dag-node-text-template` | `TextTemplateNodeDefinition` |
| `dag-node-text-output` | `TextOutputNodeDefinition` |
| `dag-node-image-loader` | `ImageLoaderNodeDefinition` |
| `dag-node-image-source` | `ImageSourceNodeDefinition` |
| `dag-node-gemini-image-edit` | `GeminiImageEditNodeDefinition`, `GeminiImageComposeNodeDefinition` |
| `dag-node-seedance-video` | `SeedanceVideoNodeDefinition` |
| `dag-node-ok-emitter` | `OkEmitterNodeDefinition` |

## Error Taxonomy

### Error Response Format (ComfyUI-native)

All error responses use the ComfyUI error shape, **not** `IProblemDetails`:

```json
{
  "error": {
    "type": "<error-code>",
    "message": "<human-readable message>",
    "details": "",
    "extra_info": {}
  },
  "node_errors": {}
}
```

### HTTP Status Mapping

| Error Category | HTTP Status | Description |
|---|---|---|
| `validation` | 400 | Input validation failures (invalid prompt, unknown node type) |
| All other categories | 500 | Internal server errors |

### Known Error Codes

| Code | Category | Source | Recoverability |
|---|---|---|---|
| `NODE_TYPE_NOT_FOUND` | `validation` | `DagPromptBackend.getObjectInfo()` | Client-recoverable (fix node type) |
| DAG definition errors | `validation` | `DagDefinitionService.createDraft()` / `publish()` | Client-recoverable (fix prompt) |
| Run creation errors | varies | `RunOrchestrator.createRun()` | Depends on cause |
| Run start errors | varies | `RunOrchestrator.startCreatedRun()` | Depends on cause |

### WebSocket Error Events

Execution errors are broadcast as `execution_error` events with:
- `prompt_id`: The prompt that failed.
- `node_id`: The node where the error occurred.
- `exception_message`: The error message string.

## Test Strategy

### Current State

**No test files exist** for `dag-runtime-server`. This is a critical gap.

### Recommended Test Plan

| Test Type | Scope | Priority |
|---|---|---|
| Endpoint contract tests | Verify each HTTP endpoint returns ComfyUI-compatible response shapes | P0 |
| WebSocket event contract tests | Verify WS messages match ComfyUI event format | P0 |
| `DagPromptBackend` unit tests | Prompt-to-DAG translation, history recording, object info mapping | P1 |
| `AssetAwareTaskExecutorPort` unit tests | Binary output interception, asset reference mapping | P1 |
| `FileStoragePort` integration tests | File-system persistence, atomic writes, cleanup | P2 |
| `LocalFsAssetStore` integration tests | Save, retrieve, reference-based asset storage | P2 |
| Error format contract tests | Verify all error responses use ComfyUI format (not IProblemDetails) | P0 |

### Verification Commands

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
pnpm --filter @robota-sdk/dag-runtime-server build
pnpm --filter @robota-sdk/dag-runtime-server lint
```

## Class Contract Registry

| Class | Implements | Package |
|---|---|---|
| `DagPromptBackend` | `IPromptBackendPort` | dag-core |
| `FileStoragePort` | `IStoragePort` | dag-core |
| `LocalFsAssetStore` | `IAssetStore` | dag-core |
| `AssetAwareTaskExecutorPort` | `ITaskExecutorPort` | dag-core |
| `BundledNodeCatalogService` | `INodeCatalogService` | dag-api |

### Cross-Package Port Consumption

| Port (from dag-core) | Used By | Purpose |
|---|---|---|
| `InMemoryQueuePort` | `server.ts` | Task queue and dead letter queue |
| `InMemoryLeasePort` | `server.ts` | Worker lease management |
| `SystemClockPort` | `server.ts` | Time source for execution |
| `LifecycleTaskExecutorPort` | `server.ts` | Node lifecycle execution |
| `StaticNodeLifecycleFactory` | `server.ts` | Node lifecycle creation |
| `StaticNodeTaskHandlerRegistry` | `server.ts` | Task handler lookup |
| `DagDefinitionService` | `DagPromptBackend` | DAG draft creation and publishing |

### Cross-Package Port Consumption (from dag-api)

| Port (from dag-api) | Used By | Purpose |
|---|---|---|
| `PromptApiController` | `server.ts`, `prompt-routes.ts` | HTTP request delegation |
| `createDagExecutionComposition` | `server.ts` | Execution subsystem wiring |
| `IRunProgressEventBus` | `ws-routes.ts` | Progress event subscription |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DAG_PORT` | `3011` | HTTP server port |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `DAG_REQUEST_BODY_LIMIT` | `15mb` | Express JSON body size limit |
| `DAG_DEFAULT_TIMEOUT_MS` | `30000` | Worker task timeout |
| `DAG_STORAGE_ROOT` | `.dag-storage` | File-system storage root for definitions |
| `ASSET_STORAGE_ROOT` | `.local-assets` | File-system root for binary assets |
| `OPENAI_API_KEY` | (none) | Required for `llm-text-openai` node |
| `GEMINI_API_KEY` | (none) | Required for `gemini-image-edit` / `gemini-image-compose` nodes |
| `BYTEDANCE_API_KEY` | (none) | Required for `seedance-video` node |
| `BYTEDANCE_BASE_URL` | (none) | Required for `seedance-video` node |

## Dependencies

| Dependency | Purpose |
|---|---|
| `@robota-sdk/dag-core` | Domain types, ports, execution engine primitives |
| `@robota-sdk/dag-api` | `PromptApiController`, execution composition, event bus |
| `@robota-sdk/dag-node-*` (11 packages) | Bundled node definitions |
| `express` | HTTP server framework |
| `ws` | WebSocket server |
| `cors` | CORS middleware |
| `helmet` | Security headers |
| `dotenv` | Environment variable loading |
