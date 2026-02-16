import type { ILineageProjection, IRunProjection } from '@robota-sdk/dag-projection';
import type { TApiResponse } from './common-api.js';
import type { IProblemDetails } from './design-api.js';

export interface IQueryRunProjectionRequest {
    dagRunId: string;
    correlationId?: string;
}

export interface IQueryLineageProjectionRequest {
    dagRunId: string;
    correlationId?: string;
}

export interface IObservabilityDashboardData {
    runProjection: IRunProjection;
    lineageProjection: ILineageProjection;
}

export type TObservabilityApiResponse<TData> = TApiResponse<TData, IProblemDetails>;
