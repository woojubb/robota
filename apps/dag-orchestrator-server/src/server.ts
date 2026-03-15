import dotenv from 'dotenv';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'node:http';
import {
    FileStoragePort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import {
    createDagControllerComposition,
} from '@robota-sdk/dag-api';
import {
    HttpPromptApiClient,
    PromptOrchestratorService,
    OrchestratorRunService,
} from '@robota-sdk/dag-orchestrator';
import type {
    ICostPolicyEvaluatorPort,
} from '@robota-sdk/dag-orchestrator';
import { CelCostEstimatorAdapter } from '@robota-sdk/dag-orchestrator';
import { CelCostEvaluator } from '@robota-sdk/dag-cost';
import { FileCostMetaStorage } from '@robota-sdk/dag-adapters-local';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js';

import { registerDefinitionRoutes } from './routes/definition-routes.js';
import { registerRunRoutes } from './routes/run-routes.js';
import { registerAssetRoutes } from './routes/asset-routes.js';
import { registerWsRoutes } from './routes/ws-routes.js';
import { registerAdminRoutes } from './routes/admin-routes.js';
import { registerRuntimeAssetRoutes } from './routes/runtime-asset-routes.js';
import { registerCostMetaRoutes } from './routes/cost-meta-routes.js';

dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

const DEFAULT_PORT = 3012;

function resolvePort(): number {
    const raw = process.env.ORCHESTRATOR_PORT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return DEFAULT_PORT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('ORCHESTRATOR_PORT must be a positive integer when provided.');
    }
    return parsed;
}

function resolveBackendUrl(): string {
    const raw = process.env.BACKEND_URL;
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim().replace(/\/$/, '');
    }
    return 'http://127.0.0.1:8188'; // ComfyUI default port
}

function parseCorsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return ['http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

const stubCostPolicyEvaluator: ICostPolicyEvaluatorPort = {
    evaluate() {
        return { ok: true, value: undefined };
    }
};

async function bootstrapOrchestratorServer(): Promise<void> {
    const costMetaDir = process.env.COST_META_DIR
        ? path.resolve(process.env.COST_META_DIR)
        : path.resolve(process.cwd(), 'data');
    const costMetaStorage = new FileCostMetaStorage(costMetaDir);
    const celCostEvaluator = new CelCostEvaluator();
    const costEstimator = new CelCostEstimatorAdapter(costMetaStorage);

    const backendUrl = resolveBackendUrl();
    const apiClient = new HttpPromptApiClient(backendUrl);
    const orchestrator = new PromptOrchestratorService(
        apiClient,
        costEstimator,
        stubCostPolicyEvaluator,
    );
    const runService = new OrchestratorRunService(apiClient);

    const dagStorageRoot = process.env.DAG_STORAGE_ROOT
        ? path.resolve(process.env.DAG_STORAGE_ROOT)
        : path.resolve(process.cwd(), '.dag-storage');
    const storage = new FileStoragePort(dagStorageRoot);
    const queue = new InMemoryQueuePort();
    const deadLetterQueue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new SystemClockPort();

    const controllers = createDagControllerComposition(
        { storage, queue, deadLetterQueue, lease, clock },
        {
            diagnosticsPolicy: { reinjectEnabled: false }
        }
    );

    const assetStoreRoot = process.env.ASSET_STORAGE_ROOT
        ? path.resolve(process.env.ASSET_STORAGE_ROOT)
        : path.resolve(process.cwd(), '.local-assets');
    const assetStore = new LocalFsAssetStore(assetStoreRoot);
    await assetStore.initialize();

    const app = express();
    app.use(cors({
        origin: parseCorsOrigins(),
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
        credentials: true
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
    app.use(express.json({ limit: '15mb' }));

    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            service: 'dag-orchestrator-server',
            backend: backendUrl,
            timestamp: new Date().toISOString()
        });
    });

    const server = http.createServer(app);

    // Robota API routes
    registerDefinitionRoutes(app, controllers.design, assetStore);
    registerRunRoutes(app, runService, assetStore, backendUrl);
    registerAssetRoutes(app, assetStore);
    registerWsRoutes(server, runService, backendUrl);
    registerAdminRoutes(app, controllers.design);

    // Cost meta CRUD + validate/preview
    registerCostMetaRoutes(app, costMetaStorage, celCostEvaluator);

    // Runtime asset mapped routes (validated forwarding, not blind proxy)
    registerRuntimeAssetRoutes(app, backendUrl);

    // Orchestration proxy routes (ComfyUI compat passthrough)
    app.post('/prompt', async (req, res) => {
        const result = await orchestrator.submitPrompt({
            promptRequest: req.body,
            config: req.body._orchestrator,
        });
        if (!result.ok) { res.status(400).json({ error: result.error }); return; }
        res.json(result.value.promptResponse);
    });

    app.get('/queue', async (_req, res) => {
        const result = await orchestrator.getQueue();
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    app.get('/history', async (_req, res) => {
        const result = await orchestrator.getHistory();
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    app.get('/history/:promptId', async (req, res) => {
        const result = await orchestrator.getHistory(req.params.promptId);
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    app.get('/object_info', async (_req, res) => {
        const result = await orchestrator.getObjectInfo();
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    app.get('/object_info/:nodeType', async (req, res) => {
        const result = await orchestrator.getObjectInfo(req.params.nodeType);
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    // Robota API: node catalog via object_info proxy
    app.get('/v1/dag/nodes', async (_req: Request, res: Response) => {
        const result = await orchestrator.getObjectInfo();
        if (!result.ok) {
            res.status(502).json({ ok: false, error: result.error });
            return;
        }
        res.json({ ok: true, status: 200, data: result.value });
    });

    app.get('/system_stats', async (_req, res) => {
        const result = await orchestrator.getSystemStats();
        if (!result.ok) { res.status(502).json({ error: result.error }); return; }
        res.json(result.value);
    });

    const port = resolvePort();
    server.listen(port, () => {
        process.stdout.write(`DAG orchestrator server started at http://localhost:${port}\n`);
        process.stdout.write(`Backend: ${backendUrl}\n`);
    });

    const shutdown = (): void => {
        process.stdout.write('Shutting down dag-orchestrator-server...\n');
        server.close(() => {
            process.exit(0);
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

void bootstrapOrchestratorServer();
