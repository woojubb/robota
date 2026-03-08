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
import {
    startDagServer,
    BundledNodeCatalogService,
    FileStoragePort
} from '@robota-sdk/dag-server-core';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js';
import { resolveApiDocsEnabled } from './utils/env-flags.js';

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

function resolveDagStorageRoot(): string {
    const raw = process.env.DAG_STORAGE_ROOT;
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return path.resolve(raw.trim());
    }
    return path.resolve(process.cwd(), '.dag-storage');
}

async function bootstrapDagDevServer(): Promise<void> {
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
    const defaultNodeDefinitionAssembly = assemblyResult.value;
    const defaultLifecycleFactory = new StaticNodeLifecycleFactory(
        new StaticNodeTaskHandlerRegistry(defaultNodeDefinitionAssembly.handlersByType)
    );
    const defaultNodeCatalogService = new BundledNodeCatalogService(defaultNodeDefinitionAssembly.manifests);

    await startDagServer({
        nodeManifests: defaultNodeDefinitionAssembly.manifests,
        nodeLifecycleFactory: defaultLifecycleFactory,
        nodeCatalogService: defaultNodeCatalogService,
        assetStore,
        storage,
        port: resolvePort(),
        corsOrigins: parseCorsOrigins(),
        requestBodyLimit: resolveRequestBodyLimit(),
        defaultWorkerTimeoutMs: resolveDefaultWorkerTimeoutMs(),
        apiDocsEnabled: resolveApiDocsEnabled(process.env.API_DOCS_ENABLED),
        sseKeepAliveMs: resolveSseKeepAliveMs()
    });
}

void bootstrapDagDevServer();
