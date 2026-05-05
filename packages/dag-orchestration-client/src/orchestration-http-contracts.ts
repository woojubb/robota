import type {
  IDagDefinition,
  IPartialRunRequest,
  IRunDraft,
  ISaveRunDraftInput,
  TNodeConfigRecord,
  TPortPayload,
} from '@robota-sdk/dag-core';

export type TDagOrchestrationPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | object
  | readonly object[];

export interface IDagOrchestrationJsonObject {
  readonly [key: string]: TDagOrchestrationPayloadValue;
}

export interface IOrchestrationProblemDetails extends IDagOrchestrationJsonObject {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code?: string;
  readonly correlationId?: string;
  readonly retryable?: boolean;
}

export type TDagOrchestrationFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface IDagOrchestrationHttpClientConfig {
  readonly baseUrl: string;
  readonly fetch: TDagOrchestrationFetch;
}

export interface IDagOrchestrationHttpPayload extends IDagOrchestrationJsonObject {
  readonly ok?: boolean;
  readonly status?: number;
  readonly errors?: readonly IOrchestrationProblemDetails[];
}

export interface IDagOrchestrationHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly payload: IDagOrchestrationHttpPayload;
}

export interface IDagOrchestrationListDefinitionsInput {
  readonly dagId?: string;
}

export interface IDagOrchestrationUpdateDraftInput {
  readonly dagId: string;
  readonly version: number;
  readonly definition: IDagDefinition;
}

export interface IDagOrchestrationCreateRunInput {
  readonly definition: IDagDefinition;
  readonly input?: TPortPayload;
  readonly partialRun?: IPartialRunRequest;
}

export type TDagOrchestrationCreateRunDraftRequest = ISaveRunDraftInput;

export type TDagOrchestrationReplaceRunDraftRequest = Omit<ISaveRunDraftInput, 'draftId'>;

export interface IDagOrchestrationOverwriteRunDraftNodeResultRequest {
  readonly input?: TPortPayload;
  readonly output: TPortPayload;
}

export interface IDagOrchestrationRunDraftData extends IDagOrchestrationJsonObject {
  readonly draft: IRunDraft;
}

export interface IDagOrchestrationRunDraftSuccessPayload extends IDagOrchestrationHttpPayload {
  readonly ok: true;
  readonly status: number;
  readonly data: IDagOrchestrationRunDraftData;
}

export interface IDagOrchestrationWorkflowOverrideMap {
  readonly [nodeId: string]: TNodeConfigRecord;
}

export interface IDagOrchestrationPublishedWorkflowRunRequest {
  readonly input?: TPortPayload;
  readonly overrides?: IDagOrchestrationWorkflowOverrideMap;
}

export interface IDagOrchestrationPublishedWorkflowRunData extends IDagOrchestrationJsonObject {
  readonly dagRunId: string;
  readonly preparationId: string;
  readonly dagId: string;
  readonly version: number;
}

export interface IDagOrchestrationPublishedWorkflowRunSuccessPayload
  extends IDagOrchestrationHttpPayload {
  readonly ok: true;
  readonly status: number;
  readonly data: IDagOrchestrationPublishedWorkflowRunData;
}

export interface IDagOrchestrationHttpClient {
  listDefinitions(
    input?: IDagOrchestrationListDefinitionsInput,
  ): Promise<IDagOrchestrationHttpResponse>;
  getDefinition(dagId: string, version?: number): Promise<IDagOrchestrationHttpResponse>;
  createDefinition(definition: IDagDefinition): Promise<IDagOrchestrationHttpResponse>;
  updateDraft(input: IDagOrchestrationUpdateDraftInput): Promise<IDagOrchestrationHttpResponse>;
  validateDefinition(dagId: string, version: number): Promise<IDagOrchestrationHttpResponse>;
  publishDefinition(dagId: string, version?: number): Promise<IDagOrchestrationHttpResponse>;
  listNodes(): Promise<IDagOrchestrationHttpResponse>;
  createRun(input: IDagOrchestrationCreateRunInput): Promise<IDagOrchestrationHttpResponse>;
  startRun(preparationId: string): Promise<IDagOrchestrationHttpResponse>;
  getRunStatus(dagRunId: string): Promise<IDagOrchestrationHttpResponse>;
  getRunResult(dagRunId: string): Promise<IDagOrchestrationHttpResponse>;
  createRunDraft(
    input: TDagOrchestrationCreateRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse>;
  getRunDraft(draftId: string): Promise<IDagOrchestrationHttpResponse>;
  replaceRunDraft(
    draftId: string,
    input: TDagOrchestrationReplaceRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse>;
  resetRunDraftNodeResult(draftId: string, nodeId: string): Promise<IDagOrchestrationHttpResponse>;
  overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  ): Promise<IDagOrchestrationHttpResponse>;
  startPublishedWorkflowRun(
    dagId: string,
    input?: IDagOrchestrationPublishedWorkflowRunRequest,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse>;
}
