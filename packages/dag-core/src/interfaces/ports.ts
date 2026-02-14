import type {
    IDagDefinition,
    IDagRun,
    ITaskRun,
    TDagRunStatus,
    TTaskRunStatus
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';

export type TPortPrimitive = string | number | boolean | null;
export type TPortPayload = Record<string, TPortPrimitive>;

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
    getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined>;

    createDagRun(dagRun: IDagRun): Promise<void>;
    getDagRun(dagRunId: string): Promise<IDagRun | undefined>;
    getDagRunByRunKey(runKey: string): Promise<IDagRun | undefined>;
    updateDagRunStatus(dagRunId: string, status: TDagRunStatus, endedAt?: string): Promise<void>;

    createTaskRun(taskRun: ITaskRun): Promise<void>;
    getTaskRun(taskRunId: string): Promise<ITaskRun | undefined>;
    listTaskRunsByDagRunId(dagRunId: string): Promise<ITaskRun[]>;
    updateTaskRunStatus(taskRunId: string, status: TTaskRunStatus, error?: IDagError): Promise<void>;
    incrementTaskAttempt(taskRunId: string): Promise<void>;
}

export interface ITaskExecutionInput {
    dagId: string;
    dagRunId: string;
    taskRunId: string;
    nodeId: string;
    attempt: number;
    executionPath: string[];
    input: TPortPayload;
}

export interface ITaskExecutionSuccess {
    ok: true;
    output: TPortPayload;
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
