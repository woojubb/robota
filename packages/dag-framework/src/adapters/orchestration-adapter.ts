import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  DagDefinitionService,
  type IClockPort,
  type IDagDefinition,
  type INodeManifest,
  type IRunDraft,
  type IRunDraftStore,
  type IStoragePort,
  type IAssetStore,
} from '@robota-sdk/dag-core';
import type {
  IDagControllerComposition,
  IDagExecutionComposition,
  IProblemDetails,
} from '@robota-sdk/dag-api';
import type {
  IDagOrchestrationAssetContentDownloadInfo,
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationCostMetaPreviewRequest,
  IDagOrchestrationCostMetaValidateRequest,
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpPayload,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationListDefinitionsInput,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPort,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
  IOrchestrationProblemDetails,
  TDagOrchestrationCostMetaRequest,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationReplaceRunDraftRequest,
} from '@robota-sdk/dag-orchestration-client';
import { buildDagFromPipeline, type IDagBuildInput } from '@robota-sdk/dag-builder';

/** Dependencies for constructing the in-process orchestration adapter. */
export interface IDagFrameworkOrchestrationAdapterDependencies {
  readonly storage: IStoragePort;
  readonly controllers: IDagControllerComposition;
  readonly execution: IDagExecutionComposition;
  readonly manifests: readonly INodeManifest[];
  readonly assetStore: IAssetStore;
  readonly runDraftStore: IRunDraftStore;
  readonly clock: IClockPort;
}

function problemDetailsToOrchestration(p: IProblemDetails): IOrchestrationProblemDetails {
  const base: IOrchestrationProblemDetails = {
    type: p.type,
    title: p.title,
    status: p.status,
    detail: p.detail,
    instance: p.instance,
    code: p.code,
    retryable: p.retryable,
    ...(typeof p.correlationId === 'string' ? { correlationId: p.correlationId } : {}),
  };
  return base;
}

const NOT_IMPLEMENTED_PROBLEM: IOrchestrationProblemDetails = {
  type: 'urn:robota:problems:dag:framework_not_implemented',
  title: 'Feature not implemented in framework adapter',
  status: 501,
  detail: 'This operation is not implemented in the in-process DAG framework adapter.',
  instance: 'inproc://dag-framework',
  code: 'NOT_IMPLEMENTED_IN_FRAMEWORK',
  retryable: false,
};

/**
 * In-process implementation of {@link IDagOrchestrationPort}.
 *
 * This adapter wraps the framework's controllers and services directly
 * (no HTTP round-trip). The response envelope mirrors what the HTTP
 * client returns so that consumers like `dag-mcp-tools` can be reused
 * without modification.
 */
export class DagFrameworkOrchestrationAdapter implements IDagOrchestrationPort {
  private readonly storage: IStoragePort;
  private readonly controllers: IDagControllerComposition;
  private readonly execution: IDagExecutionComposition;
  private readonly manifests: readonly INodeManifest[];
  private readonly assetStore: IAssetStore;
  private readonly runDraftStore: IRunDraftStore;
  private readonly clock: IClockPort;
  private readonly definitionService: DagDefinitionService;

  public constructor(deps: IDagFrameworkOrchestrationAdapterDependencies) {
    this.storage = deps.storage;
    this.controllers = deps.controllers;
    this.execution = deps.execution;
    this.manifests = deps.manifests;
    this.assetStore = deps.assetStore;
    this.runDraftStore = deps.runDraftStore;
    this.clock = deps.clock;
    this.definitionService = new DagDefinitionService(deps.storage);
  }

  public async listDefinitions(
    input?: IDagOrchestrationListDefinitionsInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.controllers.design.listDefinitions({
      dagId: input?.dagId,
    });
    return this.toHttpResponse(response);
  }

  public async getDefinition(
    dagId: string,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.controllers.design.getDefinition({ dagId, version });
    return this.toHttpResponse(response);
  }

  public async createDefinition(
    definition: IDagDefinition,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.controllers.design.createDefinition({ definition });
    return this.toHttpResponse(response);
  }

  public async updateDraft(
    input: IDagOrchestrationUpdateDraftInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.controllers.design.updateDraft({
      dagId: input.dagId,
      version: input.version,
      definition: input.definition,
    });
    return this.toHttpResponse(response);
  }

  public async validateDefinition(
    dagId: string,
    version: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const response = await this.controllers.design.validateDefinition({ dagId, version });
    return this.toHttpResponse(response);
  }

  public async publishDefinition(
    dagId: string,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const resolvedVersion = await this.resolvePublishVersion(dagId, version);
    if (typeof resolvedVersion !== 'number') {
      return this.notFoundResponse(
        `/v1/dag/definitions/${dagId}/publish`,
        'DAG definition not found',
      );
    }
    const response = await this.controllers.design.publishDefinition({
      dagId,
      version: resolvedVersion,
    });
    return this.toHttpResponse(response);
  }

  public async listNodes(): Promise<IDagOrchestrationHttpResponse> {
    const payload: IDagOrchestrationHttpPayload = {
      ok: true,
      status: 200,
      data: {
        items: this.manifests.map((m) => ({
          nodeType: m.nodeType,
          displayName: m.displayName,
          category: m.category,
          inputs: m.inputs as unknown as object[],
          outputs: m.outputs as unknown as object[],
          ...(m.configSchema ? { configSchema: m.configSchema as unknown as object } : {}),
        })),
      },
    };
    return { ok: true, status: 200, payload };
  }

  public async createRun(
    input: IDagOrchestrationCreateRunInput,
  ): Promise<IDagOrchestrationHttpResponse> {
    const ensured = await this.ensurePublishedDefinition(input.definition);
    if (!ensured.ok) {
      return ensured.failure;
    }

    const result = await this.execution.runOrchestrator.createRun({
      dagId: ensured.dagId,
      version: ensured.version,
      trigger: 'manual',
      input: input.input ?? {},
    });
    if (!result.ok) {
      return this.errorResponseFromDomain(result.error, '/v1/dag/runs');
    }
    return this.successResponse(201, {
      dagRunId: result.value.dagRunId,
      preparationId: result.value.dagRunId,
      dagId: result.value.dagId,
      version: result.value.version,
      logicalDate: result.value.logicalDate,
      status: result.value.status,
    });
  }

  public async startRun(preparationId: string): Promise<IDagOrchestrationHttpResponse> {
    const result = await this.execution.runOrchestrator.startCreatedRun(preparationId);
    if (!result.ok) {
      return this.errorResponseFromDomain(result.error, `/v1/dag/runs/${preparationId}/start`);
    }
    return this.successResponse(200, result.value);
  }

  public async getRunStatus(dagRunId: string): Promise<IDagOrchestrationHttpResponse> {
    const result = await this.execution.runQuery.getRun(dagRunId);
    if (!result.ok) {
      return this.errorResponseFromDomain(result.error, `/v1/dag/runs/${dagRunId}`);
    }
    return this.successResponse(200, {
      dagRun: result.value.dagRun,
      taskRuns: result.value.taskRuns,
    });
  }

  public async getRunResult(dagRunId: string): Promise<IDagOrchestrationHttpResponse> {
    const result = await this.execution.runQuery.getRun(dagRunId);
    if (!result.ok) {
      return this.errorResponseFromDomain(result.error, `/v1/dag/runs/${dagRunId}/result`);
    }
    return this.successResponse(200, {
      dagRun: result.value.dagRun,
      taskRuns: result.value.taskRuns,
    });
  }

  public async uploadAsset(
    input: IDagOrchestrationAssetUploadRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    const buffer = Buffer.from(input.base64Data, 'base64');
    const metadata = await this.assetStore.save({
      fileName: input.fileName,
      mediaType: input.mediaType,
      content: new Uint8Array(buffer),
    });
    return this.successResponse(201, {
      asset: {
        referenceType: 'asset' as const,
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: `asset://${metadata.assetId}`,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes,
        ...(metadata.runtimeAssetId ? { runtimeAssetId: metadata.runtimeAssetId } : {}),
      },
    });
  }

  public async getAssetMetadata(assetId: string): Promise<IDagOrchestrationHttpResponse> {
    const metadata = await this.assetStore.getMetadata(assetId);
    if (!metadata) {
      return this.notFoundResponse(`/v1/dag/assets/${assetId}`, 'Asset not found');
    }
    return this.successResponse(200, {
      asset: {
        referenceType: 'asset' as const,
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: `asset://${metadata.assetId}`,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes,
        ...(metadata.runtimeAssetId ? { runtimeAssetId: metadata.runtimeAssetId } : {}),
      },
    });
  }

  public getAssetContentDownloadInfo(assetId: string): IDagOrchestrationAssetContentDownloadInfo {
    return {
      assetId,
      url: `inproc://dag-framework/assets/${assetId}/content`,
      method: 'GET',
      responseType: 'binary',
      contentTypeHeader: 'Content-Type',
      contentDispositionHeader: 'Content-Disposition',
    };
  }

  public async listCostMeta(): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse('/v1/cost-meta');
  }

  public async getCostMeta(nodeType: string): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse(`/v1/cost-meta/${nodeType}`);
  }

  public async createCostMeta(
    _input: TDagOrchestrationCostMetaRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse('/v1/cost-meta');
  }

  public async updateCostMeta(
    nodeType: string,
    _input: TDagOrchestrationCostMetaRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse(`/v1/cost-meta/${nodeType}`);
  }

  public async deleteCostMeta(nodeType: string): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse(`/v1/cost-meta/${nodeType}`);
  }

  public async validateCostMetaFormula(
    _input: IDagOrchestrationCostMetaValidateRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse('/v1/cost-meta/validate');
  }

  public async previewCostMetaFormula(
    _input: IDagOrchestrationCostMetaPreviewRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    return this.notImplementedResponse('/v1/cost-meta/preview');
  }

  public async createRunDraft(
    input: TDagOrchestrationCreateRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    const now = this.clock.nowIso();
    const draftId = input.draftId ?? randomUUID();
    const draft: IRunDraft = {
      draftId,
      definition: input.definition,
      input: input.input ?? {},
      nodeStateMap: input.nodeStateMap ?? {},
      ...(input.runResult ? { runResult: input.runResult } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.runDraftStore.saveRunDraft(draft);
    return this.successResponse(201, { draft });
  }

  public async getRunDraft(draftId: string): Promise<IDagOrchestrationHttpResponse> {
    const draft = await this.runDraftStore.getRunDraft(draftId);
    if (!draft) {
      return this.notFoundResponse(`/v1/dag/run-drafts/${draftId}`, 'Run draft not found');
    }
    return this.successResponse(200, { draft });
  }

  public async replaceRunDraft(
    draftId: string,
    input: TDagOrchestrationReplaceRunDraftRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    const existing = await this.runDraftStore.getRunDraft(draftId);
    const now = this.clock.nowIso();
    const next: IRunDraft = {
      draftId,
      definition: input.definition,
      input: input.input ?? {},
      nodeStateMap: input.nodeStateMap ?? {},
      ...(input.runResult ? { runResult: input.runResult } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.runDraftStore.saveRunDraft(next);
    return this.successResponse(200, { draft: next });
  }

  public async resetRunDraftNodeResult(
    draftId: string,
    nodeId: string,
  ): Promise<IDagOrchestrationHttpResponse> {
    const existing = await this.runDraftStore.getRunDraft(draftId);
    if (!existing) {
      return this.notFoundResponse(
        `/v1/dag/run-drafts/${draftId}/nodes/${nodeId}/reset`,
        'Run draft not found',
      );
    }
    const nextNodeStateMap = { ...existing.nodeStateMap };
    delete nextNodeStateMap[nodeId];
    const next: IRunDraft = {
      ...existing,
      nodeStateMap: nextNodeStateMap,
      updatedAt: this.clock.nowIso(),
    };
    await this.runDraftStore.saveRunDraft(next);
    return this.successResponse(200, { draft: next });
  }

  public async overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  ): Promise<IDagOrchestrationHttpResponse> {
    const existing = await this.runDraftStore.getRunDraft(draftId);
    if (!existing) {
      return this.notFoundResponse(
        `/v1/dag/run-drafts/${draftId}/nodes/${nodeId}/result`,
        'Run draft not found',
      );
    }
    const previousNodeState = existing.nodeStateMap[nodeId];
    const nextNodeStateMap = {
      ...existing.nodeStateMap,
      [nodeId]: {
        operationStatus: previousNodeState?.operationStatus ?? 'idle',
        executionStatus: 'success' as const,
        ...(previousNodeState?.pendingDescription !== undefined
          ? { pendingDescription: previousNodeState.pendingDescription }
          : {}),
        trace: {
          nodeId,
          ...(input.input ? { input: input.input } : {}),
          output: input.output,
        },
      },
    };
    const next: IRunDraft = {
      ...existing,
      nodeStateMap: nextNodeStateMap,
      updatedAt: this.clock.nowIso(),
    };
    await this.runDraftStore.saveRunDraft(next);
    return this.successResponse(200, { draft: next });
  }

  public async buildDag(input: IDagBuildInput): Promise<IDagOrchestrationHttpResponse> {
    const result = buildDagFromPipeline(input, this.manifests as INodeManifest[]);
    if (!result.ok) {
      const problem: IOrchestrationProblemDetails = {
        type: 'urn:robota:problems:dag:validation',
        title: 'DAG build failed',
        status: 400,
        detail: result.error.message,
        instance: 'inproc://dag-framework/build',
        code: result.error.code,
        retryable: false,
      };
      const payload: IDagOrchestrationHttpPayload = { ok: false, status: 400, errors: [problem] };
      return { ok: false, status: 400, payload };
    }
    return this.successResponse(200, {
      definition: result.definition,
      nodeCount: result.nodeCount,
      edgeCount: result.edgeCount,
      warnings: result.warnings,
    });
  }

  public async validateDag(definition: IDagDefinition): Promise<IDagOrchestrationHttpResponse> {
    const knownTypes = new Set(this.manifests.map((m) => m.nodeType));
    const nodeIds = new Set(definition.nodes.map((n) => n.nodeId));
    const errors: string[] = [];

    for (const node of definition.nodes) {
      if (!knownTypes.has(node.nodeType)) {
        errors.push(`Unknown node type "${node.nodeType}" for node "${node.nodeId}"`);
      }
    }
    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.from))
        errors.push(`Edge references unknown source node "${edge.from}"`);
      if (!nodeIds.has(edge.to)) errors.push(`Edge references unknown target node "${edge.to}"`);
    }

    return this.successResponse(200, { valid: errors.length === 0, errors });
  }

  public async startPublishedWorkflowRun(
    dagId: string,
    input?: IDagOrchestrationPublishedWorkflowRunRequest,
    version?: number,
  ): Promise<IDagOrchestrationHttpResponse> {
    const result = await this.execution.runOrchestrator.startRun({
      dagId,
      version,
      trigger: 'manual',
      input: input?.input ?? {},
    });
    if (!result.ok) {
      return this.errorResponseFromDomain(result.error, `/v1/dag/workflows/${dagId}/runs`);
    }
    return this.successResponse(201, {
      dagRunId: result.value.dagRunId,
      preparationId: result.value.dagRunId,
      dagId: result.value.dagId,
      version: result.value.version,
    });
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  private toHttpResponse(
    response:
      | { ok: true; status: number; data: object }
      | { ok: false; status: number; errors: readonly IProblemDetails[] },
  ): IDagOrchestrationHttpResponse {
    if (response.ok) {
      const payload: IDagOrchestrationHttpPayload = {
        ok: true,
        status: response.status,
        data: response.data,
      };
      return { ok: true, status: response.status, payload };
    }
    const errors = response.errors.map(problemDetailsToOrchestration);
    const payload: IDagOrchestrationHttpPayload = {
      ok: false,
      status: response.status,
      errors,
    };
    return { ok: false, status: response.status, payload };
  }

  private successResponse<TData extends object>(
    status: number,
    data: TData,
  ): IDagOrchestrationHttpResponse {
    const payload: IDagOrchestrationHttpPayload = {
      ok: true,
      status,
      data,
    };
    return { ok: true, status, payload };
  }

  private notImplementedResponse(instance: string): IDagOrchestrationHttpResponse {
    const problem: IOrchestrationProblemDetails = {
      ...NOT_IMPLEMENTED_PROBLEM,
      instance,
    };
    const payload: IDagOrchestrationHttpPayload = {
      ok: false,
      status: problem.status,
      errors: [problem],
    };
    return { ok: false, status: problem.status, payload };
  }

  private notFoundResponse(instance: string, detail: string): IDagOrchestrationHttpResponse {
    const problem: IOrchestrationProblemDetails = {
      type: 'urn:robota:problems:dag:not_found',
      title: 'Resource not found',
      status: 404,
      detail,
      instance,
      code: 'DAG_NOT_FOUND',
      retryable: false,
    };
    const payload: IDagOrchestrationHttpPayload = {
      ok: false,
      status: 404,
      errors: [problem],
    };
    return { ok: false, status: 404, payload };
  }

  private errorResponseFromDomain(
    error: { code: string; message: string; category?: string; retryable?: boolean },
    instance: string,
  ): IDagOrchestrationHttpResponse {
    const status = error.code.endsWith('_NOT_FOUND') ? 404 : 400;
    const problem: IOrchestrationProblemDetails = {
      type: `urn:robota:problems:dag:${error.category ?? 'validation'}`,
      title: 'DAG operation failed',
      status,
      detail: error.message,
      instance,
      code: error.code,
      retryable: error.retryable ?? false,
    };
    const payload: IDagOrchestrationHttpPayload = {
      ok: false,
      status,
      errors: [problem],
    };
    return { ok: false, status, payload };
  }

  /**
   * Ensures the supplied definition exists in storage in a published state.
   * If absent: creates a draft and publishes it.
   * If present but draft: publishes it.
   * Returns the (dagId, version) pair to execute, or a failure envelope.
   */
  private async ensurePublishedDefinition(
    definition: IDagDefinition,
  ): Promise<
    | { ok: true; dagId: string; version: number }
    | { ok: false; failure: IDagOrchestrationHttpResponse }
  > {
    const existing = await this.storage.getDefinition(definition.dagId, definition.version);
    if (!existing) {
      const created = await this.definitionService.createDraft(definition);
      if (!created.ok) {
        const problems = created.error.map<IOrchestrationProblemDetails>((e) =>
          this.dagErrorToOrchestrationProblem(e, '/v1/dag/runs', 'Validation failed'),
        );
        return {
          ok: false,
          failure: this.buildFailureResponse(400, problems),
        };
      }
    }

    const latest = await this.storage.getDefinition(definition.dagId, definition.version);
    if (latest && latest.status === 'published') {
      return { ok: true, dagId: latest.dagId, version: latest.version };
    }

    const published = await this.definitionService.publish(definition.dagId, definition.version);
    if (!published.ok) {
      const problems = published.error.map<IOrchestrationProblemDetails>((e) =>
        this.dagErrorToOrchestrationProblem(e, '/v1/dag/runs', 'Publish failed'),
      );
      return {
        ok: false,
        failure: this.buildFailureResponse(400, problems),
      };
    }
    return { ok: true, dagId: published.value.dagId, version: published.value.version };
  }

  private dagErrorToOrchestrationProblem(
    error: { code: string; message: string; category: string; retryable: boolean },
    instance: string,
    title: string,
  ): IOrchestrationProblemDetails {
    return {
      type: `urn:robota:problems:dag:${error.category}`,
      title,
      status: 400,
      detail: error.message,
      instance,
      code: error.code,
      retryable: error.retryable,
    };
  }

  private buildFailureResponse(
    status: number,
    errors: readonly IOrchestrationProblemDetails[],
  ): IDagOrchestrationHttpResponse {
    const payload: IDagOrchestrationHttpPayload = { ok: false, status, errors };
    return { ok: false, status, payload };
  }

  private async resolvePublishVersion(
    dagId: string,
    version?: number,
  ): Promise<number | undefined> {
    if (typeof version === 'number') return version;
    const definitions = await this.storage.listDefinitionsByDagId(dagId);
    if (definitions.length === 0) return undefined;
    const drafts = definitions.filter((d) => d.status === 'draft');
    if (drafts.length > 0) {
      return drafts[drafts.length - 1].version;
    }
    return definitions[definitions.length - 1].version;
  }
}
