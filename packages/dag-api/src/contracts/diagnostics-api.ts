import type { IDagRun, ITaskRun, TPortPayload } from '@robota-sdk/dag-core';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';

export interface IAnalyzeFailureRequest {
    dagRunId: string;
    correlationId?: string;
}

export interface IRerunRequest {
    sourceDagRunId: string;
    rerunKey: string;
    input: TPortPayload;
    correlationId?: string;
}

export interface IReinjectDeadLetterRequest {
    workerId: string;
    visibilityTimeoutMs: number;
    correlationId?: string;
}

export interface IFailureCodeCount {
    code: string;
    count: number;
}

export interface IFailureAnalysis {
    dagRun: IDagRun;
    failedTaskRuns: ITaskRun[];
    failureCodeCounts: IFailureCodeCount[];
}

export type TDiagnosticsApiResponse<TData> = TApiResponse<TData, IProblemDetails>;
