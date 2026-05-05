import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';
import type { TDagCliFetch, TDagCliServerResponse } from './types.js';

interface IDagOrchestrationApiClientConfig {
  readonly baseUrl: string;
  readonly fetch: TDagCliFetch;
}

interface IDagCliApiResponse {
  readonly ok: boolean;
  readonly payload: TDagCliServerResponse;
}

type THttpMethod = 'GET' | 'POST';

export class DagOrchestrationApiClient {
  private readonly baseUrl: string;
  private readonly fetch: TDagCliFetch;

  public constructor(config: IDagOrchestrationApiClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.fetch = config.fetch;
  }

  public async listDefinitions(): Promise<IDagCliApiResponse> {
    return this.request('/v1/dag/definitions', 'GET');
  }

  public async getDefinition(dagId: string, version?: number): Promise<IDagCliApiResponse> {
    const versionQuery = typeof version === 'number' ? `?version=${version}` : '';
    return this.request(`/v1/dag/definitions/${encodeURIComponent(dagId)}${versionQuery}`, 'GET');
  }

  public async createDefinition(definition: IDagDefinition): Promise<IDagCliApiResponse> {
    return this.request('/v1/dag/definitions', 'POST', { definition });
  }

  public async publishDefinition(dagId: string, version?: number): Promise<IDagCliApiResponse> {
    return this.request(`/v1/dag/definitions/${encodeURIComponent(dagId)}/publish`, 'POST', {
      version,
    });
  }

  public async listNodes(): Promise<IDagCliApiResponse> {
    return this.request('/v1/dag/nodes', 'GET');
  }

  public async createRun(input: {
    readonly definition: IDagDefinition;
    readonly input?: TPortPayload;
    readonly partialRun?: IPartialRunRequest;
  }): Promise<IDagCliApiResponse> {
    return this.request('/v1/dag/runs', 'POST', input);
  }

  public async startRun(preparationId: string): Promise<IDagCliApiResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(preparationId)}/start`, 'POST', {});
  }

  public async getRunStatus(dagRunId: string): Promise<IDagCliApiResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(dagRunId)}`, 'GET');
  }

  public async getRunResult(dagRunId: string): Promise<IDagCliApiResponse> {
    return this.request(`/v1/dag/runs/${encodeURIComponent(dagRunId)}/result`, 'GET');
  }

  private async request(
    path: string,
    method: THttpMethod,
    body?: object,
  ): Promise<IDagCliApiResponse> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as TDagCliServerResponse;
    return { ok: response.ok && payload.ok !== false, payload };
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}
