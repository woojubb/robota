import type { ILineageProjection, IRunProjection } from '@robota-sdk/dag-projection';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';

/** Request payload for querying a run projection. */
export interface IQueryRunProjectionRequest {
    dagRunId: string;
    correlationId?: string;
}

/** Request payload for querying a lineage projection. */
export interface IQueryLineageProjectionRequest {
    dagRunId: string;
    correlationId?: string;
}

/** Combined run and lineage projection data for the observability dashboard. */
export interface IObservabilityDashboardData {
    runProjection: IRunProjection;
    lineageProjection: ILineageProjection;
}

/** Observability API response type parameterized by the success data type. */
export type TObservabilityApiResponse<TData> = TApiResponse<TData, IProblemDetails>;
