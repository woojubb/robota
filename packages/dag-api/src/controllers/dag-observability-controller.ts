import type { ILineageProjection, IRunProjection, ProjectionReadModelService } from '@robota-sdk/dag-projection';
import type {
    IObservabilityDashboardData,
    IQueryLineageProjectionRequest,
    IQueryRunProjectionRequest,
    TObservabilityApiResponse
} from '../contracts/observability-api.js';
import { toRuntimeProblemDetails } from '../contracts/runtime-api.js';

export class DagObservabilityController {
    public constructor(private readonly projectionService: ProjectionReadModelService) {}

    public async queryRunProjection(
        request: IQueryRunProjectionRequest
    ): Promise<TObservabilityApiResponse<IRunProjection>> {
        const projected = await this.projectionService.buildRunProjection(request.dagRunId);
        if (!projected.ok) {
            const problem = toRuntimeProblemDetails(
                projected.error,
                `/v1/dag/observability/runs/${request.dagRunId}`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status === 400 ? 404 : problem.status,
                errors: [problem]
            };
        }

        return {
            ok: true,
            status: 200,
            data: projected.value
        };
    }

    public async queryLineageProjection(
        request: IQueryLineageProjectionRequest
    ): Promise<TObservabilityApiResponse<ILineageProjection>> {
        const projected = await this.projectionService.buildLineageProjection(request.dagRunId);
        if (!projected.ok) {
            const problem = toRuntimeProblemDetails(
                projected.error,
                `/v1/dag/observability/runs/${request.dagRunId}/lineage`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status === 400 ? 404 : problem.status,
                errors: [problem]
            };
        }

        return {
            ok: true,
            status: 200,
            data: projected.value
        };
    }

    public async queryDashboard(
        request: IQueryRunProjectionRequest
    ): Promise<TObservabilityApiResponse<IObservabilityDashboardData>> {
        const dashboard = await this.projectionService.buildDashboardProjection(request.dagRunId);
        if (!dashboard.ok) {
            const problem = toRuntimeProblemDetails(
                dashboard.error,
                `/v1/dag/observability/runs/${request.dagRunId}/dashboard`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status === 400 ? 404 : problem.status,
                errors: [problem]
            };
        }

        return {
            ok: true,
            status: 200,
            data: dashboard.value
        };
    }
}
