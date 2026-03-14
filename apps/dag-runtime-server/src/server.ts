import dotenv from 'dotenv';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {
    LifecycleTaskExecutorPort,
    type IDagNodeDefinition,
    type INodeManifest,
    type INodeManifestRegistry,
} from '@robota-sdk/dag-core';
import {
    InMemoryLeasePort,
    InMemoryQueuePort,
    SystemClockPort,
} from '@robota-sdk/dag-adapters-memory';
import {
    buildNodeDefinitionAssembly,
    StaticNodeLifecycleFactory,
    StaticNodeTaskHandlerRegistry,
} from '@robota-sdk/dag-node';
import {
    createDagExecutionComposition,
    PromptApiController,
} from '@robota-sdk/dag-api';
import { InputNodeDefinition } from '@robota-sdk/dag-node-input';
import { TransformNodeDefinition } from '@robota-sdk/dag-node-transform';
import { LlmTextOpenAiNodeDefinition } from '@robota-sdk/dag-node-llm-text-openai';
import { ImageLoaderNodeDefinition } from '@robota-sdk/dag-node-image-loader';
import { ImageSourceNodeDefinition } from '@robota-sdk/dag-node-image-source';
import { OkEmitterNodeDefinition } from '@robota-sdk/dag-node-ok-emitter';
import { TextOutputNodeDefinition } from '@robota-sdk/dag-node-text-output';
import { TextTemplateNodeDefinition } from '@robota-sdk/dag-node-text-template';
import {
    GeminiImageComposeNodeDefinition,
    GeminiImageEditNodeDefinition
} from '@robota-sdk/dag-node-gemini-image-edit';
import { SeedanceVideoNodeDefinition } from '@robota-sdk/dag-node-seedance-video';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js';
import { FileStoragePort } from './services/file-storage-port.js';
import { AssetAwareTaskExecutorPort } from './services/asset-aware-task-executor.js';
import { DagPromptBackend } from './adapters/dag-prompt-backend.js';
import { mountPromptRoutes } from './routes/prompt-routes.js';
import { mountAssetRoutes } from './routes/asset-routes.js';
import { mountWsRoutes } from './routes/ws-routes.js';
import { resolveApiDocsEnabled } from './utils/env-flags.js';

dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

const WORKER_LEASE_DURATION_MS = 30_000;
const WORKER_MAX_ATTEMPTS = 1;
const DEFAULT_PORT = 3011;
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000'];
const DEFAULT_REQUEST_BODY_LIMIT = '15mb';
const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

function parseCorsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return DEFAULT_CORS_ORIGINS;
    }
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function resolveRequestBodyLimit(): string {
    const raw = process.env.DAG_REQUEST_BODY_LIMIT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return DEFAULT_REQUEST_BODY_LIMIT;
    }
    return raw.trim();
}

function resolveDefaultWorkerTimeoutMs(): number {
    const raw = process.env.DAG_DEFAULT_TIMEOUT_MS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return DEFAULT_WORKER_TIMEOUT_MS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DAG_DEFAULT_TIMEOUT_MS must be a positive integer when provided.');
    }
    return parsed;
}

function resolvePort(): number {
    const raw = process.env.DAG_PORT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return DEFAULT_PORT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DAG_PORT must be a positive integer when provided.');
    }
    return parsed;
}

function resolveDagStorageRoot(): string {
    const raw = process.env.DAG_STORAGE_ROOT;
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return path.resolve(raw.trim());
    }
    return path.resolve(process.cwd(), '.dag-storage');
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

async function bootstrapRuntimeServer(): Promise<void> {
    const assetStoreRoot = process.env.ASSET_STORAGE_ROOT
        ? path.resolve(process.env.ASSET_STORAGE_ROOT)
        : path.resolve(process.cwd(), '.local-assets');
    const assetStore = new LocalFsAssetStore(assetStoreRoot);
    await assetStore.initialize();

    const storage = new FileStoragePort(resolveDagStorageRoot());

    const defaultNodeDefinitions: IDagNodeDefinition[] = [
        new InputNodeDefinition(),
        new TransformNodeDefinition(),
        new LlmTextOpenAiNodeDefinition(),
        new TextTemplateNodeDefinition(),
        new TextOutputNodeDefinition(),
        new ImageLoaderNodeDefinition(),
        new ImageSourceNodeDefinition(),
        new GeminiImageEditNodeDefinition(),
        new GeminiImageComposeNodeDefinition(),
        new SeedanceVideoNodeDefinition(),
        new OkEmitterNodeDefinition()
    ];
    const assemblyResult = buildNodeDefinitionAssembly(defaultNodeDefinitions);
    if (!assemblyResult.ok) {
        throw new Error(`Failed to build node definition assembly: ${assemblyResult.error.message}`);
    }
    const assembly = assemblyResult.value;

    const manifestRegistry = createManifestRegistryFromManifests(assembly.manifests);
    const lifecycleFactory = new StaticNodeLifecycleFactory(
        new StaticNodeTaskHandlerRegistry(assembly.handlersByType)
    );
    const lifecycleExecutor = new LifecycleTaskExecutorPort(manifestRegistry, lifecycleFactory);
    const executor = new AssetAwareTaskExecutorPort(lifecycleExecutor, assetStore);

    const queue = new InMemoryQueuePort();
    const deadLetterQueue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new SystemClockPort();

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
                workerId: 'dag-worker-1',
                leaseDurationMs: WORKER_LEASE_DURATION_MS,
                visibilityTimeoutMs: WORKER_LEASE_DURATION_MS,
                maxAttempts: WORKER_MAX_ATTEMPTS,
                defaultTimeoutMs: resolveDefaultWorkerTimeoutMs(),
                retryEnabled: false,
                deadLetterEnabled: true
            }
        }
    );

    const promptBackend = new DagPromptBackend({
        storage,
        execution,
        clock,
        manifests: assembly.manifests,
    });
    const promptController = new PromptApiController(promptBackend);

    const app = express();
    const corsOrigins = parseCorsOrigins();
    app.use(cors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id']
    }));
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'none'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        crossOriginResourcePolicy: { policy: 'same-origin' }
    }));
    app.use(express.json({ limit: resolveRequestBodyLimit() }));

    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            service: 'dag-runtime-server',
            timestamp: new Date().toISOString()
        });
    });

    mountPromptRoutes(app, promptController);
    mountAssetRoutes(app, assetStore);
    const httpServer = http.createServer(app);
    mountWsRoutes(httpServer, execution.runProgressEventBus, promptBackend);

    const port = resolvePort();
    httpServer.listen(port, () => {
        process.stdout.write(`DAG runtime server (Prompt API only) started at http://localhost:${port}\n`);
    });

    const shutdown = (): void => {
        process.stdout.write('Shutting down dag-runtime-server...\n');
        httpServer.close(() => {
            process.exit(0);
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

void bootstrapRuntimeServer();
