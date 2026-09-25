import path from 'node:path';
import { resolveTrustedExecutionRoot } from '@robota-sdk/agent-core/node';
import {
  buildValidationError,
  DagDefinitionService,
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
  type IDagError,
  type TResult,
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
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import type { IWorkerLoopPolicyOptions } from '@robota-sdk/dag-worker';

import { createExecutionComposition } from './composition/create-execution-composition.js';
import { IsolatedRegexTaskExecutor } from './isolated-regex-task-executor.js';
import { AssetAwareTaskExecutorPort } from './adapters/asset-aware-executor.js';
import { LocalFsAssetStore } from './adapters/local-fs-asset-store.js';
import { DagPromptBackend } from './adapters/prompt-backend.js';
import { DagFrameworkRunLifecycle } from './adapters/dag-run-lifecycle.js';
import { DagFrameworkBuildOperations } from './adapters/dag-build-operations.js';
import { DagFrameworkValidationOperations } from './adapters/dag-validation-operations.js';
import { DagFrameworkDefinitionReads } from './adapters/dag-definition-reads.js';
import { DagFrameworkDefinitionMutations } from './adapters/dag-definition-mutations.js';
import { UnsupportedCostMetaOperations } from './adapters/unsupported-cost-meta.js';
import { DagFrameworkRunDraftOperations } from './adapters/run-draft-operations.js';
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

function requireHostPath(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`createDagFramework requires paths.${name} when its port is not supplied`);
  }
  return value;
}

export class NoopDeadLetterReinject implements IDiagnosticsDeadLetterReinjectPort {
  public async reinjectOnce(
    _workerId: string,
    _visibilityTimeoutMs: number,
  ): Promise<TResult<{ reinjected: boolean; taskRunId?: string }, IDagError>> {
    // CORE-027: `{ ok: true, reinjected: false }` here was "the dead-letter queue is empty" —
    // a claim about a queue this composition does not have. An operator draining a DLQ after an
    // incident read success-shaped answers from a port that could never reinject anything, which
    // is the failure contract destroying the failure one adapter down. The absent capability
    // reports itself as absent.
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DLQ_REINJECT_UNSUPPORTED',
        'dead-letter reinjection is not wired in this composition — no reinject port was provided, so there is no queue this call could have drained',
      ),
    };
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
  const executionRoot = resolveTrustedExecutionRoot(options.executionRoot ?? process.cwd());
  // 1. Node registry → manifests + handlers.
  // When `options.nodes` is supplied, `options.providers` is intentionally ignored — a custom node set
  // carries its own provider wiring (ARCH-PROVIDER-003).
  const nodes: readonly IDagNodeDefinition[] =
    options.nodes ??
    (await loadDefaultNodeRegistry(
      options.providers,
      options.skillRoots,
      options.contributionSources,
    ));
  const assemblyResult = buildNodeDefinitionAssembly([...nodes]);
  if (!assemblyResult.ok) {
    throw new Error(`Failed to build node definition assembly: ${assemblyResult.error.message}`);
  }
  const assembly = assemblyResult.value;

  // 2. Infrastructure ports (defaults overridable via options.ports)
  // A caller-supplied storage port is theirs to close; only the default `FileStoragePort` this
  // composition constructs itself is this framework's to release on `stop()`.
  const ownsStorage = options.ports?.storage === undefined;
  const storage: IStoragePort =
    options.ports?.storage ??
    new FileStoragePort(requireHostPath(options.paths?.storageRoot, 'storageRoot'));
  const queue: IQueuePort = options.ports?.queue ?? new InMemoryQueuePort();
  const deadLetterQueue: IQueuePort = options.ports?.deadLetterQueue ?? new InMemoryQueuePort();
  const lease: ILeasePort = options.ports?.lease ?? new InMemoryLeasePort();
  const clock: IClockPort = options.ports?.clock ?? new SystemClockPort();

  // 3. Asset store
  const assetStore: IAssetStore =
    options.ports?.assetStore ??
    (await initializeAssetStore(
      new LocalFsAssetStore(path.resolve(requireHostPath(options.paths?.assetRoot, 'assetRoot'))),
    ));

  // 5. Task executor (lifecycle-based, wrapped with asset-awareness, and — for the
  // default executor only — isolated regex execution). A caller-supplied `ports.executor`
  // is trusted as-is: it must populate `regexReplaceOperation` itself, or `text-replace`
  // with `useRegex` fails closed rather than falling back to inline main-thread execution.
  const isDefaultExecutor = options.ports?.executor === undefined;
  const baseExecutor: ITaskExecutorPort =
    options.ports?.executor ??
    new LifecycleTaskExecutorPort(
      buildManifestRegistry(assembly.manifests),
      new StaticNodeLifecycleFactory(new StaticNodeTaskHandlerRegistry(assembly.handlersByType)),
    );
  const assetAwareExecutor = new AssetAwareTaskExecutorPort(baseExecutor, assetStore);
  // This composition hosts arbitrary node types, not just the regex-isolated one, so its
  // `stopAndWait` must join only the isolated regex operation's own shutdown — never the
  // delegate's full node completion, or a node that ignores its abort signal would block every
  // timeout, cancel, and `framework.stop()` on this composition until that node finally returns.
  const executor: ITaskExecutorPort = isDefaultExecutor
    ? new IsolatedRegexTaskExecutor(assetAwareExecutor, false)
    : assetAwareExecutor;

  // 6. Execution composition (run orchestrator + worker loop)
  const workerOptions: IWorkerLoopPolicyOptions = {
    ...DEFAULT_WORKER_OPTIONS,
    ...options.worker,
  };
  const execution = createExecutionComposition(
    {
      executionRoot,
      storage,
      queue,
      deadLetterQueue,
      lease,
      executor,
      clock,
      lifecycleCreditAdmission: isDefaultExecutor,
    },
    { worker: workerOptions, logger: options.logger },
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

  // 10. Framework instance
  const framework: IDagFramework = {
    runs: new DagFrameworkRunLifecycle(storage, execution),
    build: new DagFrameworkBuildOperations(assembly.manifests),
    validation: new DagFrameworkValidationOperations(assembly.manifests),
    catalog: { listNodes: async () => structuredClone(assembly.manifests) },
    definitionReads: new DagFrameworkDefinitionReads(new DagDefinitionService(storage)),
    definitionMutations: new DagFrameworkDefinitionMutations(new DagDefinitionService(storage)),
    costMeta: new UnsupportedCostMetaOperations(),
    runDrafts: new DagFrameworkRunDraftOperations(runDraftStore, clock),
    assets: assetStore,
    internals: { controllers, execution, storage, promptBackend, assetStore },
    async start(): Promise<void> {
      await execution.runAdvancement.start();
    },
    async stop(): Promise<void> {
      await promptBackend.closeIngressAndDrainSubmissions();
      await execution.runAdvancement.stop();
      await promptBackend.drainOwnedObservationJobs();
      // Release this root's owner lock so a later `createDagFramework` call — in this process or
      // another — can open the same file storage root again (packages/dag-adapters-local SPEC:
      // exclusive ownership is enforced). Only for the default storage THIS composition constructed —
      // a caller-supplied `options.ports.storage` is the caller's to close, and `close()` is final, so
      // closing one out from under a caller still using it would be a hard-to-diagnose regression.
      if (ownsStorage && storage instanceof FileStoragePort) {
        await storage.close();
      }
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
