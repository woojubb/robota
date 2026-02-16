import express, { type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import {
    LifecycleTaskExecutorPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    SystemClockPort,
    type IAssetReference,
    type IDagDefinition,
    type INodeLifecycleFactory,
    type INodeManifest,
    type INodeManifestRegistry,
    type TPortPayload
} from '@robota-sdk/dag-core';
import {
    createDagControllerComposition,
    createDagExecutionComposition,
    type INodeCatalogService
} from '@robota-sdk/dag-api';
import { LocalFsAssetStore, type IStoredAssetMetadata } from './services/local-fs-asset-store.js';
import { AssetAwareTaskExecutorPort } from './services/asset-aware-task-executor.js';

interface ITriggerRequestBody {
    dagId: string;
    input?: TPortPayload;
    logicalDate?: string;
}

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

interface IAssetValidationError {
    code: string;
    detail: string;
    retryable: false;
}

export interface IDagServerBootstrapOptions {
    nodeManifests: INodeManifest[];
    nodeLifecycleFactory: INodeLifecycleFactory;
    nodeCatalogService: INodeCatalogService;
    port?: number;
}

function toAssetReference(metadata: IStoredAssetMetadata, contentUri: string): IAssetReference {
    return {
        referenceType: 'asset',
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: contentUri,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes
    };
}

function getAssetContentUri(req: Request, assetId: string): string {
    return `${req.protocol}://${req.get('host')}/v1/dag/assets/${assetId}/content`;
}

async function validateAssetReferences(
    definition: IDagDefinition,
    assetStore: LocalFsAssetStore
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
            if (hasAssetId) {
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
        const assetId = config.assetId;
        const uri = config.uri;
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
        if (hasAssetId) {
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
    const app = express();
    app.use(cors({
        origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id']
    }));
    app.use(express.json({ limit: '2mb' }));

    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const deadLetterQueue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new SystemClockPort();
    const manifestRegistry = createManifestRegistryFromManifests(options.nodeManifests);
    const lifecycleExecutor = new LifecycleTaskExecutorPort(manifestRegistry, options.nodeLifecycleFactory);
    const assetStoreRoot = process.env.ASSET_STORAGE_ROOT
        ? path.resolve(process.env.ASSET_STORAGE_ROOT)
        : path.resolve(process.cwd(), '.local-assets');
    const assetStore = new LocalFsAssetStore(assetStoreRoot);
    await assetStore.initialize();
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
                defaultTimeoutMs: 5_000,
                retryEnabled: false,
                deadLetterEnabled: true
            }
        }
    );

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

    app.post('/v1/dag/dev/runs', async (req: Request<unknown, unknown, ITriggerRequestBody>, res: Response) => {
        if (!req.body || typeof req.body.dagId !== 'string' || req.body.dagId.trim().length === 0) {
            res.status(400).json({
                ok: false,
                status: 400,
                errors: [
                    {
                        code: 'DAG_VALIDATION_EMPTY_DAG_ID',
                        detail: 'dagId is required',
                        retryable: false
                    }
                ]
            });
            return;
        }

        const triggered = await controllers.runtime.triggerRun({
            dagId: req.body.dagId,
            trigger: 'manual',
            logicalDate: req.body.logicalDate,
            input: req.body.input ?? {},
            correlationId: 'dag-dev-trigger'
        });
        res.status(triggered.status).json(triggered);
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

    app.get('/v1/dag/dev/runs/:dagRunId', async (req: Request<{ dagRunId: string }>, res: Response) => {
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

    const port = options.port ?? Number.parseInt(process.env.DAG_DEV_PORT ?? '3011', 10);
    app.listen(port, () => {
        process.stdout.write(`DAG dev server started at http://localhost:${port}\n`);
    });
}
