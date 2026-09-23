import type {
  IDagDefinition,
  IDagError,
  IOverwriteRunDraftNodeResultInput,
  IRunDraft,
  IRunDraftOperationsPort,
  ISaveRunDraftInput,
  TResult,
} from '@robota-sdk/dag-core';
import type { IDagBuildInput } from '@robota-sdk/dag-builder';
import type {
  ICostMeta,
  ICostMetaFormulaPreviewInput,
  ICostMetaFormulaValidation,
  ICostMetaFormulaValidationInput,
  ICostMetaOperationsPort,
} from '@robota-sdk/dag-cost';
import {
  costTransportFailure,
  decodeCostMeta,
  decodeCostMetaDelete,
  decodeCostMetaList,
  decodeCostMetaPreview,
  decodeCostMetaValidation,
  decodeCostResponse,
} from './cost-meta-response.js';
import {
  decodeRunDraftResponse,
  runDraftTransportFailure,
  runDraftUnparseableResponse,
} from './run-draft-response.js';
import type {
  IDagAssetHttpPort,
  IDagOrchestrationAssetContentDownloadInfo,
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationPort,
  IDagOrchestrationHttpClientConfig,
  IDagOrchestrationHttpPayload,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationListDefinitionsInput,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
  TDagOrchestrationFetch,
} from './orchestration-http-contracts.js';

type THttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT';

export class DagOrchestrationHttpClient
  implements
    IDagOrchestrationPort,
    IDagAssetHttpPort,
    ICostMetaOperationsPort,
    IRunDraftOperationsPort
{
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

  public async listCostMeta(): Promise<TResult<readonly ICostMeta[], IDagError>> {
    return this.costRequest('/v1/dag/cost-meta', 'GET', decodeCostMetaList);
  }

  public async getCostMeta(nodeType: string): Promise<TResult<ICostMeta, IDagError>> {
    return this.costRequest(
      `/v1/dag/cost-meta/${encodeURIComponent(nodeType)}`,
      'GET',
      decodeCostMeta,
    );
  }

  public async createCostMeta(input: ICostMeta): Promise<TResult<ICostMeta, IDagError>> {
    return this.costRequest('/v1/dag/cost-meta', 'POST', decodeCostMeta, input);
  }

  public async updateCostMeta(
    nodeType: string,
    input: ICostMeta,
  ): Promise<TResult<ICostMeta, IDagError>> {
    return this.costRequest(
      `/v1/dag/cost-meta/${encodeURIComponent(nodeType)}`,
      'PUT',
      decodeCostMeta,
      input,
    );
  }

  public async deleteCostMeta(
    nodeType: string,
  ): Promise<TResult<{ readonly nodeType: string }, IDagError>> {
    return this.costRequest(
      `/v1/dag/cost-meta/${encodeURIComponent(nodeType)}`,
      'DELETE',
      decodeCostMetaDelete,
    );
  }

  public async validateCostMetaFormula(
    input: ICostMetaFormulaValidationInput,
  ): Promise<TResult<ICostMetaFormulaValidation, IDagError>> {
    return this.costRequest('/v1/dag/cost-meta/validate', 'POST', decodeCostMetaValidation, input);
  }

  public async previewCostMetaFormula(
    input: ICostMetaFormulaPreviewInput,
  ): Promise<TResult<number, IDagError>> {
    return this.costRequest('/v1/dag/cost-meta/preview', 'POST', decodeCostMetaPreview, input);
  }

  public async createRunDraft(input: ISaveRunDraftInput): Promise<TResult<IRunDraft, IDagError>> {
    return this.runDraftRequest('/v1/dag/run-drafts', 'POST', input);
  }

  public async getRunDraft(draftId: string): Promise<TResult<IRunDraft, IDagError>> {
    return this.runDraftRequest(`/v1/dag/run-drafts/${encodeURIComponent(draftId)}`, 'GET');
  }

  public async replaceRunDraft(
    draftId: string,
    input: Omit<ISaveRunDraftInput, 'draftId'>,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.runDraftRequest(`/v1/dag/run-drafts/${encodeURIComponent(draftId)}`, 'PUT', input);
  }

  public async resetRunDraftNodeResult(
    draftId: string,
    nodeId: string,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.runDraftRequest(
      `/v1/dag/run-drafts/${encodeURIComponent(draftId)}/nodes/${encodeURIComponent(nodeId)}/reset`,
      'POST',
    );
  }

  public async overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IOverwriteRunDraftNodeResultInput,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.runDraftRequest(
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

  public async buildDag(input: IDagBuildInput): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/build', 'POST', input);
  }

  public async validateDag(definition: IDagDefinition): Promise<IDagOrchestrationHttpResponse> {
    return this.request('/v1/dag/validate', 'POST', definition);
  }

  private async costRequest<T>(
    path: string,
    method: THttpMethod,
    decode: (data: Record<string, unknown>) => T | undefined,
    body?: object,
  ): Promise<TResult<T, IDagError>> {
    try {
      return decodeCostResponse(await this.request(path, method, body), decode);
    } catch (error: unknown) {
      return costTransportFailure(error);
    }
  }

  private async runDraftRequest(
    path: string,
    method: THttpMethod,
    body?: object,
  ): Promise<TResult<IRunDraft, IDagError>> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
      });
    } catch (error: unknown) {
      return runDraftTransportFailure(error);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      return error instanceof SyntaxError
        ? runDraftUnparseableResponse(response.status)
        : runDraftTransportFailure(error);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return runDraftUnparseableResponse(response.status);
    }
    const httpPayload = payload as IDagOrchestrationHttpPayload;
    return decodeRunDraftResponse({
      ok: response.ok && httpPayload.ok !== false,
      status: response.status,
      payload: httpPayload,
    });
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
