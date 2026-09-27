# @robota-sdk/dag-orchestration-client

A thin HTTP client for a DAG orchestration server that serves the `/v1/dag/*` routes, such as
`apps/dag-runtime-server`. `DagOrchestrationHttpClient` covers definitions, the node catalog, runs,
assets, cost metadata and run drafts, and this package owns the request and response types for those
calls.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md),
  [`@robota-sdk/dag-cost`](../dag-cost/README.md) (cost-metadata types) and
  [`@robota-sdk/dag-builder`](../dag-builder/docs/README.md) (the build request type).
- Used by: [`dag-framework`](../dag-framework/README.md), whose `HttpDagRuntimeProvider` runs
  definitions on a remote server through this client, and
  [`apps/dag-runtime-server`](../../apps/dag-runtime-server/docs/README.md), which uses its request
  types.

The client does not own domain contracts (`dag-core`, `dag-cost`), controller composition
(`dag-api`) or server routes (the server app), and it does not format output for a CLI or tool.

## Main exports

- `DagOrchestrationHttpClient({ baseUrl, fetch })` — the fetch implementation is injected.
  - Definitions, node catalog, builds, runs and assets: methods such as `listDefinitions`,
    `createDefinition`, `publishDefinition`, `listNodes`, `buildDag`, `validateDag`, `createRun`,
    `startRun`, `cancelRun`, `getRunStatus`, `getRunResult`, `startPublishedWorkflowRun`,
    `uploadAsset` and `getAssetMetadata` resolve to an `IDagOrchestrationHttpResponse`
    (`{ ok, status, payload }`) that forwards the server's envelope unchanged.
  - Cost metadata (`listCostMeta`, `createCostMeta`, `validateCostMetaFormula`, …) and run drafts
    (`createRunDraft`, `getRunDraft`, …) validate the response and return typed `TResult` domain
    results.
  - `getAssetContentDownloadInfo(assetId)` returns where to stream asset content; the client never
    buffers binary content itself.
- `IDagOrchestrationPort`, `IDagAssetHttpPort` — the transport-shaped ports the client implements.
- Request and payload types such as `IDagOrchestrationCreateRunInput`,
  `IDagOrchestrationHttpResponse` and `IOrchestrationProblemDetails`.

## Usage

```ts
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';

declare const definition: IDagDefinition;

const client = new DagOrchestrationHttpClient({ baseUrl: 'http://127.0.0.1:3939', fetch });

// Orchestration calls forward the server's envelope unchanged.
const created = await client.createRun({ definition, input: {} });
if (!created.ok) console.error(created.status, created.payload.errors);

// Cost-metadata and run-draft calls decode the response into a domain result.
const costMeta = await client.listCostMeta();
if (costMeta.ok) console.log(costMeta.value.length);
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — scope, boundaries, design decisions and error taxonomy.
