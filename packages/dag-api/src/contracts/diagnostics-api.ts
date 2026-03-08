import type { IDagRun, ITaskRun, TPortPayload } from '@robota-sdk/dag-core';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';

/** Request payload for analyzing failures in a DAG run. */
export interface IAnalyzeFailureRequest {
    dagRunId: string;
    correlationId?: string;
}

/** Request payload for triggering a rerun of a previously executed DAG run. */
export interface IRerunRequest {
    sourceDagRunId: string;
    rerunKey: string;
    input: TPortPayload;
    correlationId?: string;
}

/** Request payload for reinjecting a dead letter queue item back into the main queue. */
export interface IReinjectDeadLetterRequest {
    workerId: string;
    visibilityTimeoutMs: number;
    correlationId?: string;
}

/** Count of task failures grouped by error code. */
export interface IFailureCodeCount {
    code: string;
    count: number;
}

/** Analysis result containing the DAG run, failed tasks, and failure code distribution. */
export interface IFailureAnalysis {
    dagRun: IDagRun;
    failedTaskRuns: ITaskRun[];
    failureCodeCounts: IFailureCodeCount[];
}

/** Diagnostics API response type parameterized by the success data type. */
export type TDiagnosticsApiResponse<TData> = TApiResponse<TData, IProblemDetails>;
