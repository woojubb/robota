import type {
    IClockPort,
    ILeasePort,
    IQueuePort,
    IRunProgressEventReporter,
    IStoragePort,
    ITaskExecutorPort
} from '@robota-sdk/dag-core';
import { WorkerLoopService, type IWorkerLoopOptions } from '../services/worker-loop-service.js';

/** Port dependencies required to construct a WorkerLoopService. */
export interface IWorkerLoopDependencies {
    storage: IStoragePort;
    queue: IQueuePort;
    deadLetterQueue?: IQueuePort;
    lease: ILeasePort;
    executor: ITaskExecutorPort;
    clock: IClockPort;
    runProgressEventReporter?: IRunProgressEventReporter;
}

/** Policy options for worker loop construction with optional retry/dead-letter defaults. */
export interface IWorkerLoopPolicyOptions extends Omit<IWorkerLoopOptions, 'retryEnabled'> {
    retryEnabled?: boolean;
    deadLetterEnabled?: boolean;
}

/**
 * Factory function that creates a fully configured WorkerLoopService,
 * applying defaults for retry and dead-letter policies.
 * @param dependencies - Port implementations (storage, queue, lease, executor, clock).
 * @param options - Policy options with optional retry/dead-letter flags (default: disabled).
 * @returns A configured WorkerLoopService instance.
 */
export function createWorkerLoopService(
    dependencies: IWorkerLoopDependencies,
    options: IWorkerLoopPolicyOptions
): WorkerLoopService {
    const resolvedOptions: IWorkerLoopOptions = {
        ...options,
        retryEnabled: options.retryEnabled ?? false,
        deadLetterEnabled: options.deadLetterEnabled ?? false,
        deadLetterQueue: dependencies.deadLetterQueue
    };

    return new WorkerLoopService(
        dependencies.storage,
        dependencies.queue,
        dependencies.lease,
        dependencies.executor,
        dependencies.clock,
        resolvedOptions,
        dependencies.runProgressEventReporter
    );
}
