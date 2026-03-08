import type {
    IDagDefinition,
    INodeManifest,
    TResult,
    TPortPayload,
    TRunProgressEvent
} from '@robota-sdk/dag-core';
import type { IProblemDetails, IDefinitionListItem } from '@robota-sdk/dag-api';
import type { IRunNodeTrace, IRunResult } from '@robota-sdk/dag-server-core';

// Re-export SSOT types for downstream consumers
export type { IProblemDetails, IDefinitionListItem };
export type { IRunNodeTrace, IRunResult };

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

export interface IDesignerCreateRunInput {
    definition: IDagDefinition;
    input?: TPortPayload;
    correlationId?: string;
}

export interface IGetRunResultInput {
    dagRunId: string;
    correlationId?: string;
}

export interface IDesignerStartRunInput {
    dagRunId: string;
    correlationId?: string;
}

export interface IDesignerApiClient {
    createDefinition(input: ICreateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    updateDraft(input: IUpdateDraftInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    validateDefinition(input: IValidateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    publishDefinition(input: IPublishDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    getDefinition(input: IGetDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    listDefinitions(input?: IListDefinitionsInput): Promise<TResult<IDefinitionListItem[], IProblemDetails[]>>;
    listNodeCatalog(): Promise<TResult<INodeManifest[], IProblemDetails[]>>;
    createRun(input: IDesignerCreateRunInput): Promise<TResult<{ dagRunId: string }, IProblemDetails[]>>;
    startRun(input: IDesignerStartRunInput): Promise<TResult<{ dagRunId: string }, IProblemDetails[]>>;
    getRunResult(input: IGetRunResultInput): Promise<TResult<IRunResult, IProblemDetails[]>>;
    subscribeRunProgress: (input: {
        dagRunId: string;
        onEvent: (event: TRunProgressEvent) => void;
        onError?: (error: Error) => void;
        maxReconnectAttempts?: number;
        initialReconnectDelayMs?: number;
    }) => () => void;
}

export interface IDesignerApiClientConfig {
    baseUrl: string;
}
