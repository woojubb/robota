import type { IRegexReplaceOperation } from '../types/regex-replace-operation.js';
import type { ITaskSnapshotBudget } from '../services/task-snapshot-budget.js';
import type { IRootCreditBudget } from '../services/root-credit-budget.js';
import type { IDagExecutionByteLimits } from '../types/execution-byte-limits.js';
import type { TExecutionCommit, IExecutionCommitResult } from '../services/execution-commit.js';
import type {
  ICostPolicy,
  IDagNode,
  IDagDefinition,
  IDagRun,
  ITaskRun,
  TDagRunStatus,
  TTaskRunStatus,
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';

/** Primitive value types that can flow through node ports. */
export type TPortPrimitive = string | number | boolean | null;
/** Kind of binary content carried in a port payload. */
export type TPortBinaryKind = 'image' | 'video' | 'audio' | 'file';
/** Resolution strategy for binary references. */
export type TBinaryReferenceType = 'asset' | 'uri';

/** A binary value within a port payload, referencing media content. */
export interface IPortBinaryValue {
  kind: TPortBinaryKind;
  mimeType: string;
  uri: string;
  referenceType?: TBinaryReferenceType;
  assetId?: string;
  sizeBytes?: number;
}

/** A flat key-value object within a port payload. */
export type TPortObjectValue = Record<string, TPortPrimitive>;
/** An ordered list of port values. */
export type TPortArrayValue = TPortValue[];

/** Any value that can appear in a single port slot. */
export type TPortValue = TPortPrimitive | IPortBinaryValue | TPortArrayValue | TPortObjectValue;

/** Keyed collection of port values — the data flowing between DAG nodes. */
export type TPortPayload = Record<string, TPortValue>;

/** Message dispatched to the task queue for worker consumption. */
export interface IQueueMessage {
  messageId: string;
  dagRunId: string;
  taskRunId: string;
  nodeId: string;
  attempt: number;
  executionPath: string[];
  payload: TPortPayload;
  createdAt: string;
}

/** Port for task queue operations: enqueue, dequeue, acknowledge, and reject. */
export interface IQueuePort {
  enqueue(message: IQueueMessage): Promise<void>;
  dequeue(
    workerId: string,
    visibilityTimeoutMs: number,
    waitTimeoutMs?: number,
  ): Promise<IQueueMessage | undefined>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string): Promise<void>;
}

/** Record of an active distributed lease on a task. */
export interface ILeaseRecord {
  leaseKey: string;
  ownerId: string;
  acquiredAt: string;
  leaseUntil: string;
}

/**
 * Port for distributed lease management: acquire, release, and query.
 *
 * DAG-001 REMOVED `renew`. It had existed with zero production callers — the audit named it under the
 * theme that a declared seam must be reachable from the construction path the product actually uses.
 * A heartbeat is the design that would need it, and this is not that design: a task's lease expiry is
 * derived from the time the task is ALLOWED to run (`WorkerLoopService.leaseUntilIso`), which is known
 * up front and needs no renewal. Reintroduce it together with its caller if a heartbeat design
 * arrives — "we might need it later" is the argument that produced the ghost lease columns this same
 * task had to fix.
 */
export interface ILeasePort {
  acquire(
    leaseKey: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<ILeaseRecord | undefined>;
  release(leaseKey: string, ownerId: string): Promise<void>;
  get(leaseKey: string): Promise<ILeaseRecord | undefined>;
}

/** Primary persistence port for DAG definitions, runs, and task runs. */
export interface IStoragePort {
  /** Atomically arbitrate execution mutations against current run and task state. */
  commitExecution(dagRunId: string, mutation: TExecutionCommit): Promise<IExecutionCommitResult>;
  saveDefinition(definition: IDagDefinition): Promise<void>;
  getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined>;
  listDefinitions(): Promise<IDagDefinition[]>;
  listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]>;
  getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined>;

  createDagRun(dagRun: IDagRun): Promise<void>;
  getDagRun(dagRunId: string): Promise<IDagRun | undefined>;
  listDagRuns(): Promise<IDagRun[]>;
  getDagRunByRunKey(runKey: string): Promise<IDagRun | undefined>;
  updateDagRunStatus(dagRunId: string, status: TDagRunStatus, endedAt?: string): Promise<void>;
  deleteDagRun(dagRunId: string): Promise<void>;

  createTaskRun(taskRun: ITaskRun): Promise<void>;
  getTaskRun(taskRunId: string): Promise<ITaskRun | undefined>;
  listTaskRunsByDagRunId(dagRunId: string): Promise<ITaskRun[]>;
  deleteTaskRunsByDagRunId(dagRunId: string): Promise<void>;
  updateTaskRunStatus(taskRunId: string, status: TTaskRunStatus, error?: IDagError): Promise<void>;
  saveTaskRunSnapshots(
    taskRunId: string,
    inputSnapshot?: string,
    outputSnapshot?: string,
    estimatedCredits?: number,
    totalCredits?: number,
  ): Promise<void>;
  incrementTaskAttempt(taskRunId: string): Promise<void>;
  deleteDefinition(dagId: string, version: number): Promise<void>;

  /**
   * Record which worker holds a task and until when — or clear it. DAG-001.
   *
   * `ITaskRun.leaseOwner` / `leaseUntil` existed on the domain type and in the sqlite INSERT, and
   * NOTHING ever wrote them: ghost columns. Without them there is no way to tell an abandoned task
   * from one a live worker is executing, so `running` was a state nothing could ever leave.
   *
   * Pass `undefined` for both to clear. Recovery clears stale leases, and a worker clears the lease
   * when it settles a message for a cancelled run. A normally completed task leaves its lease behind:
   * the task is no longer `running`, so no sweeper looks at it.
   */
  setTaskRunLease(taskRunId: string, leaseOwner?: string, leaseUntil?: string): Promise<void>;

  /**
   * Tasks left `running` by a worker that never came back — those whose recorded `leaseUntil` is at
   * or before `asOfIso`, plus any `running` task with no lease recorded at all. DAG-001.
   *
   * The port had no query that could FIND a stale task, which is why no adapter could add recovery
   * however it tried. A queue that redelivers surfaces the message again; one that does not needs
   * this, and a task orphaned before its lease was written needs it either way.
   */
  listStaleRunningTaskRuns(asOfIso: string): Promise<ITaskRun[]>;
}

/** Input bundle for executing a single task within a DAG run. */
export interface ITaskExecutionInput {
  /** Trusted host operation capability; never decoded from workflow data. */
  regexReplaceOperation?: IRegexReplaceOperation;
  /** Shared live root snapshot authority, never sourced from serialized data. */
  snapshotBudget?: ITaskSnapshotBudget;
  /** Shared in-process root credit authority, never sourced from workflow data. */
  rootCreditBudget?: IRootCreditBudget;
  /** Durable per-run admission supplied by the worker for this attempt. */
  reserveCredits?: (
    estimatedCredits: number,
  ) => Promise<import('../types/result.js').TResult<void, IDagError>>;
  /** Trusted host limits; never deserialized from workflow configuration. */
  byteLimits?: IDagExecutionByteLimits;
  /** Trusted in-process attempt cancellation; never supplied by serialized node or queue data. */
  signal?: AbortSignal;
  /** Trusted canonical absolute directory selected by the product composition root. */
  executionRoot: string;
  dagId: string;
  dagRunId: string;
  taskRunId: string;
  nodeId: string;
  attempt: number;
  executionPath: string[];
  input: TPortPayload;
  nodeDefinition?: IDagNode;
  costPolicy?: ICostPolicy;
  currentTotalCredits?: number;
  /** Runtime-owned asset base URL forwarded to node execution context. */
  runtimeBaseUrl?: string;
}

/** Successful task execution outcome with output payload and optional costs. */
export interface ITaskExecutionSuccess {
  ok: true;
  output: TPortPayload;
  estimatedCredits?: number;
  totalCredits?: number;
}

/** Failed task execution outcome with structured error. */
export interface ITaskExecutionFailure {
  ok: false;
  error: IDagError;
}

/** Discriminated union of task execution outcomes. */
export type TTaskExecutionResult = ITaskExecutionSuccess | ITaskExecutionFailure;

/** Port for executing a single task given its execution input. */
export interface ITaskExecutorPort {
  /** Isolated executors join termination of this exact attempt before timeout/cancel is returned. */
  stopAndWait?(input: ITaskExecutionInput): Promise<void>;
  execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult>;
}

/** Port for obtaining the current time — injectable for testing. */
export interface IClockPort {
  nowIso(): string;
  nowEpochMs(): number;
}
