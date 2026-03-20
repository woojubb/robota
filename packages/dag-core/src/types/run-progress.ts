import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';

/** Discriminant for run progress event types covering execution and task phases. */
export type TRunProgressEventType =
    | 'execution.started'
    | 'execution.completed'
    | 'execution.failed'
    | 'task.started'
    | 'task.completed'
    | 'task.failed';

/** Common fields for all run progress events. */
export interface IRunProgressEventBase {
    dagRunId: string;
    eventType: TRunProgressEventType;
    occurredAt: string;
}

/** Emitted when a DAG execution begins. */
export interface IExecutionStartedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.started';
    dagId: string;
    version: number;
}

/** Emitted when a DAG execution completes successfully. */
export interface IExecutionCompletedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.completed';
}

/** Emitted when a DAG execution fails. */
export interface IExecutionFailedProgressEvent extends IRunProgressEventBase {
    eventType: 'execution.failed';
    error: IDagError;
}

/** Emitted when a task within a DAG run begins execution. */
export interface ITaskStartedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.started';
    taskRunId: string;
    nodeId: string;
    input?: TPortPayload;
    output?: TPortPayload;
}

/** Emitted when a task within a DAG run completes successfully. */
export interface ITaskCompletedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.completed';
    taskRunId: string;
    nodeId: string;
    input?: TPortPayload;
    output?: TPortPayload;
}

/** Emitted when a task within a DAG run fails. */
export interface ITaskFailedProgressEvent extends IRunProgressEventBase {
    eventType: 'task.failed';
    taskRunId: string;
    nodeId: string;
    error: IDagError;
    input?: TPortPayload;
    output?: TPortPayload;
}

/** Union of all run progress event types. */
export type TRunProgressEvent =
    | IExecutionStartedProgressEvent
    | IExecutionCompletedProgressEvent
    | IExecutionFailedProgressEvent
    | ITaskStartedProgressEvent
    | ITaskCompletedProgressEvent
    | ITaskFailedProgressEvent;

/** Port for publishing run progress events to external observers. */
export interface IRunProgressEventReporter {
    publish: (event: TRunProgressEvent) => void;
}
