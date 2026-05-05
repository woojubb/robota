import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';

export interface IDagApiJsonObject {
  readonly [key: string]: TDagApiPayloadValue;
}

export type TDagApiPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | object
  | readonly object[];

export type TDagOrchestrationFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface IDagOrchestrationHttpClientConfig {
  readonly baseUrl: string;
  readonly fetch: TDagOrchestrationFetch;
}

export type IDagOrchestrationHttpPayload = IDagApiJsonObject & {
  readonly ok?: boolean;
  readonly status?: number;
};

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
}

type THttpMethod = 'GET' | 'POST' | 'PUT';

export class DagOrchestrationHttpClient implements IDagOrchestrationHttpClient {
  private readonly baseUrl: string;
  private readonly fetch: TDagOrchestrationFetch;

  public constructor(config: IDagOrchestrationHttpClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.fetch = config.fetch;
  }

  public async listDefinitions(
    input?: IDagOrchestrationListDefinitionsInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    const dagIdQuery =
      typeof input?.dagId === 'string' && input.dagId.trim().length > 0
        ? `?dagId=${encodeURIComponent(input.dagId)}`
        : '';
    return this.request(`/v1/dag/definitions${dagIdQuery}`, 'GET');
  }

  public async getDefinition(
    dagId: string,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const versionQuery = typeof version === 'number' ? `?version=${version}` : '';
    return this.request(`/v1/dag/definitions/${encodeURIComponent(dagId)}${versionQuery}`, 'GET');
  }

  public async createDefinition(
    definition: IDagDefinition,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/definitions', 'POST', { definition });
  }

  public async updateDraft(
    input: IDagOrchestrationUpdateDraftInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/definitions/${encodeURIComponent(input.dagId)}/draft`, 'PUT', {
      version: input.version,
      definition: input.definition,
    });
  }

  public async validateDefinition(
    dagId: string,
    version: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/definitions/${encodeURIComponent(dagId)}/validate`, 'POST', {
      version,
    });
  }

  public async publishDefinition(
    dagId: string,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/definitions/${encodeURIComponent(dagId)}/publish`, 'POST', {
      version,
    });
  }

  public async listNodes(): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/nodes', 'GET');
  }

  public async createRun(
    input: IDagOrchestrationCreateRunInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/runs', 'POST', input);
  }

  public async startRun(preparationId: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(preparationId)}/start`, 'POST', {});
  }

  public async getRunStatus(dagRunId: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(dagRunId)}`, 'GET');
  }

  public async getRunResult(dagRunId: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(dagRunId)}/result`, 'GET');
  }

  private async request(
    path: string,
    method: THttpMethod,
    body?: object,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as IDagOrchestrationHttpPayload;
    return {
      ok: response.ok && payload.ok !== false,
      status: response.status,
      payload,
    };
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}
