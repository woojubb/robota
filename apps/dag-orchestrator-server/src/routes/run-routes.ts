import type { Router, Request, Response } from 'express';
import { toProblemDetails } from '@robota-sdk/dag-api';
import type { IDagDefinition, TPortPayload, IAssetStore, IPromptRequest } from '@robota-sdk/dag-core';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
    toRunProblemDetails,
    validateAssetReferences,
    HTTP_BAD_REQUEST,
    HTTP_NOT_FOUND,
    HTTP_CREATED,
    HTTP_ACCEPTED,
    HTTP_OK,
    HTTP_CONFLICT
} from './route-utils.js';

interface IAssetReference {
    referenceType: 'asset';
    assetId: string;
}

function isAssetReference(value: unknown): value is IAssetReference {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && 'referenceType' in value
        && (value as Record<string, unknown>).referenceType === 'asset'
        && typeof (value as Record<string, unknown>).assetId === 'string';
}

/**
 * Upload referenced assets from orchestrator's asset store to the runtime backend.
 * Scans prompt inputs for asset references, uploads each to runtime's /upload/image,
 * and replaces the assetId in the prompt with the runtime's assetId.
 */
async function uploadAssetsToRuntime(
    promptRequest: IPromptRequest,
    assetStore: IAssetStore,
    backendUrl: string,
): Promise<void> {
    const prompt = promptRequest.prompt;

    for (const nodeEntry of Object.values(prompt)) {
        const inputs = nodeEntry.inputs;
        for (const [inputKey, inputValue] of Object.entries(inputs)) {
            if (!isAssetReference(inputValue)) continue;

            const assetId = (inputValue as IAssetReference).assetId;
            const contentResult = await assetStore.getContent(assetId);
            if (!contentResult) continue;

            // Collect binary data from stream
            const chunks: Buffer[] = [];
            for await (const chunk of contentResult.stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
            }
            const binary = Buffer.concat(chunks);

            // Build multipart/form-data body
            const boundary = `----AssetUpload${Date.now()}${assetId.slice(0, 8)}`;
            const fileName = contentResult.metadata.fileName;
            const mediaType = contentResult.metadata.mediaType;

            const header = Buffer.from(
                `--${boundary}\r\n`
                + `Content-Disposition: form-data; name="image"; filename="${fileName}"\r\n`
                + `Content-Type: ${mediaType}\r\n`
                + `\r\n`
            );
            const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
            const body = Buffer.concat([header, binary, footer]);

            const response = await fetch(`${backendUrl}/upload/image`, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body,
            });

            if (!response.ok) continue;

            const result = await response.json() as { name: string };
            const runtimeAssetId = result.name;

            // Update the prompt input with the runtime's assetId
            const ref = inputValue as Record<string, unknown>;
            ref.assetId = runtimeAssetId;
            if (typeof ref.uri === 'string') {
                ref.uri = `asset://${runtimeAssetId}`;
            }
        }
    }
}

export function registerRunRoutes(
    router: Router,
    runService: OrchestratorRunService,
    assetStore: IAssetStore,
    backendUrl: string,
): void {
    router.post('/v1/dag/runs', async (req: Request, res: Response) => {
        const runInstance = '/v1/dag/runs';
        const definition = req.body?.definition as IDagDefinition | undefined;
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: [toRunProblemDetails({ code: 'DAG_VALIDATION_RUN_DEFINITION_REQUIRED', detail: 'definition is required', retryable: false }, runInstance)]
            });
            return;
        }
        const input = req.body?.input;
        if (typeof input !== 'undefined' && (typeof input !== 'object' || input === null || Array.isArray(input))) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: [toRunProblemDetails({ code: 'DAG_VALIDATION_RUN_INPUT_INVALID', detail: 'input must be an object when provided', retryable: false }, runInstance)]
            });
            return;
        }
        const assetErrors = await validateAssetReferences(definition, assetStore);
        if (assetErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: assetErrors.map((error) => toRunProblemDetails(error, runInstance))
            });
            return;
        }
        const result = await runService.createRun(definition, (input ?? {}) as TPortPayload);
        if (!result.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: [toProblemDetails(result.error, runInstance)]
            });
            return;
        }
        res.status(HTTP_CREATED).json({
            ok: true, status: HTTP_CREATED,
            data: { preparationId: result.value.preparationId }
        });
    });

    router.post('/v1/dag/runs/:id/start', async (req: Request<{ id: string }>, res: Response) => {
        const instance = `/v1/dag/runs/${req.params.id}/start`;
        const preparationId = req.params.id;

        // Upload referenced assets to runtime before submitting prompt
        const promptRequest = runService.getPendingPromptRequest(preparationId);
        if (promptRequest) {
            await uploadAssetsToRuntime(promptRequest, assetStore, backendUrl);
        }

        const result = await runService.startRun(preparationId);
        if (!result.ok) {
            const statusCode = result.error.code === 'ORCHESTRATOR_RUN_NOT_FOUND' ? HTTP_NOT_FOUND : HTTP_BAD_REQUEST;
            res.status(statusCode).json({
                ok: false, status: statusCode,
                errors: [toProblemDetails(result.error, instance)]
            });
            return;
        }
        res.status(HTTP_ACCEPTED).json({
            ok: true, status: HTTP_ACCEPTED,
            data: { dagRunId: result.value.dagRunId, preparationId: result.value.preparationId }
        });
    });

    router.get('/v1/dag/runs/:dagRunId/result', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}/result`;
        const result = await runService.getRunResult(req.params.dagRunId);
        if (!result.ok) {
            const statusCode = result.error.code === 'ORCHESTRATOR_RUN_NOT_FOUND'
                ? HTTP_NOT_FOUND
                : result.error.code === 'ORCHESTRATOR_RUN_NOT_COMPLETED'
                    ? HTTP_CONFLICT
                    : HTTP_BAD_REQUEST;
            res.status(statusCode).json({
                ok: false, status: statusCode,
                errors: [toProblemDetails(result.error, instance)]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true, status: HTTP_OK,
            data: { run: result.value }
        });
    });

    router.get('/v1/dag/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}`;
        const result = await runService.getRunStatus(req.params.dagRunId);
        if (!result.ok) {
            res.status(HTTP_NOT_FOUND).json({
                ok: false, status: HTTP_NOT_FOUND,
                errors: [toProblemDetails(result.error, instance)]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true, status: HTTP_OK,
            data: { dagRunId: req.params.dagRunId, status: result.value.status }
        });
    });
}
