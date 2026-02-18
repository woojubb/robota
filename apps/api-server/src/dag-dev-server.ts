import dotenv from 'dotenv';
import path from 'node:path';
import {
    buildNodeDefinitionAssembly,
    type IDagNodeDefinition,
    StaticNodeLifecycleFactory,
    StaticNodeTaskHandlerRegistry
} from '@robota-sdk/dag-core';
import { InputNodeDefinition } from '@robota-sdk/dag-node-input';
import { TransformNodeDefinition } from '@robota-sdk/dag-node-transform';
import { LlmTextNodeDefinition } from '@robota-sdk/dag-node-llm-text';
import { ImageLoaderNodeDefinition } from '@robota-sdk/dag-node-image-loader';
import { ImageSourceNodeDefinition } from '@robota-sdk/dag-node-image-source';
import { OkEmitterNodeDefinition } from '@robota-sdk/dag-node-ok-emitter';
import { TextOutputNodeDefinition } from '@robota-sdk/dag-node-text-output';
import { TextTemplateNodeDefinition } from '@robota-sdk/dag-node-text-template';
import {
    GeminiImageComposeNodeDefinition,
    GeminiImageEditNodeDefinition
} from '@robota-sdk/dag-node-gemini-image-edit';
import {
    startDagServer,
    BundledNodeCatalogService
} from '@robota-sdk/dag-server-core';
import { createRobotaLlmCompletionClientFromEnv } from './services/robota-llm-completion-client.js';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js';
import { createRobotaGeminiImageClientFromEnv } from './services/robota-gemini-image-client.js';

dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

function parseCorsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return ['http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function resolveRequestBodyLimit(): string {
    const raw = process.env.DAG_REQUEST_BODY_LIMIT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return '15mb';
    }
    return raw.trim();
}

function resolveDefaultWorkerTimeoutMs(): number {
    const raw = process.env.DAG_DEFAULT_TIMEOUT_MS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return 30_000;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DAG_DEFAULT_TIMEOUT_MS must be a positive integer when provided.');
    }
    return parsed;
}

function resolvePort(): number {
    const raw = process.env.DAG_DEV_PORT;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return 3011;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DAG_DEV_PORT must be a positive integer when provided.');
    }
    return parsed;
}

function resolveApiDocsEnabled(): boolean {
    const raw = process.env.API_DOCS_ENABLED;
    if (typeof raw !== 'string') {
        return true;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

function resolveSseKeepAliveMs(): number {
    const raw = process.env.DAG_SSE_KEEPALIVE_MS;
    if (typeof raw === 'undefined' || raw.trim().length === 0) {
        return 15_000;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DAG_SSE_KEEPALIVE_MS must be a positive integer when provided.');
    }
    return parsed;
}

async function bootstrapDagDevServer(): Promise<void> {
    const llmCompletionClient = createRobotaLlmCompletionClientFromEnv();
    const assetStoreRoot = process.env.ASSET_STORAGE_ROOT
        ? path.resolve(process.env.ASSET_STORAGE_ROOT)
        : path.resolve(process.cwd(), '.local-assets');
    const assetStore = new LocalFsAssetStore(assetStoreRoot);
    await assetStore.initialize();

    const geminiImageClient = createRobotaGeminiImageClientFromEnv(assetStore);

    const defaultNodeDefinitions: IDagNodeDefinition[] = [
        new InputNodeDefinition(),
        new TransformNodeDefinition(),
        new LlmTextNodeDefinition({
            completionClient: llmCompletionClient
        }),
        new TextTemplateNodeDefinition(),
        new TextOutputNodeDefinition(),
        new ImageLoaderNodeDefinition(),
        new ImageSourceNodeDefinition(),
        new GeminiImageEditNodeDefinition({
            imageClient: geminiImageClient
        }),
        new GeminiImageComposeNodeDefinition({
            imageClient: geminiImageClient
        }),
        new OkEmitterNodeDefinition()
    ];
    const defaultNodeDefinitionAssembly = buildNodeDefinitionAssembly(defaultNodeDefinitions);
    const defaultLifecycleFactory = new StaticNodeLifecycleFactory(
        new StaticNodeTaskHandlerRegistry(defaultNodeDefinitionAssembly.handlersByType)
    );
    const defaultNodeCatalogService = new BundledNodeCatalogService(defaultNodeDefinitionAssembly.manifests);

    await startDagServer({
        nodeManifests: defaultNodeDefinitionAssembly.manifests,
        nodeLifecycleFactory: defaultLifecycleFactory,
        nodeCatalogService: defaultNodeCatalogService,
        assetStore,
        llmCompletionClient,
        port: resolvePort(),
        corsOrigins: parseCorsOrigins(),
        requestBodyLimit: resolveRequestBodyLimit(),
        defaultWorkerTimeoutMs: resolveDefaultWorkerTimeoutMs(),
        apiDocsEnabled: resolveApiDocsEnabled(),
        sseKeepAliveMs: resolveSseKeepAliveMs()
    });
}

void bootstrapDagDevServer();
