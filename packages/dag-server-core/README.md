# @robota-sdk/dag-server-core

Reusable DAG server bootstrap and runtime for Robota. Provides `startDagServer` and related services that can be composed by app-level adapters.

## Quick usage

```typescript
import { startDagServer, BundledNodeCatalogService } from '@robota-sdk/dag-server-core';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js'; // app-specific impl

const assetStore = new LocalFsAssetStore('.local-assets');
await assetStore.initialize();

await startDagServer({
  nodeManifests: [...],
  nodeLifecycleFactory: myFactory,
  nodeCatalogService: new BundledNodeCatalogService(manifests),
  assetStore,
  port: 3011,
  corsOrigins: ['http://localhost:3000'],
  requestBodyLimit: '15mb',
  defaultWorkerTimeoutMs: 30_000,
  apiDocsEnabled: true
});
```

## Docs routes

When `apiDocsEnabled` is true (default), the server exposes:

- `GET /docs/dag.json` - DAG OpenAPI document
- `GET /docs/dag` - Swagger UI for DAG APIs
- `GET /docs` - Docs index payload

## Asset store contract

Implement `IAssetStore` with `save`, `saveReference`, `getMetadata`, and `getContent` to provide storage. The core package does not depend on any specific storage implementation.

## Exports

- `startDagServer`, `IDagServerBootstrapOptions`
- `IAssetStore`, `IStoredAssetMetadata`, `ICreateAssetInput`, `ICreateAssetReferenceInput`, `IAssetContentResult`
- `AssetAwareTaskExecutorPort`, `DagRunService`, `BundledNodeCatalogService`
- `DAG_OPENAPI_DOCUMENT`
