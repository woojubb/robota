import type { IDagError, TDagTriggerType, TPortPayload } from '@robota-sdk/dag-core';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';
import { toProblemDetails } from './design-api.js';

/** Request payload for triggering a new DAG run. */
export interface ITriggerRunRequest {
    dagId: string;
    version?: number;
    trigger: TDagTriggerType;
    logicalDate?: string;
    input: TPortPayload;
    correlationId?: string;
}

/** Request payload for querying a DAG run by its identifier. */
export interface IQueryRunRequest {
    dagRunId: string;
    correlationId?: string;
}

/** Request payload for cancelling an active DAG run. */
export interface ICancelRunRequest {
    dagRunId: string;
    correlationId?: string;
}

/** Runtime API response type parameterized by the success data type. */
export type TRuntimeApiResponse<TData> = TApiResponse<TData, IProblemDetails>;

/**
 * Converts a DAG error into problem details for runtime API responses.
 * @param error - The DAG domain error to convert.
 * @param instance - The request URI that triggered the error.
 * @param correlationId - Optional correlation ID for request tracing.
 * @returns Problem details with appropriate HTTP status.
 */
export function toRuntimeProblemDetails(
    error: IDagError,
    instance: string,
    correlationId?: string
): IProblemDetails {
    return toProblemDetails(error, instance, correlationId);
}
