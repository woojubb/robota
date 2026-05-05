import { useMemo } from 'react';
import type {
  IDagDefinition,
  IPartialRunRequest,
  IRunDraft,
  TObjectInfo,
  TResult,
  TPortPayload,
  TRunProgressEvent,
  IRunResult,
} from '@robota-sdk/dag-core';
import type { IProblemDetails, IDefinitionListItem } from '@robota-sdk/dag-api';
import { DesignerApiClient } from '../client/designer-api-client.js';
import type { IDesignerApiClient } from '../contracts/designer-api.js';

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
  listObjectInfo: () => Promise<TResult<TObjectInfo, IProblemDetails[]>>;
  createRun: (input: {
    definition: IDagDefinition;
    input?: TPortPayload;
    partialRun?: IPartialRunRequest;
    correlationId?: string;
  }) => Promise<TResult<{ preparationId: string }, IProblemDetails[]>>;
  startRun: (input: {
    preparationId: string;
    correlationId?: string;
  }) => Promise<TResult<{ dagRunId: string }, IProblemDetails[]>>;
  getRunResult: (input: {
    dagRunId: string;
    correlationId?: string;
  }) => Promise<TResult<IRunResult, IProblemDetails[]>>;
  saveRunDraft: (input: {
    draftId?: string;
    definition: IDagDefinition;
    input?: TPortPayload;
    nodeStateMap?: IRunDraft['nodeStateMap'];
    runResult?: IRunDraft['runResult'];
    correlationId?: string;
  }) => Promise<TResult<IRunDraft, IProblemDetails[]>>;
  getRunDraft: (input: {
    draftId: string;
    correlationId?: string;
  }) => Promise<TResult<IRunDraft, IProblemDetails[]>>;
  resetRunDraftNodeResult: (input: {
    draftId: string;
    nodeId: string;
    correlationId?: string;
  }) => Promise<TResult<IRunDraft, IProblemDetails[]>>;
  overwriteRunDraftNodeResult: (input: {
    draftId: string;
    nodeId: string;
    input?: TPortPayload;
    output: TPortPayload;
    correlationId?: string;
  }) => Promise<TResult<IRunDraft, IProblemDetails[]>>;
  subscribeRunProgress: (input: {
    preparationId: string;
    onEvent: (event: TRunProgressEvent) => void;
    onError?: (error: Error) => void;
    maxReconnectAttempts?: number;
    initialReconnectDelayMs?: number;
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

  return useMemo<IUseDagDesignApi>(
    () => ({
      createDraft: async (input) =>
        client.createDefinition({
          definition: input.definition,
          correlationId: input.correlationId,
        }),
      updateDraft: async (input) =>
        client.updateDraft({
          dagId: input.dagId,
          version: input.version,
          definition: input.definition,
          correlationId: input.correlationId,
        }),
      validate: async (input) =>
        client.validateDefinition({
          dagId: input.dagId,
          version: input.version,
          correlationId: input.correlationId,
        }),
      publish: async (input) =>
        client.publishDefinition({
          dagId: input.dagId,
          version: input.version,
          correlationId: input.correlationId,
        }),
      load: async (input) =>
        client.getDefinition({
          dagId: input.dagId,
          version: input.version,
          correlationId: input.correlationId,
        }),
      list: async (input) =>
        client.listDefinitions({
          dagId: input?.dagId,
          correlationId: input?.correlationId,
        }),
      listObjectInfo: async () => client.listObjectInfo(),
      createRun: async (input) =>
        client.createRun({
          definition: input.definition,
          input: input.input,
          partialRun: input.partialRun,
          correlationId: input.correlationId,
        }),
      startRun: async (input) =>
        client.startRun({
          preparationId: input.preparationId,
          correlationId: input.correlationId,
        }),
      getRunResult: async (input) =>
        client.getRunResult({
          dagRunId: input.dagRunId,
          correlationId: input.correlationId,
        }),
      saveRunDraft: async (input) =>
        client.saveRunDraft({
          draftId: input.draftId,
          definition: input.definition,
          input: input.input,
          nodeStateMap: input.nodeStateMap,
          runResult: input.runResult,
          correlationId: input.correlationId,
        }),
      getRunDraft: async (input) =>
        client.getRunDraft({
          draftId: input.draftId,
          correlationId: input.correlationId,
        }),
      resetRunDraftNodeResult: async (input) =>
        client.resetRunDraftNodeResult({
          draftId: input.draftId,
          nodeId: input.nodeId,
          correlationId: input.correlationId,
        }),
      overwriteRunDraftNodeResult: async (input) =>
        client.overwriteRunDraftNodeResult({
          draftId: input.draftId,
          nodeId: input.nodeId,
          input: input.input,
          output: input.output,
          correlationId: input.correlationId,
        }),
      subscribeRunProgress: (input) => client.subscribeRunProgress(input),
    }),
    [client],
  );
}
