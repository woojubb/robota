import type {
  IClockPort,
  ILeasePort,
  IQueuePort,
  IStoragePort,
  ITaskExecutorPort,
} from '@robota-sdk/dag-core';
import { RunCancelService, RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import {
  createWorkerLoopService,
  RunAdvancementCoordinator,
  type IRunAdvancementCoordinatorLogger,
  type IWorkerLoopPolicyOptions,
} from '@robota-sdk/dag-worker';
import { RunProgressEventBus } from '@robota-sdk/dag-api';
import type { IDagExecutionComposition } from '../types.js';

/** Infrastructure dependencies required for DAG execution. */
export interface IDagExecutionCompositionDependencies {
  executionRoot: string;
  storage: IStoragePort;
  queue: IQueuePort;
  deadLetterQueue?: IQueuePort;
  lease: ILeasePort;
  executor: ITaskExecutorPort;
  clock: IClockPort;
}

/** Worker policy options for execution composition. */
export interface IDagExecutionCompositionOptions {
  worker: IWorkerLoopPolicyOptions;
  logger?: IRunAdvancementCoordinatorLogger;
}

/**
 * Creates execution services with concrete runtime and worker packages.
 */
export function createExecutionComposition(
  dependencies: IDagExecutionCompositionDependencies,
  options: IDagExecutionCompositionOptions,
): IDagExecutionComposition {
  const runProgressEventBus = new RunProgressEventBus();
  const runOrchestrator = new RunOrchestratorService(
    dependencies.storage,
    dependencies.queue,
    dependencies.clock,
    runProgressEventBus,
  );
  const runQuery = new RunQueryService(dependencies.storage);
  const runCancel = new RunCancelService(dependencies.storage, dependencies.clock);

  const workerLoop = createWorkerLoopService(
    {
      executionRoot: dependencies.executionRoot,
      storage: dependencies.storage,
      queue: dependencies.queue,
      deadLetterQueue: dependencies.deadLetterQueue,
      lease: dependencies.lease,
      executor: dependencies.executor,
      clock: dependencies.clock,
      runProgressEventReporter: runProgressEventBus,
    },
    {
      ...options.worker,
      retryEnabled: options.worker.retryEnabled ?? false,
    },
  );
  const runAdvancement = new RunAdvancementCoordinator(workerLoop, runQuery, options.logger);

  return {
    runOrchestrator,
    runQuery,
    runCancel,
    runAdvancement,
    runProgressEventBus,
  };
}
