import path from 'node:path';
import {
  LifecycleTaskExecutorPort,
  type IClockPort,
  type ILeasePort,
  type INodeManifest,
  type INodeManifestRegistry,
  type IQueuePort,
  type IStoragePort,
  type ITaskExecutorPort,
  type IAssetStore,
  type IDagNodeDefinition,
  type IRunDraftStore,
} from '@robota-sdk/dag-core';
import {
  FileStoragePort,
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryRunDraftStore,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import {
  buildNodeDefinitionAssembly,
  StaticNodeLifecycleFactory,
  StaticNodeTaskHandlerRegistry,
} from '@robota-sdk/dag-node';
import {
  DagDesignController,
  DagObservabilityController,
  DagRuntimeController,
  DagDiagnosticsController,
  type IDagControllerComposition,
  type IDiagnosticsDeadLetterReinjectPort,
} from '@robota-sdk/dag-api';
import { DagDefinitionService, type IDagError, type TResult } from '@robota-sdk/dag-core';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import type { IWorkerLoopPolicyOptions } from '@robota-sdk/dag-worker';

import { createExecutionComposition } from './composition/create-execution-composition.js';
import { resolveAssetRoot, resolveStorageRoot } from './config/resolve-storage-root.js';
import { AssetAwareTaskExecutorPort } from './adapters/asset-aware-executor.js';
import { LocalFsAssetStore } from './adapters/local-fs-asset-store.js';
import { DagPromptBackend } from './adapters/prompt-backend.js';
import { DagFrameworkOrchestrationAdapter } from './adapters/orchestration-adapter.js';
import { WorkerLoopDriver } from './runtime/worker-loop-driver.js';
import { loadDefaultNodeRegistry } from './load-default-node-registry.js';
import type { IDagFramework, IDagFrameworkOptions } from './types.js';

const DEFAULT_WORKER_OPTIONS: IWorkerLoopPolicyOptions = {
  workerId: 'dag-framework-worker-1',
  leaseDurationMs: 30_000,
  visibilityTimeoutMs: 30_000,
  maxAttempts: 1,
  defaultTimeoutMs: 30_000,
  retryEnabled: false,
  deadLetterEnabled: true,
};

function buildManifestRegistry(manifests: INodeManifest[]): INodeManifestRegistry {
  const byType = new Map<string, INodeManifest>(manifests.map((m) => [m.nodeType, m]));
  return {
    getManifest: (nodeType) => byType.get(nodeType),
    listManifests: () => manifests,
  };
}

class NoopDeadLetterReinject implements IDiagnosticsDeadLetterReinjectPort {
  public async reinjectOnce(
    _workerId: string,
    _visibilityTimeoutMs: number,
  ): Promise<TResult<{ reinjected: boolean; taskRunId?: string }, IDagError>> {
    return { ok: true, value: { reinjected: false } };
  }
}

/**
 * Creates an in-process DAG framework instance with all infrastructure
 * (storage, queue, executor, worker loop, asset store, orchestration adapter)
 * wired up and ready to use. The worker loop is not started by default;
 * pass `autoStart: true` to start it during creation, or call `framework.start()`.
 */
export async function createDagFramework(
  options: IDagFrameworkOptions = {},
): Promise<IDagFramework> {
  // 1. Node registry → manifests + handlers.
  // When `options.nodes` is supplied, `options.providers` is intentionally ignored — a custom node set
  // carries its own provider wiring (ARCH-PROVIDER-003).
  const nodes: readonly IDagNodeDefinition[] =
    options.nodes ?? (await loadDefaultNodeRegistry(options.providers));
  const assemblyResult = buildNodeDefinitionAssembly([...nodes]);
  if (!assemblyResult.ok) {
    throw new Error(`Failed to build node definition assembly: ${assemblyResult.error.message}`);
  }
  const assembly = assemblyResult.value;

  // 2. Resolve storage and asset paths
  const storageRoot = options.paths?.storageRoot ?? resolveStorageRoot();
  const assetRoot = options.paths?.assetRoot ?? resolveAssetRoot();

  // 3. Infrastructure ports (defaults overridable via options.ports)
  const storage: IStoragePort = options.ports?.storage ?? new FileStoragePort(storageRoot);
  const queue: IQueuePort = options.ports?.queue ?? new InMemoryQueuePort();
  const deadLetterQueue: IQueuePort = options.ports?.deadLetterQueue ?? new InMemoryQueuePort();
  const lease: ILeasePort = options.ports?.lease ?? new InMemoryLeasePort();
  const clock: IClockPort = options.ports?.clock ?? new SystemClockPort();

  // 4. Asset store
  const assetStore: IAssetStore =
    options.ports?.assetStore ??
    (await initializeAssetStore(new LocalFsAssetStore(path.resolve(assetRoot))));

  // 5. Task executor (lifecycle-based, wrapped with asset-awareness)
  const baseExecutor: ITaskExecutorPort =
    options.ports?.executor ??
    new LifecycleTaskExecutorPort(
      buildManifestRegistry(assembly.manifests),
      new StaticNodeLifecycleFactory(new StaticNodeTaskHandlerRegistry(assembly.handlersByType)),
    );
  const executor = new AssetAwareTaskExecutorPort(baseExecutor, assetStore);

  // 6. Execution composition (run orchestrator + worker loop)
  const workerOptions: IWorkerLoopPolicyOptions = {
    ...DEFAULT_WORKER_OPTIONS,
    ...options.worker,
  };
  const execution = createExecutionComposition(
    { storage, queue, deadLetterQueue, lease, executor, clock },
    { worker: workerOptions },
  );

  // 7. Prompt backend (for prompt API consumers)
  const promptBackend = new DagPromptBackend({
    storage,
    execution,
    clock,
    manifests: [...assembly.manifests],
  });

  // 8. Design + other controllers via composition (in-process only)
  const definitionService = new DagDefinitionService(storage);
  const controllers: IDagControllerComposition = {
    design: new DagDesignController(definitionService),
    runtime: new DagRuntimeController(
      execution.runOrchestrator,
      execution.runQuery,
      execution.runCancel,
    ),
    observability: new DagObservabilityController(new ProjectionReadModelService(storage)),
    diagnostics: new DagDiagnosticsController(
      execution.runQuery,
      execution.runOrchestrator,
      new NoopDeadLetterReinject(),
    ),
  };

  // 9. Run-draft store (in-memory by default; persistence is opt-in)
  const runDraftStore: IRunDraftStore = options.ports?.runDraftStore ?? new InMemoryRunDraftStore();

  // 10. Orchestration adapter
  const client = new DagFrameworkOrchestrationAdapter({
    storage,
    controllers,
    execution,
    manifests: assembly.manifests,
    assetStore,
    runDraftStore,
    clock,
  });

  // 11. Worker loop driver
  const driver = new WorkerLoopDriver(execution.workerLoop, options.logger);

  // 12. Framework instance
  const framework: IDagFramework = {
    client,
    internals: { controllers, execution, storage, promptBackend, assetStore },
    async start(): Promise<void> {
      await driver.start();
    },
    async stop(): Promise<void> {
      await driver.stop();
    },
  };

  if (options.autoStart) {
    await framework.start();
  }

  return framework;
}

async function initializeAssetStore(store: LocalFsAssetStore): Promise<LocalFsAssetStore> {
  await store.initialize();
  return store;
}
