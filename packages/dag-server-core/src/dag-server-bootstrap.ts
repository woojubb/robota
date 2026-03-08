import express, { type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import {
    LifecycleTaskExecutorPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    SystemClockPort,
    type INodeManifest,
    type INodeManifestRegistry,
    type TRunProgressEvent
} from '@robota-sdk/dag-core';
import {
    createDagControllerComposition,
    createDagExecutionComposition
} from '@robota-sdk/dag-api';
import { DAG_OPENAPI_DOCUMENT } from './docs/openapi-dag.js';
import { AssetAwareTaskExecutorPort } from './asset-aware-task-executor.js';
import { DagRunService } from './dag-run-service.js';
import { registerDefinitionRoutes } from './routes/definition-routes.js';
import { registerRunRoutes } from './routes/run-routes.js';
import { registerAssetRoutes } from './routes/asset-routes.js';
import { registerSseRoutes } from './routes/sse-routes.js';
import { registerDevRoutes } from './routes/dev-routes.js';
import {
    DEFAULT_PORT,
    DEFAULT_CORS_ORIGINS,
    DEFAULT_REQUEST_BODY_LIMIT,
    DEFAULT_WORKER_TIMEOUT_MS,
    DEFAULT_SSE_KEEP_ALIVE_MS
} from './routes/route-utils.js';

export type { IDagServerBootstrapOptions } from './routes/route-types.js';
export {
    parseOptionalPositiveIntegerQuery,
    parseTaskRunPayloadSnapshot,
    type TVersionQueryParseResult
} from './routes/route-utils.js';

/** Worker lease and visibility timeout in milliseconds. */
const WORKER_LEASE_DURATION_MS = 30_000;

/** Maximum task execution attempts. */
const WORKER_MAX_ATTEMPTS = 1;

/**
 * Creates a node manifest registry from an array of manifests.
 */
function createManifestRegistryFromManifests(manifests: INodeManifest[]): INodeManifestRegistry {
    const manifestByNodeType = new Map<string, INodeManifest>(
        manifests.map((manifest) => [manifest.nodeType, manifest])
    );
    return {
        getManifest: (nodeType: string) => manifestByNodeType.get(nodeType),
        listManifests: () => manifests
    };
}

/**
 * Starts the DAG development server with the provided options.
 * Wires all route groups, middleware, and infrastructure together.
 */
export async function startDagServer(options: import('./routes/route-types.js').IDagServerBootstrapOptions): Promise<void> {
    const corsOrigins = options.corsOrigins ?? DEFAULT_CORS_ORIGINS;
    const requestBodyLimit = options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT;
    const defaultWorkerTimeoutMs = options.defaultWorkerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
    const sseKeepAliveMs = options.sseKeepAliveMs ?? DEFAULT_SSE_KEEP_ALIVE_MS;
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

    const storage = options.storage ?? new InMemoryStoragePort();
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
            lease,
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
                leaseDurationMs: WORKER_LEASE_DURATION_MS,
                visibilityTimeoutMs: WORKER_LEASE_DURATION_MS,
                maxAttempts: WORKER_MAX_ATTEMPTS,
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
        for (const client of [...clients]) {
            try {
                client.write(`data: ${payload}\n\n`);
            } catch {
                clients.delete(client);
            }
        }
        if (clients.size === 0) {
            sseClientsByDagRunId.delete(event.dagRunId);
        }
    });

    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            service: 'robota-dag-dev-server',
            timestamp: new Date().toISOString()
        });
    });

    if (options.apiDocsEnabled !== false) {
        app.get('/docs/dag.json', (_req: Request, res: Response) => {
            res.status(200).json(DAG_OPENAPI_DOCUMENT);
        });
        app.use(
            '/docs/dag',
            swaggerUi.serve,
            swaggerUi.setup(DAG_OPENAPI_DOCUMENT)
        );
        app.get('/docs', (_req: Request, res: Response) => {
            res.status(200).json({
                title: 'Robota API Docs',
                documents: {
                    dagOpenApi: '/docs/dag.json',
                    dagSwaggerUi: '/docs/dag'
                }
            });
        });
    }

    registerDefinitionRoutes(app, controllers.design, assetStore);
    registerRunRoutes(app, dagRunService, controllers.runtime, controllers.observability, assetStore);
    registerAssetRoutes(app, assetStore);
    registerSseRoutes(app, sseClientsByDagRunId, execution.runQuery, clock, sseKeepAliveMs);
    registerDevRoutes(app, controllers.design, execution.workerLoop, options.llmCompletionClient);

    app.listen(port, () => {
        process.stdout.write(`DAG dev server started at http://localhost:${port}\n`);
    });
}
