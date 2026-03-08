import type { Router, Request, Response } from 'express';
import { toProblemDetails, type DagRuntimeController, type DagObservabilityController } from '@robota-sdk/dag-api';
import type { TPortPayload } from '@robota-sdk/dag-core';
import type { IAssetStore } from '../asset-store-contract.js';
import type { DagRunService } from '../dag-run-service.js';
import type { ICreateRunBody, IRunParams, IDeleteDefinitionArtifactsQuery } from './route-types.js';
import {
    resolveCorrelationId,
    toRunProblemDetails,
    validateAssetReferences,
    parseOptionalPositiveIntegerQuery,
    HTTP_BAD_REQUEST,
    HTTP_NOT_FOUND,
    HTTP_CREATED,
    HTTP_ACCEPTED,
    HTTP_OK,
    HTTP_CONFLICT
} from './route-utils.js';

/**
 * Registers run-related routes on the provided router.
 */
export function registerRunRoutes(
    router: Router,
    dagRunService: DagRunService,
    runtimeController: DagRuntimeController,
    observabilityController: DagObservabilityController,
    assetStore: IAssetStore
): void {
    router.post('/v1/dag/runs', async (
        req: Request<unknown, unknown, ICreateRunBody>,
        res: Response
    ) => {
        const runInstance = '/v1/dag/runs';
        const definition = req.body?.definition;
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    toRunProblemDetails(
                        {
                            code: 'DAG_VALIDATION_RUN_DEFINITION_REQUIRED',
                            detail: 'definition is required',
                            retryable: false
                        },
                        runInstance
                    )
                ]
            });
            return;
        }
        const input = req.body?.input;
        if (
            typeof input !== 'undefined'
            && (typeof input !== 'object' || input === null || Array.isArray(input))
        ) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    toRunProblemDetails(
                        {
                            code: 'DAG_VALIDATION_RUN_INPUT_INVALID',
                            detail: 'input must be an object when provided',
                            retryable: false
                        },
                        runInstance
                    )
                ]
            });
            return;
        }
        const assetValidationErrors = await validateAssetReferences(definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: assetValidationErrors.map((error) => toRunProblemDetails(error, runInstance))
            });
            return;
        }
        const created = await dagRunService.createRun(definition, (input ?? {}) as TPortPayload);
        if (!created.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [toProblemDetails(created.error, runInstance)]
            });
            return;
        }
        res.status(HTTP_CREATED).json({
            ok: true,
            status: HTTP_CREATED,
            data: {
                dagRunId: created.value.dagRunId
            }
        });
    });

    router.post('/v1/dag/runs/:dagRunId/start', async (
        req: Request<IRunParams>,
        res: Response
    ) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}/start`;
        const started = await dagRunService.startRunById(req.params.dagRunId);
        if (!started.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [toProblemDetails(started.error, instance)]
            });
            return;
        }
        res.status(HTTP_ACCEPTED).json({
            ok: true,
            status: HTTP_ACCEPTED,
            data: {
                dagRunId: started.value.dagRunId
            }
        });
    });

    router.get('/v1/dag/runs/:dagRunId/result', async (
        req: Request<IRunParams>,
        res: Response
    ) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}/result`;
        const result = await dagRunService.getRunResult(req.params.dagRunId);
        if (!result.ok) {
            const problem = toProblemDetails(result.error, instance);
            const statusCode = result.error.code === 'DAG_VALIDATION_RUN_NOT_TERMINAL' ? HTTP_CONFLICT : HTTP_BAD_REQUEST;
            res.status(statusCode).json({
                ok: false,
                status: statusCode,
                errors: [problem]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: {
                run: result.value
            }
        });
    });

    router.delete('/v1/dag/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const deleted = await dagRunService.deleteRunArtifacts(req.params.dagRunId);
        if (!deleted.ok) {
            res.status(HTTP_NOT_FOUND).json({
                ok: false,
                status: HTTP_NOT_FOUND,
                errors: [deleted.error]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: deleted.value
        });
    });

    router.delete('/v1/dag/runs/temporary-copies', async (_req: Request, res: Response) => {
        const deleted = await dagRunService.deleteRunCopyArtifacts();
        if (!deleted.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [deleted.error]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: deleted.value
        });
    });

    router.delete('/v1/dag/dev/definitions/:dagId', async (
        req: Request<{ dagId: string }, unknown, unknown, IDeleteDefinitionArtifactsQuery>,
        res: Response
    ) => {
        const parsedVersionResult = parseOptionalPositiveIntegerQuery(req.query.version);
        if (!parsedVersionResult.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [parsedVersionResult.error]
            });
            return;
        }
        const version = parsedVersionResult.value;
        const deleted = await dagRunService.deleteDefinitionArtifacts(req.params.dagId, version);
        if (!deleted.ok) {
            res.status(HTTP_NOT_FOUND).json({
                ok: false,
                status: HTTP_NOT_FOUND,
                errors: [deleted.error]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: deleted.value
        });
    });

    router.get('/v1/dag/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const queried = await runtimeController.queryRun({
            dagRunId: req.params.dagRunId,
            correlationId: resolveCorrelationId(req, 'dag-dev-query-run')
        });
        res.status(queried.status).json(queried);
    });

    router.get('/v1/dag/dev/observability/:dagRunId/dashboard', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const dashboard = await observabilityController.queryDashboard({
            dagRunId: req.params.dagRunId,
            correlationId: resolveCorrelationId(req, 'dag-dev-dashboard')
        });
        res.status(dashboard.status).json(dashboard);
    });
}
