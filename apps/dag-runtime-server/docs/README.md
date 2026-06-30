# @robota-sdk/dag-runtime-server

Native DAG runtime HTTP server. Serves an in-process DAG framework's `IDagOrchestrationPort` over the
`/v1/dag/*` route surface (Hono). No external-runtime API surface or compatibility layer.

See [SPEC.md](./SPEC.md) for the route surface and contract.

```ts
import { startDagRuntimeServer } from '@robota-sdk/dag-runtime-server';

const handle = await startDagRuntimeServer({ port: 3939 });
// ... later
await handle.stop();
```
