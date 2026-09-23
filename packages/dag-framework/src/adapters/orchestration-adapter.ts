import { DagDefinitionService, type IDagDefinition, type IStoragePort } from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '../types.js';
import type {
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpPayload,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationPort,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IOrchestrationProblemDetails,
} from '@robota-sdk/dag-orchestration-client';

/** Dependencies for constructing the in-process orchestration adapter. */
export interface IDagFrameworkOrchestrationAdapterDependencies {
  readonly storage: IStoragePort;
  readonly execution: IDagExecutionComposition;
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
  private readonly execution: IDagExecutionComposition;
  private readonly definitionService: DagDefinitionService;

  public constructor(deps: IDagFrameworkOrchestrationAdapterDependencies) {
    this.storage = deps.storage;
    this.execution = deps.execution;
    this.definitionService = new DagDefinitionService(deps.storage);
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

}
