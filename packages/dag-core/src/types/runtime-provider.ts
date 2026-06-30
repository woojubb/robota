// DAG Runtime Provider abstraction.
//
// PROVIDER-001: Provider interfaces for the DAG runtime. The
// `IDagRuntimeProvider` contract abstracts the node catalog and DAG execution
// behind a single TypeScript interface, so that a local in-process runtime —
// and any future native provider — are fully substitutable.

import type { IDagWorkflowFile } from './workflow-file.js';

/**
 * Port type spec for a node input.
 *
 * An input port is one of:
 *   - `[typeName]` — bare type, e.g. `["STRING"]`
 *   - `[typeName, schema]` — type plus widget options, e.g. `["INT", { default: 0 }]`
 *   - `[choices, schema]` — enumerated choices plus options
 */
export type INodePortSpec =
  | [string]
  | [string, Record<string, unknown>]
  | [string[], Record<string, unknown>];

/**
 * A single node entry in the catalog returned by `listNodes()`.
 *
 * Describes a node's input ports, outputs, and category so callers can build
 * and validate a DAG against the available node set.
 */
export interface IDagNodeManifest {
  nodeType: string;
  input: {
    required: Record<string, INodePortSpec>;
    optional?: Record<string, INodePortSpec>;
  };
  output: string[];
  output_name: string[];
  category: string;
  description?: string;
  /** Origin of this manifest. Currently always the local in-process registry. */
  source: 'local';
}

/**
 * A progress event emitted during DAG execution:
 *   - `node_start` — a node began executing
 *   - `node_complete` — a node finished (with cached/output info)
 *   - `node_error` — a node failed
 *   - `dag_complete` — the whole DAG finished
 */
export interface IDagRuntimeProgressEvent {
  type: 'node_start' | 'node_complete' | 'node_error' | 'dag_complete';
  nodeId: string;
  nodeType?: string;
  durationMs?: number;
  error?: string;
  finalOutput?: string;
  progress?: { value: number; max: number };
}

/** Options accepted by {@link IDagRuntimeProvider.execute}. */
export interface IDagRuntimeExecuteOptions {
  onProgress?: (event: IDagRuntimeProgressEvent) => void;
  signal?: AbortSignal;
}

/** Final result of a single DAG execution. */
export interface IDagRuntimeResult {
  ok: boolean;
  outputs: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

/** Lifecycle phase of an asynchronously tracked run. */
export type TRunPhase = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Detailed status of a single run, polled via {@link IDetachableRunProvider.getRunStatus}. */
export interface IDagRunStatus {
  runId: string;
  phase: TRunPhase;
  currentNodeId?: string;
  progress?: { completed: number; total: number };
  result?: IDagRuntimeResult;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Summary entry returned by {@link IDetachableRunProvider.listRuns}. */
export interface IDagRunSummary {
  runId: string;
  phase: TRunPhase;
  dagFile?: string;
  submittedAt: string;
  durationMs?: number;
}

/** Options for {@link IDetachableRunProvider.listRuns}. */
export interface IListRunsOptions {
  phase?: TRunPhase | TRunPhase[];
  limit?: number;
}

/**
 * Base provider contract: every backend that can run a DAG must implement
 * this — a node catalog (`listNodes`) plus a DAG execute round-trip.
 */
export interface IDagRuntimeProvider {
  readonly providerId: string;
  readonly displayName: string;
  listNodes(): Promise<IDagNodeManifest[]>;
  execute(
    dag: IDagWorkflowFile,
    inputs: Record<string, unknown>,
    options?: IDagRuntimeExecuteOptions,
  ): Promise<IDagRuntimeResult>;
}

/**
 * Detachable run provider — separates submission from result watching so
 * that long-running asynchronous runs can be polled or resumed via a
 * `runId` + queue/history lifecycle.
 */
export interface IDetachableRunProvider extends IDagRuntimeProvider {
  submitRun(dag: IDagWorkflowFile, inputs: Record<string, unknown>): Promise<string>;
  watchRun(
    runId: string,
    onProgress: (event: IDagRuntimeProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<IDagRuntimeResult>;
  getRunStatus(runId: string): Promise<IDagRunStatus>;
  cancelRun(runId: string): Promise<void>;
  listRuns(options?: IListRunsOptions): Promise<IDagRunSummary[]>;
}
