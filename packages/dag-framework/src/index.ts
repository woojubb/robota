// @robota-sdk/dag-framework
// Embeddable in-process DAG runtime composition package.

export { createDagFramework } from './create-dag-framework.js';
export {
  createDefaultNodeRegistry,
  createDefaultNodeRegistrySync,
} from './default-node-registry.js';
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
export type { IWorkerLoopDriverLogger } from './runtime/worker-loop-driver.js';

export const DAG_FRAMEWORK_PACKAGE_NAME = '@robota-sdk/dag-framework';
