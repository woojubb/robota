# DAG Server Core Specification

## Scope

Owns reusable DAG server bootstrap, shared server composition, runtime assembly,
asset management, file-based storage, and bundled node catalog behavior.
Provides a ready-to-run Express server that wires `dag-api` controllers with
in-memory or file-backed ports and exposes REST endpoints plus SSE-based run progress streaming.

## Boundaries

- Depends on `dag-core` for domain contracts, port interfaces, in-memory ports, and lifecycle executor.
- Depends on `dag-api` for controller composition and execution composition (known sibling dependency).
- Does not own DAG domain contracts (`IDagDefinition`, `IDagRun`, state machines) -- those belong to `dag-core`.
- Does not own controller logic or API contract shapes -- those belong to `dag-api`.
- Keeps reusable server wiring separate from app-specific deployment concerns.

## Architecture Overview

- **`startDagServer(options)`** (`dag-server-bootstrap.ts`): The main entrypoint. Creates an Express app with CORS, JSON parsing, Swagger UI, and wires all DAG endpoints:
  - Definition CRUD endpoints (`/v1/dag/definitions/...`)
  - Run endpoints (`/v1/dag/runs/...`) including create, start, query result, and SSE progress streaming
  - Asset endpoints (`/v1/dag/assets/...`) for upload, reference creation, metadata, and content serving
  - Node catalog endpoint (`/v1/dag/nodes`)
  - OpenAPI documentation (`/api-docs`)
- **`DagRunService`** (`dag-run-service.ts`): Orchestrates the full run lifecycle: creates a definition copy, publishes it, creates and starts a run, processes tasks until terminal, and maps results to traces with cost data. Also handles artifact cleanup.
- **`AssetAwareTaskExecutorPort`** (`asset-aware-task-executor.ts`): Decorator for `ITaskExecutorPort` that intercepts binary outputs and stores them as asset references via `IAssetStore`.
- **`FileStoragePort`** (`file-storage-port.ts`): File-system-backed `IStoragePort` implementation. Definitions persist as JSON files; runs and tasks are in-memory.
- **`BundledNodeCatalogService`** (`bundled-node-catalog-service.ts`): Implements `INodeCatalogService` from `dag-api` using a static list of node manifests.
- **`DAG_OPENAPI_DOCUMENT`** (`docs/openapi-dag.ts`): OpenAPI 3.0.3 specification object for all DAG endpoints.

## Type Ownership

This package is SSOT for:

- `IDagServerBootstrapOptions` -- server bootstrap configuration (port, manifests, lifecycle factories, asset store, storage root, etc.)
- `IAssetStore` -- asset storage contract (save, saveReference, getMetadata, getContent, initialize?)
- `IStoredAssetMetadata` -- stored asset metadata (assetId, fileName, mediaType, sizeBytes, createdAt, sourceUri?, binaryKind?)
- `ICreateAssetInput` -- asset upload input (fileName, mediaType, content Buffer)
- `ICreateAssetReferenceInput` -- asset reference input (fileName, mediaType, sourceUri, binaryKind, sizeBytes?)
- `IAssetContentResult` -- asset content result (stream, metadata)
- `IDagRunServiceOptions` -- run service configuration
- `IRunResult` -- run result with traces and total cost
- `IRunNodeTrace` -- per-node trace (nodeId, nodeType, input, output, estimatedCostUsd, totalCostUsd)

## Public API Surface

- `startDagServer(options): Promise<{ app, server, storage }>` -- bootstrap and start the Express server
- `DagRunService` -- full run lifecycle service
  - `createRun(definition, input)`, `startRunById(dagRunId)`, `getRunResult(dagRunId)`
  - `deleteRunArtifacts(dagRunId)`, `deleteDefinitionArtifacts(dagId, version?)`, `deleteRunCopyArtifacts()`
- `AssetAwareTaskExecutorPort` -- task executor decorator for asset storage
- `FileStoragePort` -- file-system `IStoragePort` implementation
- `BundledNodeCatalogService` -- static node catalog `INodeCatalogService` implementation
- `DAG_OPENAPI_DOCUMENT` -- OpenAPI specification object

## Extension Points

- `IAssetStore` -- implement to provide custom asset storage (e.g., S3, cloud storage). Must implement `save`, `saveReference`, `getMetadata`, `getContent`.
- `INodeLifecycleFactory` / `INodeManifestRegistry` (from `dag-core`) -- provide node manifest and lifecycle factory registrations via bootstrap options.
- `FileStoragePort` can be replaced with any `IStoragePort` implementation for production use.

## Error Taxonomy

Errors are mapped to `IProblemDetails` (from `dag-api`) at the Express route level.

`DagRunService`-specific validation errors (`category: 'validation'`):
- `DAG_VALIDATION_RUN_NOT_TERMINAL` -- run is not yet in a terminal state for result retrieval
- `DAG_VALIDATION_DAG_RUN_NOT_FOUND` -- run not found for deletion
- `DAG_VALIDATION_DEFINITION_NOT_FOUND` -- definition not found for deletion
- `DAG_VALIDATION_RUN_TRACE_NODE_TYPE_NOT_FOUND` -- node type missing in trace mapping
- `DAG_VALIDATION_RUN_TRACE_SNAPSHOT_MISSING` / `_INVALID` / `_PARSE_FAILED` -- snapshot errors
- `DAG_VALIDATION_RUN_TRACE_COST_MISSING` -- cost fields missing in trace
- `DAG_VALIDATION_RUN_FAILED_WITHOUT_TASK` -- run failed but no failed task found
- `DAG_VALIDATION_RUN_FAILURE_DETAILS_MISSING` -- failed task missing error details
- `DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING` / `_INVALID` / `_PARSE_FAILED` -- definition snapshot errors

## Test Strategy

- **Unit tests**: `dag-server-bootstrap.helpers.test.ts`
- Tests validate server bootstrap helper logic.
- Integration testing is expected through `dag-api` E2E tests and app-level server tests.
- Coverage focus: run lifecycle (create, start, process, result), asset reference mapping, file storage atomic writes, node catalog service.
- Run: `pnpm --filter @robota-sdk/dag-server-core test`
