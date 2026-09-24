# DAG Runtime Server Specification

## Scope

Native DAG runtime HTTP server (WORKFLOW-002). Serves an in-process DAG framework's
run, definition, build, validation, node-catalog, and cost capabilities over the `/v1/dag/*` route surface using Hono. Owns the route → port-method
mapping and the server entrypoint.

## Boundaries

- Does NOT own DAG domain logic — that belongs to `@robota-sdk/dag-framework` / the DAG subsystem.
- Does NOT own the orchestration, cost, or run-draft contracts — they belong to
  `@robota-sdk/dag-orchestration-client`, `@robota-sdk/dag-cost`, and `@robota-sdk/dag-core`; this app exposes them over HTTP.
- Carries NO external-runtime API surface or compatibility layer/wrapper. External-runtime
  compatibility is out of scope here; any such adapter lives in a separate source repository.

## Architecture Overview

`createDagRuntimeServer(runs, costMeta, runDrafts, build, validation, catalog, definitionReads, definitionMutations, progressSource?, assets?)` returns a Hono app. Route handlers parse path/query/body, call domain capabilities, and map results to the existing HTTP envelopes. Run preparation retains its implicit definition create/publish behavior, while the server chooses the public response for each failure phase. Build validation failures answer 400;
definition validation findings remain a successful 200 response with `valid: false` and `errors`.
Run cancellation delegates to the in-process lifecycle's committed-state decision: a winning
cancel answers 200 with the cancelled run identity, a missing run answers 404, and an invalid
terminal transition answers a problem response without rewriting the winner.
The definition-read, definition-mutation, build, validation, and catalog capabilities are required at server construction. Run-draft request JSON is decoded before calling
`IRunDraftOperationsPort`; an invalid field returns 400, a missing draft 404, a storage failure 500
without internal details, and create returns 201. The reset route is `POST`.
Cost metadata routes map a separate
`ICostMetaOperationsPort` domain result to HTTP success/problem responses; an unwired cost
capability maps to 501 and never masquerades as a successful operation.
Asset routes map the separate `IAssetStore` capability to the existing upload/metadata JSON
envelope. Upload JSON base64 is decoded at the HTTP boundary. The content route streams actual
bytes with content headers, returns 404 for missing assets, and returns 501 when the asset
capability is not wired or the asset is an external reference. The HTTP route does not dereference
reference source URIs until the store enforces connect-time address safety. Invalid uploads,
including media types with non-printable ASCII, return 400; storage failures are redacted as 500.
If the asset source fails after response headers, the byte stream errors instead of completing
successfully with truncated content.
The asset HTTP request, envelope, error, and binary response schemas are specified in
[`openapi-assets.yaml`](./openapi-assets.yaml).
The successful content response uses a header-safe stored media type, falling back to
`application/octet-stream` for legacy invalid metadata. The OpenAPI binary content key
is a media range rather than a fixed `application/octet-stream` claim.
`startDagRuntimeServer()` captures the server process working
directory as the trusted DAG execution root, passes it explicitly to `createDagFramework()`, starts
the worker loop, and serves the app via `@hono/node-server`.

## Route Surface (R1)

| Route                                                  | Port method                         |
| ------------------------------------------------------ | ----------------------------------- |
| `GET /v1/dag/nodes`                                    | catalog capability `listNodes`      |
| `GET /v1/dag/definitions`                              | definition reads `listDefinitions`  |
| `GET /v1/dag/definitions/:dagId`                       | definition reads `getDefinition`    |
| `POST /v1/dag/definitions`                             | `createDefinition`                  |
| `PUT /v1/dag/definitions/:dagId/draft`                 | `updateDraft`                       |
| `POST /v1/dag/definitions/:dagId/validate`             | `validateDefinition`                |
| `POST /v1/dag/definitions/:dagId/publish`              | `publishDefinition`                 |
| `POST /v1/dag/runs`                                    | `createRun`                         |
| `POST /v1/dag/runs/:id/start`                          | `startRun`                          |
| `POST /v1/dag/runs/:id/cancel`                         | `cancelRun`                         |
| `GET /v1/dag/runs/:id`                                 | `getRunStatus`                      |
| `GET /v1/dag/runs/:id/result`                          | `getRunResult`                      |
| `POST /v1/dag/definitions/:dagId/start`                | `startPublishedWorkflowRun`         |
| `POST /v1/dag/build`                                   | build capability `buildDag`         |
| `POST /v1/dag/validate`                                | validation capability `validateDag` |
| `POST /v1/dag/assets`                                  | `assets.save`                       |
| `GET /v1/dag/assets/:assetId`                          | `assets.getMetadata`                |
| `GET /v1/dag/assets/:assetId/content`                  | `assets.getContent` (binary stream) |
| `GET /v1/dag/cost-meta`                                | `listCostMeta`                      |
| `GET /v1/dag/cost-meta/:nodeType`                      | `getCostMeta`                       |
| `POST /v1/dag/cost-meta`                               | `createCostMeta`                    |
| `PUT /v1/dag/cost-meta/:nodeType`                      | `updateCostMeta`                    |
| `DELETE /v1/dag/cost-meta/:nodeType`                   | `deleteCostMeta`                    |
| `POST /v1/dag/cost-meta/validate`                      | `validateCostMetaFormula`           |
| `POST /v1/dag/cost-meta/preview`                       | `previewCostMetaFormula`            |
| `POST /v1/dag/run-drafts`                              | `createRunDraft`                    |
| `GET /v1/dag/run-drafts/:draftId`                      | `getRunDraft`                       |
| `PUT /v1/dag/run-drafts/:draftId`                      | `replaceRunDraft`                   |
| `POST /v1/dag/run-drafts/:draftId/nodes/:nodeId/reset` | `resetRunDraftNodeResult`           |
| `PUT /v1/dag/run-drafts/:draftId/nodes/:nodeId/result` | `overwriteRunDraftNodeResult`       |

| `GET /v1/dag/runs/:id/events` (SSE) | `progressSource` run-progress stream |

The `HttpDagRuntimeProvider` (for the `--provider http` path) now exists, exported from
`@robota-sdk/dag-framework`, and is verified against this server by
`src/__tests__/http-provider.roundtrip.test.ts`.

## Type Ownership

| Type                                                       | Location        | Purpose                        |
| ---------------------------------------------------------- | --------------- | ------------------------------ |
| `IStartDagRuntimeServerOptions`, `IDagRuntimeServerHandle` | `src/server.ts` | Server start options + handle. |

## Public API Surface

| Export                            | Kind     | Description                                                 |
| --------------------------------- | -------- | ----------------------------------------------------------- |
| `createDagRuntimeServer`          | function | Build the Hono app over domain capabilities.                |
| `startDagRuntimeServer`           | function | Compose a framework + serve the app; returns a stop handle. |
| `DAG_RUNTIME_SERVER_PACKAGE_NAME` | const    | Package-name constant.                                      |

## Extension Points

New routes are added by mapping a path to a port method in `createDagRuntimeServer`.

## Error Taxonomy

Run handlers map domain results to the existing success/error envelopes, including 404 for missing
runs and a phase-specific 400 when implicit definition preparation fails. Cost handlers validate their input and map typed domain
results: unsupported → 501, missing → 404, invalid → 400, success → 200/201.
Unexpected cost failures map to 500 with a generic detail so internal paths and storage errors
are not exposed. Problem details remain inside the API's existing `errors` envelope.
Asset routes reject malformed upload JSON/base64 and invalid asset IDs with 400, return 404 for
missing assets, 501 when the store is unwired or the asset is an external reference, and redact storage exceptions as 500. Successful
content requests return a binary stream rather than a JSON envelope.
The current in-process composition returns `DAG_COST_META_UNSUPPORTED` for all seven cost routes;
this is an explicit 501, not a fabricated successful response. The other 4xx cost codes are
`DAG_COST_META_NOT_FOUND` and `DAG_COST_META_INVALID`; recognized `CEL_*` failures map to 400.

## Test Strategy

`src/__tests__/app.contract.test.ts`: Hono `app.request()` round-trips for `GET /v1/dag/nodes` and
`/v1/dag/definitions`, verifies asset upload/metadata/binary download and failures, and asserts a
`404` on an unknown route (no external-runtime surface).

`src/__tests__/http-provider.roundtrip.test.ts`: drives `HttpDagRuntimeProvider`
(from `@robota-sdk/dag-framework`) against the in-process Hono app via a fetch shim, exercising the
HTTP + SSE run-progress round-trip end to end.

## Class Contract Registry

### Interface Implementations

None (functional factory).

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                | Consumer       | Location        |
| ------------------------------------ | -------------- | --------------- |
| `dag-api` run lifecycle port         | route handlers | `src/app.ts`    |
| `dag-cost` `ICostMetaOperationsPort` | cost routes    | `src/app.ts`    |
| `dag-core` `IAssetStore`             | asset routes   | `src/app.ts`    |
| `dag-framework` `createDagFramework` | server entry   | `src/server.ts` |
