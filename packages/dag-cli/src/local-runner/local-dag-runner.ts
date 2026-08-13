import type {
  IDagDefinition,
  IDagNodeDefinition,
  IDagRun,
  ITaskRun,
  ITaskExecutorPort,
  TPortPayload,
} from '@robota-sdk/dag-core';
import { resolveTrustedExecutionRoot } from '@robota-sdk/agent-core/node';
import { LifecycleTaskExecutorPort } from '@robota-sdk/dag-core';
import {
  InMemoryStoragePort,
  InMemoryQueuePort,
  InMemoryLeasePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import {
  buildNodeDefinitionAssembly,
  StaticNodeLifecycleFactory,
  StaticNodeManifestRegistry,
  StaticNodeTaskHandlerRegistry,
} from '@robota-sdk/dag-node';
import {
  createExecutionComposition,
  type IDagExecutionComposition,
} from '@robota-sdk/dag-framework';

const LOCAL_WORKER_ID = 'local-cli';
const LOCAL_LEASE_DURATION_MS = 60_000;
const LOCAL_VISIBILITY_TIMEOUT_MS = 60_000;
const LOCAL_MAX_ATTEMPTS = 1;
const LOCAL_DEFAULT_TIMEOUT_MS = 300_000;

/** Result snapshot returned after a local run completes. */
export interface ILocalRunResult {
  dagRun: IDagRun;
  taskRuns: ITaskRun[];
}

/**
 * Embeds the DAG runtime, worker, and adapters in-process.
 * No server is required.
 */
export class LocalDagRunner {
  private readonly composition: IDagExecutionComposition;
  private readonly storage: InMemoryStoragePort;

  public constructor(nodeDefinitions: IDagNodeDefinition[], executionRoot: string) {
    const trustedExecutionRoot = resolveTrustedExecutionRoot(executionRoot);
    const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
    if (!assemblyResult.ok) {
      throw new Error(`Node definition assembly failed: ${assemblyResult.error.code}`);
    }
    const assembly = assemblyResult.value;

    const manifestRegistry = new StaticNodeManifestRegistry(assembly.manifests);
    const handlerRegistry = new StaticNodeTaskHandlerRegistry(assembly.handlersByType);
    const lifecycleFactory = new StaticNodeLifecycleFactory(handlerRegistry);
    const executor: ITaskExecutorPort = new LifecycleTaskExecutorPort(
      manifestRegistry,
      lifecycleFactory,
    );

    this.storage = new InMemoryStoragePort();
    this.composition = createExecutionComposition(
      {
        executionRoot: trustedExecutionRoot,
        storage: this.storage,
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
  }

  /** The run-progress event bus for progress streaming. */
  public get events(): IDagExecutionComposition['runProgressEventBus'] {
    return this.composition.runProgressEventBus;
  }

  /**
   * Registers the definition as published, starts a run, then drives the
   * worker loop in-process until the run reaches a terminal state.
   */
  public async run(dagDefinition: IDagDefinition, inputs: TPortPayload): Promise<ILocalRunResult> {
    const publishedDefinition: IDagDefinition = { ...dagDefinition, status: 'published' };
    await this.storage.saveDefinition(publishedDefinition);

    const startResult = await this.composition.runOrchestrator.startRun({
      dagId: dagDefinition.dagId,
      version: dagDefinition.version,
      trigger: 'manual',
      input: inputs,
    });
    if (!startResult.ok) {
      throw new Error(`startRun failed: ${startResult.error.code}`);
    }
    const { dagRunId } = startResult.value;

    const terminal = await this.composition.runAdvancement.waitForTerminal(dagRunId);
    if (!terminal.ok) throw new Error(`Run advancement failed: ${terminal.error.code}`);
    return terminal.value;
  }
}
