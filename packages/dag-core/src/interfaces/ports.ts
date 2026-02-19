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

export type TPortPrimitive = string | number | boolean | null;
export type TPortBinaryKind = 'image' | 'video' | 'audio' | 'file';
export type TBinaryReferenceType = 'asset' | 'uri';

export interface IPortBinaryValue {
    kind: TPortBinaryKind;
    mimeType: string;
    uri: string;
    referenceType?: TBinaryReferenceType;
    assetId?: string;
    sizeBytes?: number;
}

export type TPortObjectValue = Record<string, TPortPrimitive>;
export type TPortArrayValue = TPortValue[];

export type TPortValue =
    | TPortPrimitive
    | IPortBinaryValue
    | TPortArrayValue
    | TPortObjectValue;

export type TPortPayload = Record<string, TPortValue>;

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

export interface IQueuePort {
    enqueue(message: IQueueMessage): Promise<void>;
    dequeue(workerId: string, visibilityTimeoutMs: number): Promise<IQueueMessage | undefined>;
    ack(messageId: string): Promise<void>;
    nack(messageId: string): Promise<void>;
}

export interface ILeaseRecord {
    leaseKey: string;
    ownerId: string;
    acquiredAt: string;
    leaseUntil: string;
}

export interface ILeasePort {
    acquire(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined>;
    renew(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined>;
    release(leaseKey: string, ownerId: string): Promise<void>;
    get(leaseKey: string): Promise<ILeaseRecord | undefined>;
}

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
        estimatedCostUsd?: number,
        totalCostUsd?: number
    ): Promise<void>;
    incrementTaskAttempt(taskRunId: string): Promise<void>;
    deleteDefinition(dagId: string, version: number): Promise<void>;
}

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
    currentTotalCostUsd?: number;
}

export interface ITaskExecutionSuccess {
    ok: true;
    output: TPortPayload;
    estimatedCostUsd?: number;
    totalCostUsd?: number;
}

export interface ITaskExecutionFailure {
    ok: false;
    error: IDagError;
}

export type TTaskExecutionResult = ITaskExecutionSuccess | ITaskExecutionFailure;

export interface ITaskExecutorPort {
    execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult>;
}

export interface IClockPort {
    nowIso(): string;
    nowEpochMs(): number;
}
