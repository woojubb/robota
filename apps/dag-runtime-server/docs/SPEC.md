# DAG Runtime Server Specification

## Scope

Native DAG runtime HTTP server (WORKFLOW-002). Serves an in-process DAG framework's
`IDagOrchestrationPort` over the `/v1/dag/*` route surface using Hono. Owns the route → port-method
mapping and the server entrypoint.

## Boundaries

- Does NOT own DAG domain logic — that belongs to `@robota-sdk/dag-framework` / the DAG subsystem.
- Does NOT own the orchestration contract — that is `IDagOrchestrationPort`
  (`@robota-sdk/dag-orchestration-client`); this app exposes it over HTTP.
- Carries NO external-runtime API surface or compatibility layer/wrapper. External-runtime
  compatibility is out of scope here; any such adapter lives in a separate source repository.

## Architecture Overview

`createDagRuntimeServer(port)` returns a Hono app. Every `/v1/dag/*` handler is a uniform mapping:
parse path/query/body → call the matching `IDagOrchestrationPort` method → return
`c.json(response.payload, response.status)` (every port method returns a uniform
`IDagOrchestrationHttpResponse`). `startDagRuntimeServer()` composes `createDagFramework()`, starts the
worker loop, and serves the app via `@hono/node-server`.

## Route Surface (R1)

| Route                                      | Port method          |
| ------------------------------------------ | -------------------- |
| `GET /v1/dag/nodes`                        | `listNodes`          |
| `GET /v1/dag/definitions`                  | `listDefinitions`    |
| `GET /v1/dag/definitions/:dagId`           | `getDefinition`      |
| `POST /v1/dag/definitions`                 | `createDefinition`   |
| `PUT /v1/dag/definitions/:dagId/draft`     | `updateDraft`        |
| `POST /v1/dag/definitions/:dagId/validate` | `validateDefinition` |
| `POST /v1/dag/definitions/:dagId/publish`  | `publishDefinition`  |
| `POST /v1/dag/runs`                        | `createRun`          |
| `POST /v1/dag/runs/:id/start`              | `startRun`           |
| `GET /v1/dag/runs/:id`                     | `getRunStatus`       |
| `GET /v1/dag/runs/:id/result`              | `getRunResult`       |

Assets, cost-meta, run-drafts, and a `GET /v1/dag/runs/:id/events` SSE stream + an
`HttpDagRuntimeProvider` (for the `--provider http` path) are tracked follow-on surface; they follow
the same uniform mapping.

## Type Ownership

| Type                                                       | Location        | Purpose                        |
| ---------------------------------------------------------- | --------------- | ------------------------------ |
| `IStartDagRuntimeServerOptions`, `IDagRuntimeServerHandle` | `src/server.ts` | Server start options + handle. |

## Public API Surface

| Export                            | Kind     | Description                                                 |
| --------------------------------- | -------- | ----------------------------------------------------------- |
| `createDagRuntimeServer`          | function | Build the Hono app over an `IDagOrchestrationPort`.         |
| `startDagRuntimeServer`           | function | Compose a framework + serve the app; returns a stop handle. |
| `DAG_RUNTIME_SERVER_PACKAGE_NAME` | const    | Package-name constant.                                      |

## Extension Points

New routes are added by mapping a path to a port method in `createDagRuntimeServer`.

## Error Taxonomy

Port methods return `IDagOrchestrationHttpResponse` with an HTTP `status`; the handler forwards
`status` + `payload` verbatim. The server adds no fallback behavior.

## Test Strategy

`src/__tests__/app.contract.test.ts`: Hono `app.request()` round-trips for `GET /v1/dag/nodes` and
`/v1/dag/definitions`, and asserts a `404` on an unknown route (no external-runtime surface).

## Class Contract Registry

### Interface Implementations

None (functional factory).

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                              | Consumer       | Location        |
| -------------------------------------------------- | -------------- | --------------- |
| `dag-orchestration-client` `IDagOrchestrationPort` | route handlers | `src/app.ts`    |
| `dag-framework` `createDagFramework`               | server entry   | `src/server.ts` |
