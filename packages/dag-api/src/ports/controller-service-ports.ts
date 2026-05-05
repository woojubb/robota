import type {
  IDagError,
  IDagRun,
  ITaskRun,
  TDagRunStatus,
  TDagTriggerType,
  TPortPayload,
  TRunProgressEvent,
  TTaskRunStatus,
  TResult,
} from '@robota-sdk/dag-core';
import type { TRunProgressEventListener } from '../composition/run-progress-event-bus.js';

/** Input required by API controllers to start a runtime DAG run. */
export interface IRuntimeStartRunInput {
  dagId: string;
  version?: number;
  trigger: TDagTriggerType;
  logicalDate?: string;
  rerunKey?: string;
  input: TPortPayload;
}

/** Runtime run start response exposed through API controllers. */
export interface IRuntimeStartRunResult {
  dagRunId: string;
  dagId: string;
  version: number;
  logicalDate: string;
  taskRunIds: string[];
}

/** Runtime run creation response before task dispatch. */
export interface IRuntimeCreateRunResult {
  dagRunId: string;
  dagId: string;
  version: number;
  logicalDate: string;
  status: TDagRunStatus;
}

/** Composite read result for a DAG run and its task runs. */
export interface IRuntimeRunReadResult {
  dagRun: IDagRun;
  taskRuns: ITaskRun[];
}

/** Runtime run cancellation response exposed through API controllers. */
export interface IRuntimeRunCancelResult {
  dagRunId: string;
  status: 'cancelled';
}

/** Minimal runtime capability needed to start DAG runs. */
export interface IRuntimeRunStarterPort {
  startRun(input: IRuntimeStartRunInput): Promise<TResult<IRuntimeStartRunResult, IDagError>>;
}

/** Minimal runtime capability needed to create and dispatch DAG runs separately. */
export interface IRuntimeRunCreatorPort extends IRuntimeRunStarterPort {
  createRun(input: IRuntimeStartRunInput): Promise<TResult<IRuntimeCreateRunResult, IDagError>>;
  startCreatedRun(dagRunId: string): Promise<TResult<IRuntimeStartRunResult, IDagError>>;
}

/** Minimal runtime capability needed to read DAG runs. */
export interface IRuntimeRunReaderPort {
  getRun(dagRunId: string): Promise<TResult<IRuntimeRunReadResult, IDagError>>;
}

/** Minimal runtime capability needed to cancel DAG runs. */
export interface IRuntimeRunCancellerPort {
  cancelRun(dagRunId: string): Promise<TResult<IRuntimeRunCancelResult, IDagError>>;
}

/** Observability status counts keyed by task run status. */
export type TObservabilityTaskStatusSummary = Record<TTaskRunStatus, number>;

/** API read-model projection for a DAG run. */
export interface IRunProjectionView {
  dagRun: IDagRun;
  taskRuns: ITaskRun[];
  taskStatusSummary: TObservabilityTaskStatusSummary;
}

/** API read-model projection for one lineage node. */
export interface ILineageNodeView {
  nodeId: string;
  nodeType: string;
  dependsOn: string[];
  taskStatus?: TTaskRunStatus;
}

/** API read-model projection for one lineage edge. */
export interface ILineageEdgeView {
  from: string;
  to: string;
}

/** API read-model projection for a DAG run lineage graph. */
export interface ILineageProjectionView {
  dagId: string;
  version: number;
  dagRunId: string;
  nodes: ILineageNodeView[];
  edges: ILineageEdgeView[];
}

/** Combined observability projection returned by dashboard endpoints. */
export interface IObservabilityDashboardProjection {
  runProjection: IRunProjectionView;
  lineageProjection: ILineageProjectionView;
}

/** Minimal projection capability needed by observability controllers. */
export interface IObservabilityProjectionReaderPort {
  buildRunProjection(dagRunId: string): Promise<TResult<IRunProjectionView, IDagError>>;
  buildLineageProjection(dagRunId: string): Promise<TResult<ILineageProjectionView, IDagError>>;
  buildDashboardProjection(
    dagRunId: string,
  ): Promise<TResult<IObservabilityDashboardProjection, IDagError>>;
}

/** Result of reinjecting a dead-letter item through diagnostics. */
export interface IDiagnosticsDeadLetterReinjectResult {
  reinjected: boolean;
  taskRunId?: string;
}

/** Minimal DLQ capability needed by diagnostics controllers. */
export interface IDiagnosticsDeadLetterReinjectPort {
  reinjectOnce(
    workerId: string,
    visibilityTimeoutMs: number,
  ): Promise<TResult<IDiagnosticsDeadLetterReinjectResult, IDagError>>;
}

/** Result of one runtime worker loop iteration. */
export interface IRuntimeWorkerLoopResult {
  processed: boolean;
  taskRunId?: string;
  retried?: boolean;
}

/** Minimal worker loop capability needed by Prompt API backends. */
export interface IRuntimeWorkerLoopPort {
  processOnce(): Promise<TResult<IRuntimeWorkerLoopResult, IDagError>>;
}

/** Minimal run-progress event bus capability needed by runtime WebSocket bridges. */
export interface IRuntimeRunProgressEventBusPort {
  publish(event: TRunProgressEvent): void;
  subscribe(listener: TRunProgressEventListener): () => void;
}

/** Runtime execution composition contract consumed by Prompt API backends. */
export interface IDagExecutionComposition {
  runOrchestrator: IRuntimeRunCreatorPort;
  runQuery: IRuntimeRunReaderPort;
  runCancel: IRuntimeRunCancellerPort;
  workerLoop: IRuntimeWorkerLoopPort;
  runProgressEventBus: IRuntimeRunProgressEventBusPort;
}
