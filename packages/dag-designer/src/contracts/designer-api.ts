import type { IDagDefinition, TResult } from '@robota-sdk/dag-core';

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

export interface ICreateDefinitionInput {
    definition: IDagDefinition;
    correlationId?: string;
}

export interface IUpdateDraftInput {
    dagId: string;
    version: number;
    definition: IDagDefinition;
    correlationId?: string;
}

export interface IValidateDefinitionInput {
    dagId: string;
    version: number;
    correlationId?: string;
}

export interface IPublishDefinitionInput {
    dagId: string;
    version: number;
    correlationId?: string;
}

export interface IGetDefinitionInput {
    dagId: string;
    version?: number;
    correlationId?: string;
}

export interface IListDefinitionsInput {
    dagId?: string;
    correlationId?: string;
}

export interface IDefinitionListItem {
    dagId: string;
    latestVersion: number;
    statuses: IDagDefinition['status'][];
}

export interface IDesignerApiClient {
    createDefinition(input: ICreateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    updateDraft(input: IUpdateDraftInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    validateDefinition(input: IValidateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    publishDefinition(input: IPublishDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    getDefinition(input: IGetDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    listDefinitions(input?: IListDefinitionsInput): Promise<TResult<IDefinitionListItem[], IProblemDetails[]>>;
}

export interface IDesignerApiClientConfig {
    baseUrl: string;
}
