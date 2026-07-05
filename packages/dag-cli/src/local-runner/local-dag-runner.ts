import type {
  IDagDefinition,
  IDagNodeDefinition,
  IDagRun,
  ITaskRun,
  ITaskExecutorPort,
  TPortPayload,
} from '@robota-sdk/dag-core';
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
import type { IDagExecutionComposition } from '@robota-sdk/dag-api';
import { createExecutionComposition } from '@robota-sdk/dag-framework';

const LOCAL_WORKER_ID = 'local-cli';
const LOCAL_LEASE_DURATION_MS = 60_000;
const LOCAL_VISIBILITY_TIMEOUT_MS = 60_000;
const LOCAL_MAX_ATTEMPTS = 1;
const LOCAL_DEFAULT_TIMEOUT_MS = 300_000;
const WORKER_IDLE_POLL_DELAY_MS = 10;
const MAX_WORKER_ITERATIONS = 10_000;

/** Result snapshot returned after a local run completes. */
export interface ILocalRunResult {
  dagRun: IDagRun;
  taskRuns: ITaskRun[];
}

function isTerminalStatus(status: string): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Embeds the DAG runtime, worker, and adapters in-process.
 * No server is required.
 */
export class LocalDagRunner {
  private readonly composition: IDagExecutionComposition;
  private readonly storage: InMemoryStoragePort;

  public constructor(nodeDefinitions: IDagNodeDefinition[]) {
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

    for (let i = 0; i < MAX_WORKER_ITERATIONS; i++) {
      const stepResult = await this.composition.workerLoop.processOnce();
      if (!stepResult.ok) {
        throw new Error(`Worker step failed: ${stepResult.error.code}`);
      }

      const queryResult = await this.composition.runQuery.getRun(dagRunId);
      if (!queryResult.ok) {
        throw new Error(`Run query failed: ${queryResult.error.code}`);
      }

      const { dagRun, taskRuns } = queryResult.value;
      if (isTerminalStatus(dagRun.status)) {
        return { dagRun, taskRuns };
      }

      if (!stepResult.value.processed) {
        await sleep(WORKER_IDLE_POLL_DELAY_MS);
      }
    }

    throw new Error(
      `Run ${dagRunId} did not reach terminal state after ${MAX_WORKER_ITERATIONS} iterations`,
    );
  }
}
