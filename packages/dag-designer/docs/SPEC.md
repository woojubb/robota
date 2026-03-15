# DAG Designer Specification

## Scope

Composable React DAG designer UI package. Provides components, hooks, and an API client
for authoring DAG definitions, managing node catalogs, and executing runs with real-time
progress streaming. Run execution is server-authoritative via API; the designer does not
perform local orchestration.

Run client contract: `createRun -> startRun -> getRunResult`.
- `createRun` returns `{ preparationId }` (orchestrator-internal pre-start key).
- `startRun` accepts `preparationId`, returns `{ dagRunId }` where `dagRunId` = `promptId` from runtime.
- `subscribeRunProgress` uses `preparationId` (WS connects before start).
- `getRunResult` uses `dagRunId`.
- `IRunResult` has `status` (`'success' | 'failed'`), `traces`, `nodeErrors: IRunNodeError[]`, and `totalCredits`.

`text-template` node template syntax:
- `%s`: replace with input text
- `%%s`: render literal `%s`
- default template is `%s` (pass-through behavior)

## Boundaries

- Depends on `dag-core` for domain types (`IDagDefinition`, `IDagNode`, `INodeManifest`, `TPortPayload`, `TRunProgressEvent`, etc.).
- Does NOT import `dag-runtime`, `dag-worker`, or `dag-scheduler` implementations directly.
- Does not own backend storage or execution infrastructure.
- Does not own API contract definitions for the server side -- those belong to `dag-api`.

## Architecture Overview

- **Contracts** (`contracts/designer-api.ts`): Defines the `IDesignerApiClient` interface and all request/response types for the designer-to-server communication.
- **API Client** (`client/designer-api-client.ts`): `DesignerApiClient` implements `IDesignerApiClient` using `fetch` for REST calls and `WebSocket` for run progress streaming with exponential backoff reconnection.
- **React Hooks**:
  - `useDagDesignerState()` -- accesses designer state (definition, manifests, selection, run result, run progress, errors).
  - `useDagDesignerActions()` -- accesses designer mutation actions (updateDefinition, addNode, updateNode, updateEdge, setSelection, etc.).
  - `useDagDesignApi(options)` -- provides a typed API facade wrapping `IDesignerApiClient` for React components.
- **React Components** (`components/`):
  - `DagDesignerCanvas` -- main canvas with context provider
  - `DagNodeView` -- node rendering
  - `DagBindingEdge` -- edge rendering with binding visualization
  - `NodeExplorerPanel` -- node catalog browser
  - `NodeConfigPanel` -- node configuration editor
  - `EdgeInspectorPanel` -- edge/binding inspector
  - `NodeIoViewer` -- input/output data viewer
  - `NodeIoTracePanel` -- execution trace viewer
- **Lifecycle** (`lifecycle/run-engine.ts`): Re-exports `IRunNodeTrace` and `IRunResult` types.
- **Utilities**: `port-editor-utils.ts` (port editing helpers).
- **Config Form**: Node configuration uses ComfyUI `TInputTypeSpec` (from `/object_info`) instead of Zod schemas for field rendering.
- **Node Catalog**: `NodeExplorerPanel` uses `INodeObjectInfo`/`TObjectInfo` from the `/object_info` endpoint for node discovery and categorization.

**INodeManifest vs TObjectInfo coexistence:**
- `TObjectInfo`/`INodeObjectInfo` is the preferred path for node discovery (sourced from the `/object_info` API).
- `INodeManifest` is retained for backward compatibility in component props where existing consumers pass manifests directly.
- Config form rendering uses ComfyUI `TInputTypeSpec` (from `/object_info`), not Zod schemas.

## Type Ownership

This package is SSOT for:

- `IDesignerApiClient` -- client interface for all designer-to-server API operations
- `IDesignerApiClientConfig` -- client configuration (baseUrl)
- `ICreateDefinitionInput`, `IUpdateDraftInput`, `IValidateDefinitionInput`, `IPublishDefinitionInput`, `IGetDefinitionInput`, `IListDefinitionsInput` -- client-side input types
- `IDesignerCreateRunInput`, `IDesignerStartRunInput`, `IGetRunResultInput` -- run operation inputs (designer-prefixed to avoid collision with dag-runtime)
- `ISubscribeRunProgressInput` -- run progress subscription input
- `IDagDesignerState` -- React designer state interface
- `IDagDesignerActions` -- React designer action interface
- `IUseDagDesignApi` -- hook return type interface
- `IUseDagDesignApiOptions` -- hook options interface
- `IRunProgressState` -- run progress tracking state

Imported from other packages (not owned here):

- `IProblemDetails`, `IDefinitionListItem` -- imported from `@robota-sdk/dag-api`
- `IRunNodeTrace`, `IRunResult`, `IRunNodeError` -- imported from `@robota-sdk/dag-core`

## Public API Surface

- `DesignerApiClient` -- HTTP/WebSocket client implementing `IDesignerApiClient`
- `useDagDesignerState()` -- React hook for read-only designer state
- `useDagDesignerActions()` -- React hook for designer mutations
- `useDagDesignApi(options)` -- React hook wrapping API client
- `DagDesignerCanvas` -- main canvas React component
- `DagNodeView`, `DagBindingEdge` -- graph element components
- `NodeExplorerPanel`, `NodeConfigPanel`, `EdgeInspectorPanel` -- panel components
- `NodeIoViewer`, `NodeIoTracePanel` -- data/trace viewer components
- `listObjectInfo()` -- primary method on `IDesignerApiClient` for node catalog discovery (fetches `/object_info` from runtime)

## Extension Points

- `IDesignerApiClient` -- implement to provide a custom API client (e.g., mock client for testing, alternative transport).
- `useDagDesignApi({ client })` -- accepts a custom client instance, enabling dependency injection in React.
- Canvas component accepts `onRunResult` callback for custom run result handling.

## Error Taxonomy

Client-side errors use `IProblemDetails` (mirroring the server shape):

- `DESIGNER_API_CONTRACT_VIOLATION` -- response payload does not match the expected designer API contract (type: `urn:robota:problems:dag:contract`)
- Server-originated `IProblemDetails` errors are passed through from the API response.
- WebSocket errors surface via `onError` callback: `"WebSocket is not available in this environment."`, `"Run progress stream disconnected."`, `"Failed to parse run progress event payload."`.

## Class Contract Registry

### Interface Implementations

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IDesignerApiClient` | `DesignerApiClient` | production | `src/client/designer-api-client.ts` |

### Inheritance Chains

None. Classes are standalone.

### Cross-Package Port Consumers

| Port (Owner) | Consumer | Location |
|--------------|---------|----------|
| Domain types from dag-core (`IDagDefinition`, `INodeManifest`, `TRunProgressEvent`) | `DesignerApiClient`, hooks, components | Throughout `src/` |

## List Port Handle Behavior

Ports with `isList: true` support multiple connections via dynamically generated handle slots.

### Handle Rendering (`DagNodeView`)

- **Connected handles**: One handle per existing binding to this list port across all incoming edges. Display: full opacity, label shows `#N` (1-based).
- **Placeholder handle**: Exactly one extra handle rendered beyond the connected count. Display: `opacity-50`, represents the next available slot for a new connection.
- **No connections**: One placeholder handle at index 0.
- **Formula**: `handleCount = connectedBindingCount + 1`. Handle IDs follow `portKey[index]` format (e.g., `images[0]`, `images[1]`).

### Connection (`onConnect` in `DagDesignerCanvas`)

- Connecting to a placeholder handle creates a new binding with the placeholder's handle ID as `inputKey`.
- Connecting to an already-bound handle is rejected with `"Connection rejected: input handle is already bound."`.
- After connection, `compactListBindings()` re-indexes all list bindings to ensure sequential indices starting from 0.
- A new connection may create a new edge (if no edge exists between source and target) or append a binding to an existing edge.

### Compaction (`compactListBindings` in `canvas-utils`)

- Re-indexes list binding `inputKey` values to be sequential starting from 0 per (targetNodeId, listPortKey) pair.
- Indices are tracked **across all edges** to the same target node, not per-edge. This ensures that bindings from different source nodes to the same list port receive unique, sequential indices.
- Non-list bindings are not modified.
- Compaction runs on: `onConnect`, `updateEdge`, `removeEdgeById`, `removeNodeById`.

### Handle Computation (`computeInputHandlesByPortKey`)

- Counts connected bindings across ALL incoming edges to the target node for each list port.
- Generates `connectedCount + 1` handle IDs (connected slots + 1 placeholder).
- Result is passed to `DagNodeView` as `inputHandlesByPortKey` prop, driving handle rendering.

### Disconnection (Edge/Node Removal)

- When an edge is removed (`removeEdgeById`), `compactListBindings()` re-indexes remaining list bindings so indices remain sequential with no gaps.
- When a node is removed (`removeNodeById`), all edges involving that node are removed, then compaction runs on remaining edges.
- **Handle shrinkage**: After disconnection and compaction, `computeInputHandlesByPortKey` recalculates handles. The placeholder count adjusts to `remainingConnections + 1`, so previously occupied slots disappear. There is no stale handle retention.

### Edge-to-ReactFlow Mapping (`toEdge`)

- Each `IDagEdgeDefinition` maps to one React Flow `Edge`.
- `sourceHandle` and `targetHandle` are set from the **first binding** of the edge.
- An edge with multiple bindings (e.g., same source node sending to `images[0]` and `prompt`) is visually rendered as a single edge line; the full binding list is shown in the edge label/tooltip.

### Invariants

1. List binding indices for a given (targetNodeId, listPortKey) are always sequential `[0, 1, 2, ...]` with no gaps after any mutation.
2. Exactly one placeholder handle exists per list port at all times (connected count + 1).
3. No two bindings across all edges may share the same (targetNodeId, listInputKey) identity.
4. `dependsOn` is recomputed from edges after any edge addition or removal.

## Dependencies

| Package | Role |
|---|---|
| `@robota-sdk/dag-core` | Domain types (`IDagDefinition`, `IDagNode`, `INodeManifest`, `TRunProgressEvent`, etc.) |
| `@robota-sdk/dag-api` | Controller contracts (`IProblemDetails`, `IDefinitionListItem`) |
| `@xyflow/react` | React Flow graph rendering |
| `@robota-sdk/dag-node-*` | devDependencies only — used for testing node catalog and port definitions |

## Test Strategy

- Unit tests: `port-editor-utils.test.ts` (port editing helpers), `canvas-utils.test.ts` (list binding compaction across multi-edge scenarios, handle computation), `comfyui-field-renderers.test.ts` (ComfyUI input spec parsing tests).
- Contract tests: `designer-api-contract.test.ts` (validates `hasValidRunResult` contract for `IRunResult` shape — status, dagRunId, traces, nodeErrors, totalCredits).
- API client HTTP request/response shape tests and WebSocket reconnection logic tests are planned.
- The designer also relies on integration testing through app-level UI tests.
- Coverage priorities: API client request/response contract validation, WebSocket reconnection logic, hook state management, component rendering with manifests and definitions.
- Run: `pnpm --filter @robota-sdk/dag-designer test`
