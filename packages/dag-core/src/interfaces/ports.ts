import type {
    ICostPolicy,
    IDagNode,
    IDagDefinition,
    IDagRun,
    ITaskRun,
    TDagRunStatus,
    TTaskRunStatus
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
export type TPortValue =
    | TPortPrimitive
    | IPortBinaryValue
    | TPortArrayValue
    | TPortObjectValue;

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
    dequeue(workerId: string, visibilityTimeoutMs: number): Promise<IQueueMessage | undefined>;
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

/** Port for distributed lease management: acquire, renew, release, and query. */
export interface ILeasePort {
    acquire(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined>;
    renew(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined>;
    release(leaseKey: string, ownerId: string): Promise<void>;
    get(leaseKey: string): Promise<ILeaseRecord | undefined>;
}

/** Primary persistence port for DAG definitions, runs, and task runs. */
export interface IStoragePort {
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
        totalCredits?: number
    ): Promise<void>;
    incrementTaskAttempt(taskRunId: string): Promise<void>;
    deleteDefinition(dagId: string, version: number): Promise<void>;
}

/** Input bundle for executing a single task within a DAG run. */
export interface ITaskExecutionInput {
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
    execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult>;
}

/** Port for obtaining the current time — injectable for testing. */
export interface IClockPort {
    nowIso(): string;
    nowEpochMs(): number;
}
