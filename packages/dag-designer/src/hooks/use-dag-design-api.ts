import { useMemo } from 'react';
import type {
    IDagDefinition,
    INodeManifest,
    TResult,
    TPortPayload,
    TRunProgressEvent
} from '@robota-sdk/dag-core';
import {
    DesignerApiClient
} from '../client/designer-api-client.js';
import type {
    IDefinitionListItem,
    IDesignerApiClient,
    IRunResult,
    IProblemDetails
} from '../contracts/designer-api.js';

export interface IUseDagDesignApiOptions {
    baseUrl?: string;
    client?: IDesignerApiClient;
}

export interface IUseDagDesignApi {
    createDraft: (input: {
        definition: IDagDefinition;
        correlationId?: string;
    }) => Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    updateDraft: (input: {
        dagId: string;
        version: number;
        definition: IDagDefinition;
        correlationId?: string;
    }) => Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    validate: (input: {
        dagId: string;
        version: number;
        correlationId?: string;
    }) => Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    publish: (input: {
        dagId: string;
        version: number;
        correlationId?: string;
    }) => Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    load: (input: {
        dagId: string;
        version?: number;
        correlationId?: string;
    }) => Promise<TResult<IDagDefinition, IProblemDetails[]>>;
    list: (input?: {
        dagId?: string;
        correlationId?: string;
    }) => Promise<TResult<IDefinitionListItem[], IProblemDetails[]>>;
    listNodeCatalog: () => Promise<TResult<INodeManifest[], IProblemDetails[]>>;
    createRun: (input: {
        definition: IDagDefinition;
        input?: TPortPayload;
        correlationId?: string;
    }) => Promise<TResult<{ dagRunId: string }, IProblemDetails[]>>;
    startRun: (input: {
        dagRunId: string;
        correlationId?: string;
    }) => Promise<TResult<{ dagRunId: string }, IProblemDetails[]>>;
    getRunResult: (input: {
        dagRunId: string;
        correlationId?: string;
    }) => Promise<TResult<IRunResult, IProblemDetails[]>>;
    subscribeRunProgress: (input: {
        dagRunId: string;
        onEvent: (event: TRunProgressEvent) => void;
        onError?: (error: Error) => void;
    }) => () => void;
}

export function useDagDesignApi(options: IUseDagDesignApiOptions): IUseDagDesignApi {
    const client = useMemo<IDesignerApiClient>(() => {
        if (options.client) {
            return options.client;
        }
        if (!options.baseUrl) {
            throw new Error('useDagDesignApi requires either options.client or options.baseUrl');
        }
        return new DesignerApiClient({ baseUrl: options.baseUrl });
    }, [options.baseUrl, options.client]);

    return useMemo<IUseDagDesignApi>(() => ({
        createDraft: async (input) => client.createDefinition({
            definition: input.definition,
            correlationId: input.correlationId
        }),
        updateDraft: async (input) => client.updateDraft({
            dagId: input.dagId,
            version: input.version,
            definition: input.definition,
            correlationId: input.correlationId
        }),
        validate: async (input) => client.validateDefinition({
            dagId: input.dagId,
            version: input.version,
            correlationId: input.correlationId
        }),
        publish: async (input) => client.publishDefinition({
            dagId: input.dagId,
            version: input.version,
            correlationId: input.correlationId
        }),
        load: async (input) => client.getDefinition({
            dagId: input.dagId,
            version: input.version,
            correlationId: input.correlationId
        }),
        list: async (input) => client.listDefinitions({
            dagId: input?.dagId,
            correlationId: input?.correlationId
        }),
        listNodeCatalog: async () => client.listNodeCatalog(),
        createRun: async (input) => client.createRun({
            definition: input.definition,
            input: input.input,
            correlationId: input.correlationId
        }),
        startRun: async (input) => client.startRun({
            dagRunId: input.dagRunId,
            correlationId: input.correlationId
        }),
        getRunResult: async (input) => client.getRunResult({
            dagRunId: input.dagRunId,
            correlationId: input.correlationId
        }),
        subscribeRunProgress: (input) => client.subscribeRunProgress(input)
    }), [client]);
}
