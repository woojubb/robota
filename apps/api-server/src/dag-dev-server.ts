import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import {
    LifecycleTaskExecutorPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    SystemClockPort,
    createDefaultNodeLifecycleFactory,
    createDefaultNodeManifestRegistry,
    type IDagDefinition,
    type TPortPayload
} from '@robota-sdk/dag-core';
import {
    createDagControllerComposition,
    createDagExecutionComposition
} from '@robota-sdk/dag-api';

dotenv.config();

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

async function startDagDevServer(): Promise<void> {
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
    const manifestRegistry = createDefaultNodeManifestRegistry();
    const lifecycleFactory = createDefaultNodeLifecycleFactory();
    const executor = new LifecycleTaskExecutorPort(manifestRegistry, lifecycleFactory);

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
            }
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

    const port = Number.parseInt(process.env.DAG_DEV_PORT ?? '3011', 10);
    app.listen(port, () => {
        process.stdout.write(`DAG dev server started at http://localhost:${port}\n`);
    });
}

void startDagDevServer();
