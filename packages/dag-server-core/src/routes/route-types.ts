import type { Response } from 'express';
import type {
    IDagDefinition,
    IStoragePort,
    TResult,
    IDagError
} from '@robota-sdk/dag-core';
import type {
    INodeCatalogService
} from '@robota-sdk/dag-api';
import type { IAssetStore, IStoredAssetMetadata } from '../asset-store-contract.js';

/**
 * Body for version-based operations (validate, publish).
 */
export interface IVersionBody {
    version: number;
}

/**
 * Body for creating a new DAG definition.
 */
export interface ICreateDefinitionBody {
    definition: IDagDefinition;
}

/**
 * Body for updating a draft definition.
 */
export interface IUpdateDraftBody {
    version: number;
    definition: IDagDefinition;
}

/**
 * Query parameters for retrieving a specific definition.
 */
export interface IGetDefinitionQuery {
    version?: string;
}

/**
 * Query parameters for listing definitions.
 */
export interface IListDefinitionsQuery {
    dagId?: string;
}

/**
 * Body for creating an asset.
 */
export interface ICreateAssetBody {
    fileName: string;
    mediaType: string;
    base64Data: string;
}

/**
 * Body for LLM completion requests.
 */
export interface ILlmCompleteBody {
    prompt: string;
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * Client interface for LLM runtime operations.
 */
export interface ILlmRuntimeClient {
    resolveModelSelection(selection: {
        provider?: string;
        model?: string;
    }): TResult<{ provider: string; model: string }, IDagError>;
    generateCompletion(request: {
        provider: string;
        model: string;
        prompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<TResult<string, IDagError>>;
}

/**
 * Route parameters for run-related endpoints.
 */
export interface IRunParams {
    dagRunId: string;
}

/**
 * Body for creating a DAG run.
 */
export interface ICreateRunBody {
    definition: IDagDefinition;
    input?: Record<string, unknown>;
}

/**
 * Query parameters for deleting definition artifacts.
 */
export interface IDeleteDefinitionArtifactsQuery {
    version?: string;
}

/**
 * API response shape for asset endpoints; includes content URI.
 * Differs from dag-core TAssetReference which disallows uri when referenceType is 'asset'.
 */
export interface IAssetApiResponse {
    referenceType: 'asset';
    assetId: string;
    mediaType: string;
    uri: string;
    name?: string;
    sizeBytes?: number;
}

/**
 * Validation error shape for asset and other request validations.
 */
export interface IAssetValidationError {
    code: string;
    detail: string;
    retryable: false;
}

/**
 * Bootstrap options for the DAG server.
 */
export interface IDagServerBootstrapOptions {
    nodeManifests: import('@robota-sdk/dag-core').INodeManifest[];
    nodeLifecycleFactory: import('@robota-sdk/dag-core').INodeLifecycleFactory;
    nodeCatalogService: INodeCatalogService;
    assetStore: IAssetStore;
    storage?: IStoragePort;
    llmCompletionClient?: ILlmRuntimeClient;
    port?: number;
    corsOrigins?: string[];
    requestBodyLimit?: string;
    defaultWorkerTimeoutMs?: number;
    apiDocsEnabled?: boolean;
    sseKeepAliveMs?: number;
}
