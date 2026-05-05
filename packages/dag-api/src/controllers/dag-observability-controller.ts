import type {
  IObservabilityDashboardData,
  IQueryLineageProjectionRequest,
  IQueryRunProjectionRequest,
  TObservabilityApiResponse,
} from '../contracts/observability-api.js';
import { toRuntimeProblemDetails } from '../contracts/runtime-api.js';
import type {
  ILineageProjectionView,
  IObservabilityProjectionReaderPort,
  IRunProjectionView,
} from '../ports/controller-service-ports.js';

/**
 * API controller for DAG observability: run projections, lineage, and dashboards.
 * @see IObservabilityProjectionReaderPort
 */
export class DagObservabilityController {
  public constructor(private readonly projectionService: IObservabilityProjectionReaderPort) {}

  /**
   * Queries the run projection for a specific DAG run.
   * @param request - The query request with dagRunId.
   * @returns Run projection data or problem details on error.
   */
  public async queryRunProjection(
    request: IQueryRunProjectionRequest,
  ): Promise<TObservabilityApiResponse<IRunProjectionView>> {
    const projected = await this.projectionService.buildRunProjection(request.dagRunId);
    if (!projected.ok) {
      const problem = toRuntimeProblemDetails(
        projected.error,
        `/v1/dag/observability/runs/${request.dagRunId}`,
        request.correlationId,
      );
      return {
        ok: false,
        status: problem.status === 400 ? 404 : problem.status,
        errors: [problem],
      };
    }

    return {
      ok: true,
      status: 200,
      data: projected.value,
    };
  }

  /**
   * Queries the lineage projection for a specific DAG run.
   * @param request - The query request with dagRunId.
   * @returns Lineage projection data or problem details on error.
   */
  public async queryLineageProjection(
    request: IQueryLineageProjectionRequest,
  ): Promise<TObservabilityApiResponse<ILineageProjectionView>> {
    const projected = await this.projectionService.buildLineageProjection(request.dagRunId);
    if (!projected.ok) {
      const problem = toRuntimeProblemDetails(
        projected.error,
        `/v1/dag/observability/runs/${request.dagRunId}/lineage`,
        request.correlationId,
      );
      return {
        ok: false,
        status: problem.status === 400 ? 404 : problem.status,
        errors: [problem],
      };
    }

    return {
      ok: true,
      status: 200,
      data: projected.value,
    };
  }

  /**
   * Queries the combined dashboard with run and lineage projections.
   * @param request - The query request with dagRunId.
   * @returns Dashboard data or problem details on error.
   */
  public async queryDashboard(
    request: IQueryRunProjectionRequest,
  ): Promise<TObservabilityApiResponse<IObservabilityDashboardData>> {
    const dashboard = await this.projectionService.buildDashboardProjection(request.dagRunId);
    if (!dashboard.ok) {
      const problem = toRuntimeProblemDetails(
        dashboard.error,
        `/v1/dag/observability/runs/${request.dagRunId}/dashboard`,
        request.correlationId,
      );
      return {
        ok: false,
        status: problem.status === 400 ? 404 : problem.status,
        errors: [problem],
      };
    }

    return {
      ok: true,
      status: 200,
      data: dashboard.value,
    };
  }
}
