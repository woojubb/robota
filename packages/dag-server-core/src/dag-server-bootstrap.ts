import express, { type Request, type Response } from 'express';
import cors from 'cors';
import {
    EXECUTION_PROGRESS_EVENTS,
    LifecycleTaskExecutorPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    SystemClockPort,
    TASK_EVENTS,
    TASK_PROGRESS_EVENTS,
    type IDagDefinition,
    type INodeLifecycleFactory,
    type INodeManifest,
    type INodeManifestRegistry,
    type TRunProgressEvent,
    type TPortPayload
} from '@robota-sdk/dag-core';
import type { ILlmTextCompletionClient } from '@robota-sdk/dag-node-llm-text';
import {
    createDagControllerComposition,
    createDagExecutionComposition,
    toProblemDetails,
    type INodeCatalogService
} from '@robota-sdk/dag-api';
import type { IAssetStore, IStoredAssetMetadata } from './asset-store-contract.js';

/**
 * API response shape for asset endpoints; includes content URI.
 * Differs from dag-core IAssetReference which disallows uri when referenceType is 'asset'.
 */
interface IAssetApiResponse {
    referenceType: 'asset';
    assetId: string;
    mediaType: string;
    uri: string;
    name?: string;
    sizeBytes?: number;
}
import { AssetAwareTaskExecutorPort } from './asset-aware-task-executor.js';
import { DagRunService } from './dag-run-service.js';

interface IVersionBody {
    version: number;
}

interface ICreateDefinitionBody {
    definition: IDagDefinition;
}

interface IUpdateDraftBody {
    version: number;
    definition: IDagDefinition;
}

interface IGetDefinitionQuery {
    version?: string;
}

interface IListDefinitionsQuery {
    dagId?: string;
}

interface ICreateAssetBody {
    fileName: string;
    mediaType: string;
    base64Data: string;
}

interface ILlmCompleteBody {
    prompt: string;
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

interface ICreateRunBody {
    definition: IDagDefinition;
    input?: TPortPayload;
}

interface IRunParams {
    dagRunId: string;
}

interface IDeleteDefinitionArtifactsQuery {
    version?: string;
}

interface IAssetValidationError {
    code: string;
    detail: string;
    retryable: false;
}

function parseTaskRunPayloadSnapshot(snapshot: string | undefined): TPortPayload | undefined {
    if (typeof snapshot !== 'string' || snapshot.length === 0) {
        return undefined;
    }
    return JSON.parse(snapshot) as TPortPayload;
}

function toRunProblemDetails(
    error: IAssetValidationError,
    instance: string
): {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    retryable: boolean;
} {
    return {
        type: 'urn:robota:problems:dag:validation',
        title: 'DAG validation failed',
        status: 400,
        detail: error.detail,
        instance,
        code: error.code,
        retryable: error.retryable
    };
}

export interface IDagServerBootstrapOptions {
    nodeManifests: INodeManifest[];
    nodeLifecycleFactory: INodeLifecycleFactory;
    nodeCatalogService: INodeCatalogService;
    assetStore: IAssetStore;
    llmCompletionClient?: ILlmTextCompletionClient;
    port?: number;
    corsOrigins?: string[];
    requestBodyLimit?: string;
    defaultWorkerTimeoutMs?: number;
}

const DEFAULT_PORT = 3011;
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000'];
const DEFAULT_REQUEST_BODY_LIMIT = '15mb';
const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

function toAssetReference(metadata: IStoredAssetMetadata, contentUri: string): IAssetApiResponse {
    return {
        referenceType: 'asset',
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: contentUri,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes
    };
}

function getAssetContentUri(req: { protocol: string; get(name: string): string | undefined }, assetId: string): string {
    return `${req.protocol}://${req.get('host')}/v1/dag/assets/${assetId}/content`;
}

async function validateAssetReferences(
    definition: IDagDefinition,
    assetStore: IAssetStore
): Promise<IAssetValidationError[]> {
    const errors: IAssetValidationError[] = [];
    for (const node of definition.nodes) {
        const config = node.config;
        const assetValue = config.asset;
        if (typeof assetValue === 'object' && assetValue !== null && 'referenceType' in assetValue) {
            const referenceType = assetValue.referenceType;
            const hasAssetId = 'assetId' in assetValue && typeof assetValue.assetId === 'string' && assetValue.assetId.trim().length > 0;
            const hasUri = 'uri' in assetValue && typeof assetValue.uri === 'string' && assetValue.uri.trim().length > 0;
            if (hasAssetId === hasUri) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED',
                    detail: `Node ${node.nodeId} config.asset must provide exactly one of assetId or uri`,
                    retryable: false
                });
                continue;
            }
            if (referenceType === 'asset' && !hasAssetId) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_ASSET_REQUIRES_ASSET_ID',
                    detail: `Node ${node.nodeId} config.asset referenceType asset requires assetId`,
                    retryable: false
                });
                continue;
            }
            if (referenceType === 'uri' && !hasUri) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_URI_REQUIRES_URI',
                    detail: `Node ${node.nodeId} config.asset referenceType uri requires uri`,
                    retryable: false
                });
                continue;
            }
            if (hasAssetId && typeof assetValue.assetId === 'string') {
                const metadata = await assetStore.getMetadata(assetValue.assetId);
                if (!metadata) {
                    errors.push({
                        code: 'DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND',
                        detail: `Node ${node.nodeId} references unknown assetId: ${assetValue.assetId}`,
                        retryable: false
                    });
                }
            }
            continue;
        }

        const referenceType = config.referenceType;
        const assetId = typeof config.assetId === 'string' ? config.assetId : undefined;
        const uri = typeof config.uri === 'string' ? config.uri : undefined;
        const hasAssetId = typeof assetId === 'string' && assetId.trim().length > 0;
        const hasUri = typeof uri === 'string' && uri.trim().length > 0;
        if (!hasAssetId && !hasUri) {
            continue;
        }
        if (hasAssetId === hasUri) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED',
                detail: `Node ${node.nodeId} config must provide exactly one of assetId or uri`,
                retryable: false
            });
            continue;
        }
        if (referenceType === 'asset' && !hasAssetId) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_ASSET_REQUIRES_ASSET_ID',
                detail: `Node ${node.nodeId} referenceType asset requires assetId`,
                retryable: false
            });
            continue;
        }
        if (referenceType === 'uri' && !hasUri) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_URI_REQUIRES_URI',
                detail: `Node ${node.nodeId} referenceType uri requires uri`,
                retryable: false
            });
            continue;
        }
        if (hasAssetId && typeof assetId === 'string') {
            const metadata = await assetStore.getMetadata(assetId);
            if (!metadata) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND',
                    detail: `Node ${node.nodeId} references unknown assetId: ${assetId}`,
                    retryable: false
                });
            }
        }
    }
    return errors;
}

function createManifestRegistryFromManifests(manifests: INodeManifest[]): INodeManifestRegistry {
    const manifestByNodeType = new Map<string, INodeManifest>(
        manifests.map((manifest) => [manifest.nodeType, manifest])
    );
    return {
        getManifest: (nodeType: string) => manifestByNodeType.get(nodeType),
        listManifests: () => manifests
    };
}

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
                    uri: 'file://sample-image.png',
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

export async function startDagServer(options: IDagServerBootstrapOptions): Promise<void> {
    const corsOrigins = options.corsOrigins ?? DEFAULT_CORS_ORIGINS;
    const requestBodyLimit = options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT;
    const defaultWorkerTimeoutMs = options.defaultWorkerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
    const port = options.port ?? DEFAULT_PORT;

    const assetStore = options.assetStore;
    if (assetStore.initialize) {
        await assetStore.initialize();
    }

    const app = express();
    app.use(cors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id']
    }));
    app.use(express.json({ limit: requestBodyLimit }));

    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const deadLetterQueue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new SystemClockPort();
    const manifestRegistry = createManifestRegistryFromManifests(options.nodeManifests);
    const lifecycleExecutor = new LifecycleTaskExecutorPort(manifestRegistry, options.nodeLifecycleFactory);
    const executor = new AssetAwareTaskExecutorPort(lifecycleExecutor, assetStore);

    const controllers = createDagControllerComposition(
        {
            storage,
            queue,
            deadLetterQueue,
            clock
        },
        {
            diagnosticsPolicy: {
                reinjectEnabled: false
            },
            nodeCatalogService: options.nodeCatalogService
        }
    );
    const execution = createDagExecutionComposition(
        {
            storage,
            queue,
            deadLetterQueue,
            lease,
            executor,
            clock
        },
        {
            worker: {
                workerId: 'dag-dev-worker-1',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                maxAttempts: 1,
                defaultTimeoutMs: defaultWorkerTimeoutMs,
                retryEnabled: false,
                deadLetterEnabled: true
            }
        }
    );
    const dagRunService = new DagRunService({
        storage,
        execution,
        clock
    });
    const sseClientsByDagRunId = new Map<string, Set<Response>>();
    execution.runProgressEventBus.subscribe((event: TRunProgressEvent) => {
        const clients = sseClientsByDagRunId.get(event.dagRunId);
        if (!clients || clients.size === 0) {
            return;
        }
        const payload = JSON.stringify({ event });
        for (const client of clients) {
            client.write(`data: ${payload}\n\n`);
        }
    });

    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            service: 'robota-dag-dev-server',
            timestamp: new Date().toISOString()
        });
    });

    app.post('/v1/dag/dev/bootstrap', async (_req: Request, res: Response) => {
        const definition = createSampleDefinition('dag-dev-sample', 1);
        const created = await controllers.design.createDefinition({
            definition,
            correlationId: 'dag-dev-bootstrap-create'
        });
        if (!created.ok) {
            res.status(created.status).json(created);
            return;
        }

        const published = await controllers.design.publishDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: 'dag-dev-bootstrap-publish'
        });
        if (!published.ok) {
            res.status(published.status).json(published);
            return;
        }

        res.status(201).json({
            ok: true,
            status: 201,
            data: {
                definitionId: `${definition.dagId}:${definition.version}`,
                dagId: definition.dagId,
                version: definition.version
            }
        });
    });

    app.post('/v1/dag/definitions', async (req: Request<unknown, unknown, ICreateDefinitionBody>, res: Response) => {
        const assetValidationErrors = await validateAssetReferences(req.body.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: assetValidationErrors
            });
            return;
        }
        const created = await controllers.design.createDefinition({
            definition: req.body.definition,
            correlationId: 'dag-dev-design-create'
        });
        res.status(created.status).json(created);
    });

    app.put('/v1/dag/definitions/:dagId/draft', async (
        req: Request<{ dagId: string }, unknown, IUpdateDraftBody>,
        res: Response
    ) => {
        const assetValidationErrors = await validateAssetReferences(req.body.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: assetValidationErrors
            });
            return;
        }
        const updated = await controllers.design.updateDraft({
            dagId: req.params.dagId,
            version: req.body.version,
            definition: req.body.definition,
            correlationId: 'dag-dev-design-update'
        });
        res.status(updated.status).json(updated);
    });

    app.post('/v1/dag/definitions/:dagId/validate', async (
        req: Request<{ dagId: string }, unknown, IVersionBody>,
        res: Response
    ) => {
        const existing = await controllers.design.getDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: 'dag-dev-design-get-for-asset-validate'
        });
        if (!existing.ok) {
            res.status(existing.status).json(existing);
            return;
        }
        const assetValidationErrors = await validateAssetReferences(existing.data.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: assetValidationErrors
            });
            return;
        }
        const validated = await controllers.design.validateDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: 'dag-dev-design-validate'
        });
        res.status(validated.status).json(validated);
    });

    app.post('/v1/dag/definitions/:dagId/publish', async (
        req: Request<{ dagId: string }, unknown, IVersionBody>,
        res: Response
    ) => {
        const published = await controllers.design.publishDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: 'dag-dev-design-publish'
        });
        res.status(published.status).json(published);
    });

    app.get('/v1/dag/nodes', async (_req: Request, res: Response) => {
        const listed = await controllers.design.listNodeCatalog({
            correlationId: 'dag-dev-nodes-list'
        });
        res.status(listed.status).json(listed);
    });

    app.post('/v1/dag/runs', async (
        req: Request<unknown, unknown, ICreateRunBody>,
        res: Response
    ) => {
        const runInstance = '/v1/dag/runs';
        const definition = req.body?.definition;
        if (!definition || typeof definition !== 'object') {
            res.status(400).json({
                ok: false,
                status: 400,
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
        if (typeof input !== 'undefined' && (typeof input !== 'object' || input === null)) {
            res.status(400).json({
                ok: false,
                status: 400,
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
            res.status(400).json({
                ok: false,
                status: 400,
                errors: assetValidationErrors.map((error) => toRunProblemDetails(error, runInstance))
            });
            return;
        }
        const created = await dagRunService.createRun(definition, input ?? {});
        if (!created.ok) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [toProblemDetails(created.error, runInstance)]
            });
            return;
        }
        res.status(201).json({
            ok: true,
            status: 201,
            data: {
                dagRunId: created.value.dagRunId
            }
        });
    });

    app.post('/v1/dag/runs/:dagRunId/start', async (
        req: Request<IRunParams>,
        res: Response
    ) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}/start`;
        const started = await dagRunService.startRunById(req.params.dagRunId);
        if (!started.ok) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [toProblemDetails(started.error, instance)]
            });
            return;
        }
        res.status(202).json({
            ok: true,
            status: 202,
            data: {
                dagRunId: started.value.dagRunId
            }
        });
    });

    app.get('/v1/dag/runs/:dagRunId/result', async (
        req: Request<IRunParams>,
        res: Response
    ) => {
        const instance = `/v1/dag/runs/${req.params.dagRunId}/result`;
        const result = await dagRunService.getRunResult(req.params.dagRunId);
        if (!result.ok) {
            const problem = toProblemDetails(result.error, instance);
            const statusCode = result.error.code === 'DAG_VALIDATION_RUN_NOT_TERMINAL' ? 409 : 400;
            res.status(statusCode).json({
                ok: false,
                status: statusCode,
                errors: [problem]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: {
                run: result.value
            }
        });
    });

    app.delete('/v1/dag/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const deleted = await dagRunService.deleteRunArtifacts(req.params.dagRunId);
        if (!deleted.ok) {
            res.status(404).json({
                ok: false,
                status: 404,
                errors: [deleted.error]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: deleted.value
        });
    });

    app.delete('/v1/dag/dev/definitions/:dagId', async (
        req: Request<{ dagId: string }, unknown, unknown, IDeleteDefinitionArtifactsQuery>,
        res: Response
    ) => {
        const versionValue = req.query.version;
        const parsedVersion = typeof versionValue === 'string' && versionValue.trim().length > 0
            ? Number.parseInt(versionValue, 10)
            : undefined;
        const version = Number.isFinite(parsedVersion) ? parsedVersion : undefined;
        const deleted = await dagRunService.deleteDefinitionArtifacts(req.params.dagId, version);
        if (!deleted.ok) {
            res.status(404).json({
                ok: false,
                status: 404,
                errors: [deleted.error]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: deleted.value
        });
    });

    app.delete('/v1/dag/runs/temporary-copies', async (_req: Request, res: Response) => {
        const deleted = await dagRunService.deleteRunCopyArtifacts();
        if (!deleted.ok) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [deleted.error]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: deleted.value
        });
    });

    app.post('/v1/dag/dev/llm-text/complete', async (
        req: Request<unknown, unknown, ILlmCompleteBody>,
        res: Response
    ) => {
        const llmCompletionClient = options.llmCompletionClient;
        if (!llmCompletionClient) {
            res.status(500).json({
                ok: false,
                status: 500,
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
            res.status(400).json({
                ok: false,
                status: 400,
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
            res.status(400).json({
                ok: false,
                status: 400,
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
            res.status(400).json({
                ok: false,
                status: 400,
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
            res.status(400).json({
                ok: false,
                status: 400,
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
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [completionResult.error]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: {
                completion: completionResult.value,
                modelSelection: resolvedSelectionResult.value
            }
        });
    });

    app.post('/v1/dag/assets', async (
        req: Request<unknown, unknown, ICreateAssetBody>,
        res: Response
    ) => {
        const body = req.body;
        if (!body || typeof body.fileName !== 'string' || body.fileName.trim().length === 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_FILENAME_REQUIRED',
                        detail: 'fileName is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof body.mediaType !== 'string' || body.mediaType.trim().length === 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_MEDIATYPE_REQUIRED',
                        detail: 'mediaType is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof body.base64Data !== 'string' || body.base64Data.trim().length === 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_BASE64_REQUIRED',
                        detail: 'base64Data is required',
                        retryable: false
                    }
                ]
            });
            return;
        }

        try {
            const content = Buffer.from(body.base64Data, 'base64');
            if (content.byteLength === 0) {
                res.status(400).json({
                    ok: false,
                    status: 400,
                    errors: [
                        {
                            code: 'DAG_VALIDATION_ASSET_EMPTY_CONTENT',
                            detail: 'Decoded asset content must not be empty',
                            retryable: false
                        }
                    ]
                });
                return;
            }
            const metadata = await assetStore.save({
                fileName: body.fileName,
                mediaType: body.mediaType,
                content
            });
            res.status(201).json({
                ok: true,
                status: 201,
                data: {
                    asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId))
                }
            });
        } catch {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_BASE64_INVALID',
                        detail: 'base64Data must be a valid base64 encoded string',
                        retryable: false
                    }
                ]
            });
        }
    });

    app.get('/v1/dag/assets/:assetId', async (
        req: Request<{ assetId: string }>,
        res: Response
    ) => {
        const metadata = await assetStore.getMetadata(req.params.assetId);
        if (!metadata) {
            res.status(404).json({
                ok: false,
                status: 404,
                errors: [
                    {
                        code: 'DAG_ASSET_NOT_FOUND',
                        detail: `Asset not found: ${req.params.assetId}`,
                        retryable: false
                    }
                ]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: {
                asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId))
            }
        });
    });

    app.get('/v1/dag/assets/:assetId/content', async (
        req: Request<{ assetId: string }>,
        res: Response
    ) => {
        const contentResult = await assetStore.getContent(req.params.assetId);
        if (!contentResult) {
            res.status(404).json({
                ok: false,
                status: 404,
                errors: [
                    {
                        code: 'DAG_ASSET_NOT_FOUND',
                        detail: `Asset not found: ${req.params.assetId}`,
                        retryable: false
                    }
                ]
            });
            return;
        }
        res.setHeader('Content-Type', contentResult.metadata.mediaType);
        res.setHeader('Content-Disposition', `inline; filename="${contentResult.metadata.fileName}"`);
        contentResult.stream.pipe(res);
    });

    app.get('/v1/dag/definitions/:dagId', async (
        req: Request<{ dagId: string }, unknown, unknown, IGetDefinitionQuery>,
        res: Response
    ) => {
        const versionValue = req.query.version;
        const parsedVersion = typeof versionValue === 'string' && versionValue.trim().length > 0
            ? Number.parseInt(versionValue, 10)
            : undefined;
        const definition = await controllers.design.getDefinition({
            dagId: req.params.dagId,
            version: Number.isFinite(parsedVersion) ? parsedVersion : undefined,
            correlationId: 'dag-dev-design-get'
        });
        res.status(definition.status).json(definition);
    });

    app.get('/v1/dag/definitions', async (
        req: Request<unknown, unknown, unknown, IListDefinitionsQuery>,
        res: Response
    ) => {
        const listed = await controllers.design.listDefinitions({
            dagId: req.query.dagId,
            correlationId: 'dag-dev-design-list'
        });
        res.status(listed.status).json(listed);
    });

    app.get('/v1/dag/runs/:dagRunId/events', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const dagRunId = req.params.dagRunId;
        const emitSseEvent = (event: TRunProgressEvent): void => {
            const payload = JSON.stringify({ event });
            res.write(`data: ${payload}\n\n`);
        };
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.write(':\n\n');

        const keepAliveTimer = setInterval(() => {
            res.write(':\n\n');
        }, 15_000);
        const clients = sseClientsByDagRunId.get(dagRunId) ?? new Set<Response>();
        clients.add(res);
        sseClientsByDagRunId.set(dagRunId, clients);

        const queried = await execution.runQuery.getRun(dagRunId);
        if (queried.ok) {
            const snapshotDagRun = queried.value.dagRun;
            for (const taskRun of queried.value.taskRuns) {
                const input = parseTaskRunPayloadSnapshot(taskRun.inputSnapshot);
                const output = parseTaskRunPayloadSnapshot(taskRun.outputSnapshot);
                if (
                    taskRun.status === TASK_EVENTS.RUNNING
                    || taskRun.status === TASK_EVENTS.SUCCESS
                    || taskRun.status === TASK_EVENTS.FAILED
                    || taskRun.status === TASK_EVENTS.UPSTREAM_FAILED
                    || taskRun.status === TASK_EVENTS.CANCELLED
                ) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.STARTED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input
                    });
                }
                if (taskRun.status === TASK_EVENTS.SUCCESS) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.COMPLETED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input,
                        output
                    });
                }
                if (
                    taskRun.status === TASK_EVENTS.FAILED
                    || taskRun.status === TASK_EVENTS.UPSTREAM_FAILED
                    || taskRun.status === TASK_EVENTS.CANCELLED
                ) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.FAILED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input,
                        output,
                        error: {
                            code: taskRun.errorCode ?? 'DAG_TASK_EXECUTION_FAILED',
                            category: 'task_execution',
                            message: taskRun.errorMessage ?? `Task finished with status ${taskRun.status}.`,
                            retryable: false
                        }
                    });
                }
            }
            if (snapshotDagRun.status === 'success') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.COMPLETED,
                    occurredAt: clock.nowIso()
                });
            } else if (snapshotDagRun.status === 'failed' || snapshotDagRun.status === 'cancelled') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
                    occurredAt: clock.nowIso(),
                    error: {
                        code: 'DAG_RUN_FAILED',
                        category: 'task_execution',
                        message: `Run is already in terminal status: ${snapshotDagRun.status}`,
                        retryable: false,
                        context: { dagRunId, status: snapshotDagRun.status }
                    }
                });
            } else if (snapshotDagRun.status === 'queued' || snapshotDagRun.status === 'running') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
                    occurredAt: clock.nowIso(),
                    dagId: snapshotDagRun.dagId,
                    version: snapshotDagRun.version
                });
            }
        }

        req.on('close', () => {
            clearInterval(keepAliveTimer);
            const subscribedClients = sseClientsByDagRunId.get(dagRunId);
            if (!subscribedClients) {
                return;
            }
            subscribedClients.delete(res);
            if (subscribedClients.size === 0) {
                sseClientsByDagRunId.delete(dagRunId);
            }
        });
    });

    app.post('/v1/dag/dev/workers/process-once', async (_req: Request, res: Response) => {
        const processed = await execution.workerLoop.processOnce();
        if (!processed.ok) {
            res.status(500).json({
                ok: false,
                status: 500,
                errors: [processed.error]
            });
            return;
        }
        res.status(200).json({
            ok: true,
            status: 200,
            data: processed.value
        });
    });

    app.get('/v1/dag/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const queried = await controllers.runtime.queryRun({
            dagRunId: req.params.dagRunId,
            correlationId: 'dag-dev-query-run'
        });
        res.status(queried.status).json(queried);
    });

    app.get('/v1/dag/dev/observability/:dagRunId/dashboard', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const dashboard = await controllers.observability.queryDashboard({
            dagRunId: req.params.dagRunId,
            correlationId: 'dag-dev-dashboard'
        });
        res.status(dashboard.status).json(dashboard);
    });

    app.listen(port, () => {
        process.stdout.write(`DAG dev server started at http://localhost:${port}\n`);
    });
}
