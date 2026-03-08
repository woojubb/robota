import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';

export type TRunProgressEventType =
    | 'execution.started'
    | 'execution.completed'
    | 'execution.failed'
    | 'task.started'
    | 'task.completed'
    | 'task.failed';

export interface IRunProgressEventBase {
    dagRunId: string;
    eventType: TRunProgressEventType;
    occurredAt: string;
}

export interface IExecutionStartedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.started';
    dagId: string;
    version: number;
}

export interface IExecutionCompletedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.completed';
}

export interface IExecutionFailedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.failed';
    error: IDagError;
}

export interface ITaskStartedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.started';
    taskRunId: string;
    nodeId: string;
    input?: TPortPayload;
    output?: TPortPayload;
}

export interface ITaskCompletedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.completed';
    taskRunId: string;
    nodeId: string;
    input?: TPortPayload;
    output?: TPortPayload;
}

export interface ITaskFailedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.failed';
    taskRunId: string;
    nodeId: string;
    error: IDagError;
    input?: TPortPayload;
    output?: TPortPayload;
}

export type TRunProgressEvent =
    | IExecutionStartedProgressEvent
    | IExecutionCompletedProgressEvent
    | IExecutionFailedProgressEvent
    | ITaskStartedProgressEvent
    | ITaskCompletedProgressEvent
    | ITaskFailedProgressEvent;

export interface IRunProgressEventReporter {
    publish: (event: TRunProgressEvent) => void;
}
