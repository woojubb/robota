import type { IDagDefinition } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationAssetContentDownloadInfo,
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationCostMetaPreviewRequest,
  IDagOrchestrationCostMetaValidateRequest,
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpClient,
  IDagOrchestrationHttpClientConfig,
  IDagOrchestrationHttpPayload,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationListDefinitionsInput,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationCostMetaRequest,
  TDagOrchestrationFetch,
  TDagOrchestrationReplaceRunDraftRequest,
} from './orchestration-http-contracts.js';

type THttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT';

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

  public async uploadAsset(
    input: IDagOrchestrationAssetUploadRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/assets', 'POST', input);
  }

  public async getAssetMetadata(assetId: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/assets/${encodeURIComponent(assetId)}`, 'GET');
  }

  public getAssetContentDownloadInfo(assetId: string): IDagOrchestrationAssetContentDownloadInfo {
    return {
      assetId,
      url: `${this.baseUrl}/v1/dag/assets/${encodeURIComponent(assetId)}/content`,
      method: 'GET',
      responseType: 'binary',
      contentTypeHeader: 'Content-Type',
      contentDispositionHeader: 'Content-Disposition',
    };
  }

  public async listCostMeta(): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/cost-meta', 'GET');
  }

  public async getCostMeta(nodeType: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/cost-meta/${encodeURIComponent(nodeType)}`, 'GET');
  }

  public async createCostMeta(
    input: TDagOrchestrationCostMetaRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/cost-meta', 'POST', input);
  }

  public async updateCostMeta(
    nodeType: string,
    input: TDagOrchestrationCostMetaRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/cost-meta/${encodeURIComponent(nodeType)}`, 'PUT', input);
  }

  public async deleteCostMeta(nodeType: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/cost-meta/${encodeURIComponent(nodeType)}`, 'DELETE');
  }

  public async validateCostMetaFormula(
    input: IDagOrchestrationCostMetaValidateRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/cost-meta/validate', 'POST', input);
  }

  public async previewCostMetaFormula(
    input: IDagOrchestrationCostMetaPreviewRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/cost-meta/preview', 'POST', input);
  }

  public async createRunDraft(
    input: TDagOrchestrationCreateRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/run-drafts', 'POST', input);
  }

  public async getRunDraft(draftId: string): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/run-drafts/${encodeURIComponent(draftId)}`, 'GET');
  }

  public async replaceRunDraft(
    draftId: string,
    input: TDagOrchestrationReplaceRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(`/v1/dag/run-drafts/${encodeURIComponent(draftId)}`, 'PUT', input);
  }

  public async resetRunDraftNodeResult(
    draftId: string,
    nodeId: string,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(
      `/v1/dag/run-drafts/${encodeURIComponent(draftId)}/nodes/${encodeURIComponent(nodeId)}/reset`,
      'PUT',
      {},
    );
  }

  public async overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.request(
      `/v1/dag/run-drafts/${encodeURIComponent(draftId)}/nodes/${encodeURIComponent(nodeId)}/result`,
      'PUT',
      input,
    );
  }

  public async startPublishedWorkflowRun(
    dagId: string,
    input?: IDagOrchestrationPublishedWorkflowRunRequest,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const versionQuery = typeof version === 'number' ? `?version=${version}` : '';
    return this.request(
      `/v1/dag/workflows/${encodeURIComponent(dagId)}/runs${versionQuery}`,
      'POST',
      input,
    );
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
