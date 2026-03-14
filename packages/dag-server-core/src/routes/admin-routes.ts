import type { Router, Request, Response } from 'express';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { DagDesignController, IDagExecutionComposition } from '@robota-sdk/dag-api';
import type { ILlmCompleteBody, ILlmRuntimeClient } from './route-types.js';
import {
    createCorrelationId,
    HTTP_BAD_REQUEST,
    HTTP_CREATED,
    HTTP_OK,
    HTTP_INTERNAL_SERVER_ERROR
} from './route-utils.js';

/** Sample definition initial version. */
const SAMPLE_DEFINITION_VERSION = 1;

/**
 * Creates a sample DAG definition for dev bootstrap.
 */
function createSampleDefinition(dagId: string, version: number): IDagDefinition {
    return {
        dagId,
        version,
        status: 'draft',
        nodes: [
            {
                nodeId: 'image_source_1',
                nodeType: 'image-source',
                dependsOn: [],
                inputs: [],
                outputs: [
                    {
                        key: 'image',
                        label: 'Image',
                        order: 0,
                        type: 'binary',
                        required: true,
                        binaryKind: 'image',
                        mimeTypes: ['image/png']
                    }
                ],
                config: {
                    asset: {
                        referenceType: 'uri',
                        uri: 'file://sample-image.png'
                    },
                    mimeType: 'image/png'
                }
            },
            {
                nodeId: 'ok_emitter_1',
                nodeType: 'ok-emitter',
                dependsOn: ['image_source_1'],
                inputs: [
                    {
                        key: 'image',
                        label: 'Image',
                        order: 0,
                        type: 'binary',
                        required: true,
                        binaryKind: 'image',
                        mimeTypes: ['image/png']
                    }
                ],
                outputs: [
                    { key: 'status', label: 'Status', order: 0, type: 'string', required: true }
                ],
                config: {}
            }
        ],
        edges: [
            {
                from: 'image_source_1',
                to: 'ok_emitter_1',
                bindings: [
                    { outputKey: 'image', inputKey: 'image' }
                ]
            }
        ]
    };
}

/**
 * Registers dev-specific routes (bootstrap, LLM, worker) on the provided router.
 */
export function registerDevRoutes(
    router: Router,
    designController: DagDesignController,
    workerLoop: IDagExecutionComposition['workerLoop'],
    llmCompletionClient: ILlmRuntimeClient | undefined
): void {
    router.post('/v1/dag/dev/bootstrap', async (_req: Request, res: Response) => {
        const definition = createSampleDefinition('dag-dev-sample', SAMPLE_DEFINITION_VERSION);
        const created = await designController.createDefinition({
            definition,
            correlationId: createCorrelationId('dag-dev-bootstrap-create')
        });
        if (!created.ok) {
            res.status(created.status).json(created);
            return;
        }

        const published = await designController.publishDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: createCorrelationId('dag-dev-bootstrap-publish')
        });
        if (!published.ok) {
            res.status(published.status).json(published);
            return;
        }

        res.status(HTTP_CREATED).json({
            ok: true,
            status: HTTP_CREATED,
            data: {
                definitionId: `${definition.dagId}:${definition.version}`,
                dagId: definition.dagId,
                version: definition.version
            }
        });
    });

    router.post('/v1/dag/dev/llm-text/complete', async (
        req: Request<unknown, unknown, ILlmCompleteBody>,
        res: Response
    ) => {
        if (!llmCompletionClient) {
            res.status(HTTP_INTERNAL_SERVER_ERROR).json({
                ok: false,
                status: HTTP_INTERNAL_SERVER_ERROR,
                errors: [
                    {
                        code: 'DAG_VALIDATION_LLM_CLIENT_NOT_CONFIGURED',
                        detail: 'LLM completion client is not configured on API server.',
                        retryable: false
                    }
                ]
            });
            return;
        }
        const { prompt, temperature, maxTokens } = req.body ?? {};
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
                        detail: 'prompt is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof temperature !== 'undefined' && typeof temperature !== 'number') {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_LLM_TEMPERATURE_INVALID',
                        detail: 'temperature must be a number when provided',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof maxTokens !== 'undefined' && typeof maxTokens !== 'number') {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_LLM_MAXTOKENS_INVALID',
                        detail: 'maxTokens must be a number when provided',
                        retryable: false
                    }
                ]
            });
            return;
        }
        const provider = typeof req.body?.provider === 'string' && req.body.provider.trim().length > 0
            ? req.body.provider
            : undefined;
        const model = typeof req.body?.model === 'string' && req.body.model.trim().length > 0
            ? req.body.model
            : undefined;
        const resolvedSelectionResult = llmCompletionClient.resolveModelSelection({
            provider,
            model
        });
        if (!resolvedSelectionResult.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [resolvedSelectionResult.error]
            });
            return;
        }
        const completionResult = await llmCompletionClient.generateCompletion({
            prompt,
            provider: resolvedSelectionResult.value.provider,
            model: resolvedSelectionResult.value.model,
            temperature,
            maxTokens
        });
        if (!completionResult.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [completionResult.error]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: {
                completion: completionResult.value,
                modelSelection: resolvedSelectionResult.value
            }
        });
    });

    router.post('/v1/dag/dev/workers/process-once', async (_req: Request, res: Response) => {
        const processed = await workerLoop.processOnce();
        if (!processed.ok) {
            res.status(HTTP_INTERNAL_SERVER_ERROR).json({
                ok: false,
                status: HTTP_INTERNAL_SERVER_ERROR,
                errors: [processed.error]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: processed.value
        });
    });
}
