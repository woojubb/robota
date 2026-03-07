# DAG Designer Specification

## Scope

Composable React DAG designer UI package. Provides components, hooks, and an API client
for authoring DAG definitions, managing node catalogs, and executing runs with real-time
progress streaming. Run execution is server-authoritative via API; the designer does not
perform local orchestration.

Run client contract: `createRun -> startRun -> getRunResult` with `traces/totalCostUsd` in results.

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
- **API Client** (`client/designer-api-client.ts`): `DesignerApiClient` implements `IDesignerApiClient` using `fetch` for REST calls and `EventSource` for SSE-based run progress streaming with exponential backoff reconnection.
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
- **Utilities**: `schema-defaults.ts` (config schema default generation), `port-editor-utils.ts` (port editing helpers).

## Type Ownership

This package is SSOT for:

- `IDesignerApiClient` -- client interface for all designer-to-server API operations
- `IDesignerApiClientConfig` -- client configuration (baseUrl)
- `IProblemDetails` (designer-local redefinition for client-side use)
- `ICreateDefinitionInput`, `IUpdateDraftInput`, `IValidateDefinitionInput`, `IPublishDefinitionInput`, `IGetDefinitionInput`, `IListDefinitionsInput` -- client-side input types
- `ICreateRunInput`, `IStartRunInput`, `IGetRunResultInput` -- run operation inputs
- `IRunNodeTrace`, `IRunResult`, `IDefinitionListItem` -- result types (client-side)
- `IDagDesignerState`, `IDagDesignerActions` -- React state/action interfaces
- `IUseDagDesignApi`, `IUseDagDesignApiOptions` -- hook interfaces
- `IRunProgressState` -- run progress tracking state (from canvas component)

## Public API Surface

- `DesignerApiClient` -- HTTP/SSE client implementing `IDesignerApiClient`
- `useDagDesignerState()` -- React hook for read-only designer state
- `useDagDesignerActions()` -- React hook for designer mutations
- `useDagDesignApi(options)` -- React hook wrapping API client
- `DagDesignerCanvas` -- main canvas React component
- `DagNodeView`, `DagBindingEdge` -- graph element components
- `NodeExplorerPanel`, `NodeConfigPanel`, `EdgeInspectorPanel` -- panel components
- `NodeIoViewer`, `NodeIoTracePanel` -- data/trace viewer components

## Extension Points

- `IDesignerApiClient` -- implement to provide a custom API client (e.g., mock client for testing, alternative transport).
- `useDagDesignApi({ client })` -- accepts a custom client instance, enabling dependency injection in React.
- Canvas component accepts `onRunResult` callback for custom run result handling.

## Error Taxonomy

Client-side errors use `IProblemDetails` (mirroring the server shape):

- `DESIGNER_API_CONTRACT_VIOLATION` -- response payload does not match the expected designer API contract (type: `urn:robota:problems:dag:contract`)
- Server-originated `IProblemDetails` errors are passed through from the API response.
- `EventSource` errors surface via `onError` callback: `"EventSource is not available"`, `"Run progress stream disconnected"`, `"Failed to parse run progress event payload"`.

## Test Strategy

- No dedicated test files found in this package currently.
- The designer relies on integration testing through `dag-api` E2E tests and app-level UI tests.
- Coverage priorities: API client request/response contract validation, SSE reconnection logic, hook state management, component rendering with manifests and definitions.
- Run: `pnpm --filter @robota-sdk/dag-designer test`
