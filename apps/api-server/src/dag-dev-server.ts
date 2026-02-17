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
import { BundledNodeCatalogService } from './services/bundled-node-catalog-service.js';
import { createRobotaLlmCompletionClientFromEnv } from './services/robota-llm-completion-client.js';
import { LocalFsAssetStore } from './services/local-fs-asset-store.js';
import { createRobotaGeminiImageClientFromEnv } from './services/robota-gemini-image-client.js';
import { startDagServer } from './dag-server-bootstrap.js';

dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

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
        llmCompletionClient
    });
}

void bootstrapDagDevServer();
