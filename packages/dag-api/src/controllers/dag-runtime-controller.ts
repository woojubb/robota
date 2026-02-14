import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';
import type { RunCancelService, RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import type {
    ICancelRunRequest,
    IQueryRunRequest,
    ITriggerRunRequest,
    TRuntimeApiResponse
} from '../contracts/runtime-api.js';
import { toRuntimeProblemDetails } from '../contracts/runtime-api.js';

export class DagRuntimeController {
    public constructor(
        private readonly runOrchestrator: RunOrchestratorService,
        private readonly runQuery: RunQueryService,
        private readonly runCancel: RunCancelService
    ) {}

    public async triggerRun(
        request: ITriggerRunRequest
    ): Promise<TRuntimeApiResponse<{
        dagRunId: string;
        dagId: string;
        version: number;
        logicalDate: string;
        taskRunIds: string[];
    }>> {
        const started = await this.runOrchestrator.startRun({
            dagId: request.dagId,
            version: request.version,
            trigger: request.trigger,
            logicalDate: request.logicalDate,
            input: request.input
        });

        if (!started.ok) {
            const problem = toRuntimeProblemDetails(
                started.error,
                '/v1/dag/runs',
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status,
                errors: [problem]
            };
        }

        return {
            ok: true,
            status: 201,
            data: started.value
        };
    }

    public async queryRun(
        request: IQueryRunRequest
    ): Promise<TRuntimeApiResponse<{ dagRun: IDagRun; taskRuns: ITaskRun[] }>> {
        const queried = await this.runQuery.getRun(request.dagRunId);
        if (!queried.ok) {
            const problem = toRuntimeProblemDetails(
                queried.error,
                `/v1/dag/runs/${request.dagRunId}`,
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
            data: queried.value
        };
    }

    public async cancelRun(
        request: ICancelRunRequest
    ): Promise<TRuntimeApiResponse<{ dagRunId: string; status: 'cancelled' }>> {
        const cancelled = await this.runCancel.cancelRun(request.dagRunId);
        if (!cancelled.ok) {
            const problem = toRuntimeProblemDetails(
                cancelled.error,
                `/v1/dag/runs/${request.dagRunId}/cancel`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status,
                errors: [problem]
            };
        }

        return {
            ok: true,
            status: 200,
            data: cancelled.value
        };
    }
}
