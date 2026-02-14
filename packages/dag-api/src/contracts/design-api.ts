import type { IDagDefinition, IDagError } from '@robota-sdk/dag-core';
import type { IApiFailure, IApiSuccess, TApiResponse } from './common-api.js';

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

export interface ICreateDefinitionRequest {
    definition: IDagDefinition;
    correlationId?: string;
}

export interface IUpdateDraftRequest {
    dagId: string;
    version: number;
    definition: IDagDefinition;
    correlationId?: string;
}

export interface IValidateDefinitionRequest {
    dagId: string;
    version: number;
    correlationId?: string;
}

export interface IPublishDefinitionRequest {
    dagId: string;
    version: number;
    correlationId?: string;
}

export type IDesignApiSuccess<TData> = IApiSuccess<TData>;
export type IDesignApiFailure = IApiFailure<IProblemDetails>;
export type TDesignApiResponse<TData> = TApiResponse<TData, IProblemDetails>;

export interface IDefinitionValidationResult {
    definition: IDagDefinition;
    valid: true;
}

export function toProblemDetails(
    error: IDagError,
    instance: string,
    correlationId?: string
): IProblemDetails {
    const status = error.category === 'state_transition'
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
        type: `https://robota.dev/problems/dag/${error.category}`,
        title,
        status,
        detail: error.message,
        instance,
        code: error.code,
        retryable: error.retryable,
        correlationId
    };
}
