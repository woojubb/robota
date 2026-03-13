import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import {
    HttpPromptApiClient,
    PromptOrchestratorService,
} from '@robota-sdk/dag-orchestrator';
import type {
    ICostEstimatorPort,
    ICostPolicyEvaluatorPort,
} from '@robota-sdk/dag-orchestrator';

dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

function resolvePort(): number {
    const raw = process.env.ORCHESTRATOR_PORT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return 3012;
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
    return 'http://127.0.0.1:3011';
}

function parseCorsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return ['http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Stub cost estimator — returns zero cost. Replace with real implementation. */
const stubCostEstimator: ICostEstimatorPort = {
    async estimateCost() {
        return { ok: true, value: { totalCostUsd: 0, breakdown: [] } };
    }
};

/** Stub cost policy evaluator — always approves. Replace with real implementation. */
const stubCostPolicyEvaluator: ICostPolicyEvaluatorPort = {
    evaluate() {
        return { ok: true, value: undefined };
    }
};

async function bootstrapOrchestratorServer(): Promise<void> {
    const backendUrl = resolveBackendUrl();
    const apiClient = new HttpPromptApiClient(backendUrl);
    const orchestrator = new PromptOrchestratorService(
        apiClient,
        stubCostEstimator,
        stubCostPolicyEvaluator,
    );

    const app = express();
    app.use(cors({ origin: parseCorsOrigins(), credentials: true }));
    app.use(express.json({ limit: '10mb' }));

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'robota-dag-orchestrator-server',
            backend: backendUrl,
            timestamp: new Date().toISOString()
        });
    });

    app.post('/prompt', async (req, res) => {
        const result = await orchestrator.submitPrompt({
            promptRequest: req.body,
            config: req.body._orchestrator,
        });
        if (!result.ok) {
            res.status(400).json({ error: result.error });
            return;
        }
        res.json(result.value.promptResponse);
    });

    app.get('/queue', async (_req, res) => {
        const result = await orchestrator.getQueue();
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    app.post('/queue', async (req, res) => {
        const result = await orchestrator.manageQueue(req.body);
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json({});
    });

    app.get('/history', async (_req, res) => {
        const result = await orchestrator.getHistory();
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    app.get('/history/:promptId', async (req, res) => {
        const result = await orchestrator.getHistory(req.params.promptId);
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    app.get('/object_info', async (_req, res) => {
        const result = await orchestrator.getObjectInfo();
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    app.get('/object_info/:nodeType', async (req, res) => {
        const result = await orchestrator.getObjectInfo(req.params.nodeType);
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    app.get('/system_stats', async (_req, res) => {
        const result = await orchestrator.getSystemStats();
        if (!result.ok) {
            res.status(502).json({ error: result.error });
            return;
        }
        res.json(result.value);
    });

    const port = resolvePort();
    const server = http.createServer(app);
    server.listen(port, () => {
        console.log(`DAG Orchestrator Server listening on port ${port}`);
        console.log(`Backend: ${backendUrl}`);
    });

    process.on('SIGTERM', () => {
        server.close();
        process.exit(0);
    });
    process.on('SIGINT', () => {
        server.close();
        process.exit(0);
    });
}

void bootstrapOrchestratorServer();
