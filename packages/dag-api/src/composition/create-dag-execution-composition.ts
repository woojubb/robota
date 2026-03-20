import type {
    IClockPort,
    ILeasePort,
    IQueuePort,
    IStoragePort,
    ITaskExecutorPort
} from '@robota-sdk/dag-core';
import {
    RunCancelService,
    RunOrchestratorService,
    RunQueryService
} from '@robota-sdk/dag-runtime';
import {
    createWorkerLoopService,
    type IWorkerLoopPolicyOptions,
    type WorkerLoopService
} from '@robota-sdk/dag-worker';
import { RunProgressEventBus, type IRunProgressEventBus } from './run-progress-event-bus.js';

/** Infrastructure dependencies required for DAG execution composition. */
export interface IDagExecutionCompositionDependencies {
    storage: IStoragePort;
    queue: IQueuePort;
    deadLetterQueue?: IQueuePort;
    lease: ILeasePort;
    executor: ITaskExecutorPort;
    clock: IClockPort;
}

/** Configuration options for DAG execution composition, including worker policy. */
export interface IDagExecutionCompositionOptions {
    worker: IWorkerLoopPolicyOptions;
}

/** Composed set of DAG execution services: orchestrator, query, cancel, worker, and event bus. */
export interface IDagExecutionComposition {
    runOrchestrator: RunOrchestratorService;
    runQuery: RunQueryService;
    runCancel: RunCancelService;
    workerLoop: WorkerLoopService;
    runProgressEventBus: IRunProgressEventBus;
}

/**
 * Creates a fully wired DAG execution composition with orchestrator, worker loop, and event bus.
 * @param dependencies - Infrastructure ports (storage, queue, lease, executor, clock).
 * @param options - Worker loop policy options.
 * @returns Composed execution services ready for DAG run processing.
 */
export function createDagExecutionComposition(
    dependencies: IDagExecutionCompositionDependencies,
    options: IDagExecutionCompositionOptions
): IDagExecutionComposition {
    const runProgressEventBus = new RunProgressEventBus();
    const runOrchestrator = new RunOrchestratorService(
        dependencies.storage,
        dependencies.queue,
        dependencies.clock,
        runProgressEventBus
    );
    const runQuery = new RunQueryService(dependencies.storage);
    const runCancel = new RunCancelService(dependencies.storage, dependencies.clock);

    const workerLoop = createWorkerLoopService(
        {
            storage: dependencies.storage,
            queue: dependencies.queue,
            deadLetterQueue: dependencies.deadLetterQueue,
            lease: dependencies.lease,
            executor: dependencies.executor,
            clock: dependencies.clock,
            runProgressEventReporter: runProgressEventBus
        },
        {
            ...options.worker,
            retryEnabled: options.worker.retryEnabled ?? false
        }
    );

    return {
        runOrchestrator,
        runQuery,
        runCancel,
        workerLoop,
        runProgressEventBus
    };
}
