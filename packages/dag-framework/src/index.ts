// @robota-sdk/dag-framework
// Embeddable in-process DAG runtime composition package.

export { createDagFramework } from './create-dag-framework.js';
// The default node catalog moved to `@robota-sdk/dag-nodes-default` (ARCH-PROVIDER-004). It is NOT
// re-exported here: a pass-through re-export would force a hard `dag-framework → dag-nodes-default`
// production edge, re-creating the concrete-node coupling this stage removes. Import the registry from
// `@robota-sdk/dag-nodes-default` directly at composition roots.
export type {
  IDagFramework,
  IDagFrameworkOptions,
  IDagFrameworkPorts,
  IDagFrameworkPaths,
  IDagFrameworkLogger,
} from './types.js';

export { LocalDagRuntimeProvider } from './local-dag-runtime-provider.js';
export type { ILocalDagRuntimeProviderOptions } from './local-dag-runtime-provider.js';

export { HttpDagRuntimeProvider } from './http-dag-runtime-provider.js';
export type { IHttpDagRuntimeProviderOptions } from './http-dag-runtime-provider.js';

export { DagPromptBackend } from './adapters/prompt-backend.js';
export { LocalFsAssetStore } from './adapters/local-fs-asset-store.js';
export { createExecutionComposition } from './composition/create-execution-composition.js';
export { scanWorkspaceCatalog } from './workspace-catalog.js';
export type { IWorkspaceCatalogEntry, IWorkspaceCatalogMeta } from './workspace-catalog.js';
export type { IWorkerLoopDriverLogger } from './runtime/worker-loop-driver.js';

export const DAG_FRAMEWORK_PACKAGE_NAME = '@robota-sdk/dag-framework';
