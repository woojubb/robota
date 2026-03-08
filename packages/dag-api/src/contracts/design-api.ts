import type { IDagDefinition, IDagError } from '@robota-sdk/dag-core';
import type { IApiFailure, IApiSuccess, TApiResponse } from './common-api.js';

/** RFC 7807-style problem details for DAG API error responses. */
export interface IProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    retryable: boolean;
    correlationId?: string;
}

/** Request payload for creating a new DAG definition draft. */
export interface ICreateDefinitionRequest {
    definition: IDagDefinition;
    correlationId?: string;
}

/** Request payload for updating an existing DAG definition draft. */
export interface IUpdateDraftRequest {
    dagId: string;
    version: number;
    definition: IDagDefinition;
    correlationId?: string;
}

/** Request payload for validating a DAG definition. */
export interface IValidateDefinitionRequest {
    dagId: string;
    version: number;
    correlationId?: string;
}

/** Request payload for publishing a validated DAG definition. */
export interface IPublishDefinitionRequest {
    dagId: string;
    version: number;
    correlationId?: string;
}

/** Request payload for retrieving a DAG definition by ID and optional version. */
export interface IGetDefinitionRequest {
    dagId: string;
    version?: number;
    correlationId?: string;
}

/** Request payload for listing DAG definitions, optionally filtered by dagId. */
export interface IListDefinitionsRequest {
    dagId?: string;
    correlationId?: string;
}

/** Summary item for a DAG definition in list responses. */
export interface IDefinitionListItem {
    dagId: string;
    latestVersion: number;
    statuses: IDagDefinition['status'][];
}

/** Request payload for listing available node types from the catalog. */
export interface IListNodeCatalogRequest {
    correlationId?: string;
}

/** Design API failure response with problem details. */
export type TDesignApiFailure = IApiFailure<IProblemDetails>;
/** Design API response type parameterized by the success data type. */
export type TDesignApiResponse<TData> = TApiResponse<TData, IProblemDetails>;

/** Result of a successful DAG definition validation. */
export interface IDefinitionValidationResult {
    definition: IDagDefinition;
    valid: true;
}

/**
 * Converts a DAG error into an RFC 7807-style problem details object.
 * @param error - The DAG domain error to convert.
 * @param instance - The request URI that triggered the error.
 * @param correlationId - Optional correlation ID for request tracing.
 * @returns Problem details with appropriate HTTP status and category-based title.
 */
export function toProblemDetails(
    error: IDagError,
    instance: string,
    correlationId?: string
): IProblemDetails {
    const status = error.category === 'state_transition'
        ? 409
        : error.category === 'lease'
            ? 409
            : error.category === 'dispatch'
                ? 503
                : error.category === 'task_execution'
                    ? 500
                    : 400;

    const title = error.category === 'validation'
        ? 'Validation failed'
        : error.category === 'state_transition'
            ? 'Invalid state transition'
            : error.category === 'lease'
                ? 'Lease contract violation'
                : error.category === 'dispatch'
                    ? 'Dispatch unavailable'
                    : 'Task execution failed';

    return {
        type: `urn:robota:problems:dag:${error.category}`,
        title,
        status,
        detail: error.message,
        instance,
        code: error.code,
        retryable: error.retryable,
        correlationId
    };
}
