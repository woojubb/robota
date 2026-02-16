import type {
    IClockPort,
    ILeasePort,
    IQueuePort,
    IStoragePort,
    ITaskExecutorPort
} from '@robota-sdk/dag-core';
import { WorkerLoopService, type IWorkerLoopOptions } from '../services/worker-loop-service.js';

export interface IWorkerLoopDependencies {
    storage: IStoragePort;
    queue: IQueuePort;
    deadLetterQueue?: IQueuePort;
    lease: ILeasePort;
    executor: ITaskExecutorPort;
    clock: IClockPort;
}

export interface IWorkerLoopPolicyOptions extends Omit<IWorkerLoopOptions, 'retryEnabled'> {
    retryEnabled?: boolean;
    deadLetterEnabled?: boolean;
}

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
        resolvedOptions
    );
}
