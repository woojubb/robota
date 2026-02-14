import { type IDagError, type ITaskRun } from '@robota-sdk/dag-core';
import type { RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import type { DlqReinjectService } from '@robota-sdk/dag-worker';
import type {
    IAnalyzeFailureRequest,
    IFailureCodeCount,
    IFailureAnalysis,
    IReinjectDeadLetterRequest,
    IRerunRequest,
    TDiagnosticsApiResponse
} from '../contracts/diagnostics-api.js';
import { toRuntimeProblemDetails } from '../contracts/runtime-api.js';

function isFailedTask(taskRun: ITaskRun): boolean {
    return taskRun.status === 'failed'
        || taskRun.status === 'upstream_failed'
        || taskRun.status === 'cancelled';
}

function countFailureCodes(failedTaskRuns: ITaskRun[]): IFailureCodeCount[] {
    const counts = new Map<string, number>();
    for (const taskRun of failedTaskRuns) {
        const code = taskRun.errorCode ?? 'UNKNOWN_ERROR';
        const previous = counts.get(code) ?? 0;
        counts.set(code, previous + 1);
    }

    return Array.from(counts.entries()).map(([code, count]) => ({ code, count }));
}

export interface IDiagnosticsPolicy {
    reinjectEnabled: boolean;
}

function buildPolicyError(
    code: string,
    message: string,
    context?: Record<string, string | number | boolean>
): IDagError {
    return {
        code,
        category: 'validation' as const,
        message,
        retryable: false,
        context
    };
}

export class DagDiagnosticsController {
    public constructor(
        private readonly runQuery: RunQueryService,
        private readonly runOrchestrator: RunOrchestratorService,
        private readonly dlqReinject: DlqReinjectService,
        private readonly policy: IDiagnosticsPolicy = { reinjectEnabled: false }
    ) {}

    public async analyzeFailure(
        request: IAnalyzeFailureRequest
    ): Promise<TDiagnosticsApiResponse<IFailureAnalysis>> {
        const queried = await this.runQuery.getRun(request.dagRunId);
        if (!queried.ok) {
            const problem = toRuntimeProblemDetails(
                queried.error,
                `/v1/dag/diagnostics/runs/${request.dagRunId}/failures`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status === 400 ? 404 : problem.status,
                errors: [problem]
            };
        }

        const failedTaskRuns = queried.value.taskRuns.filter((taskRun) => isFailedTask(taskRun));
        return {
            ok: true,
            status: 200,
            data: {
                dagRun: queried.value.dagRun,
                failedTaskRuns,
                failureCodeCounts: countFailureCodes(failedTaskRuns)
            }
        };
    }

    public async rerun(
        request: IRerunRequest
    ): Promise<TDiagnosticsApiResponse<{
        sourceDagRunId: string;
        rerunDagRunId: string;
        dagId: string;
        version: number;
    }>> {
        const source = await this.runQuery.getRun(request.sourceDagRunId);
        if (!source.ok) {
            const problem = toRuntimeProblemDetails(
                source.error,
                `/v1/dag/diagnostics/runs/${request.sourceDagRunId}/rerun`,
                request.correlationId
            );
            return {
                ok: false,
                status: problem.status === 400 ? 404 : problem.status,
                errors: [problem]
            };
        }

        const started = await this.runOrchestrator.startRun({
            dagId: source.value.dagRun.dagId,
            version: source.value.dagRun.version,
            trigger: 'manual',
            rerunKey: request.rerunKey,
            input: request.input
        });
        if (!started.ok) {
            const problem = toRuntimeProblemDetails(
                started.error,
                `/v1/dag/diagnostics/runs/${request.sourceDagRunId}/rerun`,
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
            data: {
                sourceDagRunId: request.sourceDagRunId,
                rerunDagRunId: started.value.dagRunId,
                dagId: started.value.dagId,
                version: started.value.version
            }
        };
    }

    public async reinjectDeadLetter(
        request: IReinjectDeadLetterRequest
    ): Promise<TDiagnosticsApiResponse<{ reinjected: boolean; taskRunId?: string }>> {
        if (!this.policy.reinjectEnabled) {
            const problem = toRuntimeProblemDetails(
                buildPolicyError(
                    'DAG_POLICY_REINJECT_DISABLED',
                    'Dead letter reinject is disabled by diagnostics policy',
                    { workerId: request.workerId }
                ),
                '/v1/dag/diagnostics/dlq/reinject',
                request.correlationId
            );
            return {
                ok: false,
                status: 409,
                errors: [problem]
            };
        }

        const reinjected = await this.dlqReinject.reinjectOnce(request.workerId, request.visibilityTimeoutMs);
        if (!reinjected.ok) {
            const problem = toRuntimeProblemDetails(
                reinjected.error,
                '/v1/dag/diagnostics/dlq/reinject',
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
            data: reinjected.value
        };
    }
}
