import { DagDefinitionService, type IDagDefinition, type IStoragePort } from '@robota-sdk/dag-core';
import type { IDagControllerComposition, IProblemDetails } from '@robota-sdk/dag-api';
import type { IDagExecutionComposition } from '../types.js';
import type {
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpPayload,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationPort,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
  IOrchestrationProblemDetails,
} from '@robota-sdk/dag-orchestration-client';

/** Dependencies for constructing the in-process orchestration adapter. */
export interface IDagFrameworkOrchestrationAdapterDependencies {
  readonly storage: IStoragePort;
  readonly controllers: IDagControllerComposition;
  readonly execution: IDagExecutionComposition;
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
  private readonly definitionService: DagDefinitionService;

  public constructor(deps: IDagFrameworkOrchestrationAdapterDependencies) {
    this.storage = deps.storage;
    this.controllers = deps.controllers;
    this.execution = deps.execution;
    this.definitionService = new DagDefinitionService(deps.storage);
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
