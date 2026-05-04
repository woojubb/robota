import type { TPortPayload } from '../interfaces/ports.js';

/** Node-local side-effect status that can block a DAG run before execution starts. */
export type TNodeOperationStatus = 'idle' | 'uploading';

/** Node execution status projected from run progress events and final run results. */
export type TNodeExecutionStatus = 'idle' | 'running' | 'success' | 'failed';

/** Lightweight execution trace suitable for orchestration and designer views. */
export interface IDagNodeExecutionTrace {
  nodeId: string;
  input?: TPortPayload;
  output?: TPortPayload;
}

/** Canonical per-node orchestration state. This state is not persisted in DAG definitions. */
export interface IDagNodeState {
  operationStatus: TNodeOperationStatus;
  executionStatus: TNodeExecutionStatus;
  pendingDescription?: string;
  trace?: IDagNodeExecutionTrace;
}

/** Node-id keyed orchestration state map. */
export type TNodeStateMap = Record<string, IDagNodeState>;
