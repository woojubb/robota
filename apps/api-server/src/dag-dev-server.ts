import dotenv from 'dotenv';
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
import { BundledNodeCatalogService } from './services/bundled-node-catalog-service.js';
import { createRobotaLlmCompletionClientFromEnv } from './services/robota-llm-completion-client.js';
import { startDagServer } from './dag-server-bootstrap.js';

dotenv.config();

const llmCompletionClient = createRobotaLlmCompletionClientFromEnv();

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
    new OkEmitterNodeDefinition()
];
const defaultNodeDefinitionAssembly = buildNodeDefinitionAssembly(defaultNodeDefinitions);
const defaultLifecycleFactory = new StaticNodeLifecycleFactory(
    new StaticNodeTaskHandlerRegistry(defaultNodeDefinitionAssembly.handlersByType)
);
const defaultNodeCatalogService = new BundledNodeCatalogService(defaultNodeDefinitionAssembly.manifests);

void startDagServer({
    nodeManifests: defaultNodeDefinitionAssembly.manifests,
    nodeLifecycleFactory: defaultLifecycleFactory,
    nodeCatalogService: defaultNodeCatalogService,
    llmCompletionClient
});
