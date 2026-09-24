import { IsolatedRegexTaskExecutor } from './isolated-regex-task-executor.js';
import type {
  IDagDefinition,
  IDagError,
  ITaskSnapshotBudget,
  IRootCreditBudget,
  ITaskSnapshotBudgetLimits,
  IDagExecutionByteLimits,
  IDagExecutionLineage,
  IDagNodeDefinition,
  IDagRuntimeExecuteOptions,
  IDagRuntimeProgressEvent,
  IDagRuntimeProvider,
  IDagRuntimeResult,
  IDagNodeManifest,
  INodePortSpec,
  ITaskExecutorPort,
  TPortPayload,
  TRunProgressEvent,
  IDagRun,
  ITaskRun,
  IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import { resolveTrustedExecutionRoot } from '@robota-sdk/agent-core/node';
import { LifecycleTaskExecutorPort, resolveDagExecutionByteLimits, resolveTaskSnapshotBudgetLimits, RootCreditBudget, TaskSnapshotBudget } from '@robota-sdk/dag-core';
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import {
  buildNodeDefinitionAssembly,
  StaticNodeLifecycleFactory,
  StaticNodeManifestRegistry,
  StaticNodeTaskHandlerRegistry,
} from '@robota-sdk/dag-node';

import { loadDefaultNodeRegistrySync } from './load-default-node-registry.js';
import { createExecutionComposition } from './composition/create-execution-composition.js';
import {
  collectOutputsFromTaskRuns,
  extractFinalText,
  extractRunError,
} from './run-result-mapping.js';

const LOCAL_WORKER_ID = 'local-dag-runtime-provider';
const LOCAL_LEASE_DURATION_MS = 60_000;
const LOCAL_VISIBILITY_TIMEOUT_MS = 60_000;
const LOCAL_MAX_ATTEMPTS = 1;
const LOCAL_DEFAULT_TIMEOUT_MS = 300_000;

class DagStartError extends Error {
  public constructor(public readonly dagError: IDagError) {
    super(`startRun failed: ${dagError.code}`);
  }
}

/** Options accepted by {@link LocalDagRuntimeProvider}. */
export interface ILocalDagRuntimeProviderOptions {
  /** Trusted limits for a fresh root invocation. */
  snapshotBudgetLimits?: ITaskSnapshotBudgetLimits;
  /** Inherited live root authority for a nested invocation. */
  snapshotBudget?: ITaskSnapshotBudget;
  /** Inherited live root credit authority for nested executions. */
  rootCreditBudget?: IRootCreditBudget;
  /** Trusted host policy; workflow data cannot change this ceiling. */
  byteLimits?: IDagExecutionByteLimits;
  /** Trusted absolute filesystem root propagated to every node. */
  executionRoot: string;
  /**
   * Base node registry. Defaults to the lazily-loaded `createDefaultNodeRegistrySync` from
   * `@robota-sdk/dag-nodes-default` (ARCH-PROVIDER-004). The CLI uses this 23-node default
   * and supplies saved instant nodes separately; callers needing other nodes inject a registry.
   */
  nodeRegistry?: IDagNodeDefinition[];
  projectDir?: string;
  /**
   * FLOW-007: injected workspace layout (root dir + workflow ext). Reserved for local node discovery
   * from `<root>/nodes/` when running authored workflows that reference local prompt/code nodes.
   */
  workspace?: IWorkspaceLayout;
  instantNodes?: IDagNodeDefinition[];
  extraNodes?: IDagNodeDefinition[];
  /** Trusted lineage supplied when this provider executes one nested in-process child DAG. */
  lineage?: IDagExecutionLineage;
}

/**
 * Local (in-process) implementation of {@link IDagRuntimeProvider}.
 *
 * Surfaces the node catalog via {@link listNodes} and runs an {@link IDagDefinition} via
 * {@link execute} (DAG-002 — it took a `.dag.json` workflow file before), emitting
 * {@link IDagRuntimeProgressEvent}s as the run progresses.
 */
export class LocalDagRuntimeProvider implements IDagRuntimeProvider {
  public readonly providerId = 'local';
  public readonly displayName = 'Local (in-process)';

  private readonly executionRoot: string;
  private readonly snapshotBudgetLimits: ITaskSnapshotBudgetLimits;
  private readonly byteLimits: IDagExecutionByteLimits;
  public constructor(private readonly options: ILocalDagRuntimeProviderOptions) {
    this.executionRoot = resolveTrustedExecutionRoot(options.executionRoot);
    this.snapshotBudgetLimits = resolveTaskSnapshotBudgetLimits(options.snapshotBudgetLimits);
    this.byteLimits = resolveDagExecutionByteLimits(options.byteLimits);
  }

  public async listNodes(): Promise<IDagNodeManifest[]> {
    const allDefs = await this.buildNodeRegistry();
    return allDefs.map(toObjectInfoManifest);
  }

  public async execute(
    dag: IDagDefinition,
    inputs: Record<string, unknown>,
    options?: IDagRuntimeExecuteOptions,
  ): Promise<IDagRuntimeResult> {
    const nodeDefinitions = await this.buildNodeRegistry();
    // DAG-002: run as given. `fromDagWorkflowFile(dag, undefined)` used to sit here, rewriting every
    // node id to `node-<n>` — undoing a conversion the caller had just performed.

    const startMs = Date.now();
    const inheritedBudget = this.options.snapshotBudget;
    const snapshotBudget = inheritedBudget ?? new TaskSnapshotBudget(this.snapshotBudgetLimits);
    const inheritedCreditBudget = this.options.rootCreditBudget;
    let rootCreditBudget: IRootCreditBudget | undefined;
    try {
      rootCreditBudget = inheritedCreditBudget ?? new RootCreditBudget(dag.costPolicy?.runCreditLimit);
      const result = await runDagOnce(
        dag,
        nodeDefinitions,
        this.executionRoot,
        inputs as TPortPayload,
        options?.onProgress,
        options?.signal,
        this.options.lineage,
        this.byteLimits,
        snapshotBudget,
        rootCreditBudget,
      );

      const durationMs = Date.now() - startMs;
      const outputs = collectOutputsFromTaskRuns(result.taskRuns);
      const ok = result.dagRun.status === 'success';
      const errorMessage = ok ? undefined : extractRunError(result.taskRuns);
      const failedTask = ok
        ? undefined
        : result.taskRuns.findLast((task) => task.status === 'failed');

      options?.onProgress?.({
        type: 'dag_complete',
        nodeId: '',
        durationMs,
        finalOutput: ok ? extractFinalText(result.taskRuns) : undefined,
        error: ok ? undefined : (errorMessage ?? 'DAG run did not succeed'),
      });

      return {
        ok,
        outputs,
        durationMs,
        ...(ok ? {} : { error: errorMessage ?? 'DAG run did not succeed' }),
        ...(failedTask?.errorCode ? { errorCode: failedTask.errorCode } : {}),
        ...(result.terminalRetryable === undefined
          ? {}
          : { errorRetryable: result.terminalRetryable }),
      };
    } catch (err) {
      // allow-fallback: provider contract returns a structured IDagRuntimeResult — surfacing errors as ok=false is the documented behaviour
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);
      options?.onProgress?.({
        type: 'dag_complete',
        nodeId: '',
        durationMs,
        error,
      });
      return {
        ok: false, outputs: {}, durationMs, error,
        ...(err instanceof DagStartError
          ? { errorCode: err.dagError.code, errorRetryable: err.dagError.retryable }
          : {}),
      };
    } finally {
      if (inheritedBudget === undefined) snapshotBudget.close();
      if (inheritedCreditBudget === undefined) rootCreditBudget?.close();
    }
  }

  /**
   * Builds the merged node registry. Priority (highest wins on conflict):
   *   instant nodes > extra nodes > base.
   * (Local file-based nodes can be appended by passing them through
   *  `extraNodes`; node-file scanning is owned by the CLI layer to avoid
   *  pulling Node.js fs APIs into dag-framework consumers.)
   */
  private async buildNodeRegistry(): Promise<IDagNodeDefinition[]> {
    const base = this.options.nodeRegistry ?? (await loadDefaultNodeRegistrySync());
    const instant = this.options.instantNodes ?? [];
    const extra = this.options.extraNodes ?? [];

    const overrideTypes = new Set([
      ...instant.map((n) => n.nodeType),
      ...extra.map((n) => n.nodeType),
    ]);

    return [...base.filter((n) => !overrideTypes.has(n.nodeType)), ...extra, ...instant];
  }
}

interface IDagRunOutcome {
  dagRun: IDagRun;
  taskRuns: ITaskRun[];
  terminalRetryable?: boolean;
}

/**
 * Run a single DAG definition in-process, forwarding internal run-progress
 * events to an {@link IDagRuntimeProgressEvent} callback.
 */
async function runDagOnce(
  dagDefinition: IDagDefinition,
  nodeDefinitions: IDagNodeDefinition[],
  executionRoot: string,
  inputs: TPortPayload,
  onProgress: ((event: IDagRuntimeProgressEvent) => void) | undefined,
  signal: AbortSignal | undefined,
  lineage: IDagExecutionLineage | undefined,
  byteLimits: IDagExecutionByteLimits,
  snapshotBudget: ITaskSnapshotBudget,
  rootCreditBudget: IRootCreditBudget,
): Promise<IDagRunOutcome> {
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    throw new Error(`Node definition assembly failed: ${assemblyResult.error.code}`);
  }
  const assembly = assemblyResult.value;

  const manifestRegistry = new StaticNodeManifestRegistry(assembly.manifests);
  const handlerRegistry = new StaticNodeTaskHandlerRegistry(assembly.handlersByType);
  const lifecycleFactory = new StaticNodeLifecycleFactory(handlerRegistry);
  const executor: ITaskExecutorPort = new IsolatedRegexTaskExecutor(
    new LifecycleTaskExecutorPort(manifestRegistry, lifecycleFactory, lineage),
  );

  const storage = new InMemoryStoragePort();
  const composition = createExecutionComposition(
    {
      executionRoot,
      byteLimits,
      snapshotBudget,
      rootCreditBudget,
      storage,
      queue: new InMemoryQueuePort(),
      deadLetterQueue: new InMemoryQueuePort(),
      lease: new InMemoryLeasePort(),
      executor,
      clock: new SystemClockPort(),
    },
    {
      worker: {
        workerId: LOCAL_WORKER_ID,
        leaseDurationMs: LOCAL_LEASE_DURATION_MS,
        visibilityTimeoutMs: LOCAL_VISIBILITY_TIMEOUT_MS,
        maxAttempts: LOCAL_MAX_ATTEMPTS,
        defaultTimeoutMs: LOCAL_DEFAULT_TIMEOUT_MS,
        retryEnabled: false,
      },
    },
  );

  const nodeTypeById = new Map(dagDefinition.nodes.map((n) => [n.nodeId, n.nodeType]));
  const startTimesByNode = new Map<string, number>();
  let terminalRetryable: boolean | undefined;

  const unsubscribe = composition.runProgressEventBus.subscribe((event: TRunProgressEvent) => {
    if (event.eventType === 'task.failed') terminalRetryable = event.error.retryable;
    if (!onProgress) return;
    if (event.eventType === 'task.started') {
      startTimesByNode.set(event.nodeId, Date.now());
      onProgress({
        type: 'node_start',
        nodeId: event.nodeId,
        nodeType: nodeTypeById.get(event.nodeId),
      });
    } else if (event.eventType === 'task.completed') {
      const startedAt = startTimesByNode.get(event.nodeId);
      onProgress({
        type: 'node_complete',
        nodeId: event.nodeId,
        nodeType: nodeTypeById.get(event.nodeId),
        durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
      });
    } else if (event.eventType === 'task.failed') {
      const startedAt = startTimesByNode.get(event.nodeId);
      onProgress({
        type: 'node_error',
        nodeId: event.nodeId,
        nodeType: nodeTypeById.get(event.nodeId),
        durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
        error: event.error.message ?? event.error.code,
      });
    }
  });

  try {
    const publishedDefinition: IDagDefinition = { ...dagDefinition, status: 'published' };
    await storage.saveDefinition(publishedDefinition);

    const startResult = await composition.runOrchestrator.startRun({
      dagId: dagDefinition.dagId,
      version: dagDefinition.version,
      trigger: 'manual',
      input: inputs,
    });
    if (!startResult.ok) {
      throw new DagStartError(startResult.error);
    }
    const { dagRunId } = startResult.value;

    let cancellation: Promise<unknown> | undefined;
    const cancel = (): void => {
      cancellation ??= composition.runCancel.cancelRun(dagRunId);
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    try {
      const terminal = await composition.runAdvancement.waitForTerminal(dagRunId);
      if (!terminal.ok) throw new Error(`Run advancement failed: ${terminal.error.code}`);
      return {
        ...terminal.value,
        ...(terminalRetryable === undefined ? {} : { terminalRetryable }),
      };
    } finally {
      signal?.removeEventListener('abort', cancel);
      await cancellation;
      await composition.runAdvancement.stop();
    }
  } finally {
    unsubscribe();
  }
}

// ---------------------------------------------------------------------------
// Manifest conversion: IDagNodeDefinition → node manifest catalog entry
// ---------------------------------------------------------------------------

function toObjectInfoManifest(def: IDagNodeDefinition): IDagNodeManifest {
  const required: Record<string, INodePortSpec> = {};
  const optional: Record<string, INodePortSpec> = {};

  for (const port of def.inputs ?? []) {
    const portType = toCatalogType(port.type);
    const schema: Record<string, unknown> = {};
    const portWithDefault = port as { default?: unknown };
    if (portWithDefault.default !== undefined) {
      schema['default'] = portWithDefault.default;
    }

    const spec: INodePortSpec = Object.keys(schema).length > 0 ? [portType, schema] : [portType];

    const required_ = (port as { required?: boolean }).required;
    if (required_ !== false) {
      required[port.key] = spec;
    } else {
      optional[port.key] = spec;
    }
  }

  const outputs = def.outputs ?? [];
  const manifest: IDagNodeManifest = {
    nodeType: def.nodeType,
    input: { required },
    output: outputs.map((p) => toCatalogType(p.type)),
    output_name: outputs.map((p) => p.key),
    category: def.category ?? 'robota',
    source: 'local',
  };
  if (Object.keys(optional).length > 0) {
    manifest.input.optional = optional;
  }
  return manifest;
}

const TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  object: 'JSON',
  binary: 'IMAGE',
  number: 'FLOAT',
  boolean: 'BOOLEAN',
  integer: 'INT',
};

function toCatalogType(type: string): string {
  return TYPE_MAP[type] ?? type.toUpperCase();
}
