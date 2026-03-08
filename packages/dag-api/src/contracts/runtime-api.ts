import type { IDagError, TDagTriggerType, TPortPayload } from '@robota-sdk/dag-core';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';
import { toProblemDetails } from './design-api.js';

export interface ITriggerRunRequest {
    dagId: string;
    version?: number;
    trigger: TDagTriggerType;
    logicalDate?: string;
    input: TPortPayload;
    correlationId?: string;
}

export interface IQueryRunRequest {
    dagRunId: string;
    correlationId?: string;
}

export interface ICancelRunRequest {
    dagRunId: string;
    correlationId?: string;
}

export type TRuntimeApiResponse<TData> = TApiResponse<TData, IProblemDetails>;

export function toRuntimeProblemDetails(
    error: IDagError,
    instance: string,
    correlationId?: string
): IProblemDetails {
    return toProblemDetails(error, instance, correlationId);
}
