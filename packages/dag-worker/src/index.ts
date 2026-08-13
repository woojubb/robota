// @robota-sdk/dag-worker
// Worker services will be exported here.

export * from './services/worker-loop-service.js';
export * from './services/run-advancement-coordinator.js';
export * from './services/dlq-reinject-service.js';
// DAG-001: the reader for `IStoragePort.listStaleRunningTaskRuns` — recovery on a queue that does
// not redeliver.
export * from './services/stale-task-sweeper.js';
export * from './composition/create-worker-loop-service.js';

/** Package name constant for the DAG worker package. */
export const DAG_WORKER_PACKAGE_NAME = '@robota-sdk/dag-worker';
