# @robota-sdk/dag-runtime-server

Native DAG runtime HTTP server (internal, not published to npm). It composes an in-process DAG framework
(`@robota-sdk/dag-framework`) and serves its run, definition, build, validation, node-catalog, cost,
run-draft, and asset capabilities over the `/v1/dag/*` route surface (Hono). There is no external-runtime
API surface or compatibility layer.

```ts
import { startDagRuntimeServer } from '@robota-sdk/dag-runtime-server';

const handle = await startDagRuntimeServer({ port: 3939 });
// ... later
await handle.stop();
```

`createDagRuntimeServer(...)` is also exported for hosts that compose the framework ports themselves and
only need the Hono app.

## Configuration

| Setting            | Source                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Port               | `options.port`, else `DAG_RUNTIME_SERVER_PORT`, else `3939`                                |
| DAG storage root   | `DAG_STORAGE_ROOT`, else `$XDG_DATA_HOME/robota-dag/storage`, else `~/.robota-dag/storage` |
| Asset storage root | `ASSET_STORAGE_ROOT`, else `$XDG_DATA_HOME/robota-dag/assets`, else `~/.robota-dag/assets` |
| Execution root     | The server process's working directory                                                     |

The routes themselves are defined in [`src/app.ts`](../src/app.ts) and
[`src/asset-routes.ts`](../src/asset-routes.ts).

## Documents

- [`SPEC.md`](./SPEC.md): contract — what the server owns, cancellation, error and storage-failure
  behavior.
- [`openapi-assets.yaml`](./openapi-assets.yaml): request, envelope, error, and binary response schemas
  for the asset routes.
