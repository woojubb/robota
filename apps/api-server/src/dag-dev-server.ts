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
import { BundledNodeCatalogService } from './services/bundled-node-catalog-service.js';
import { startDagServer } from './dag-server-bootstrap.js';

dotenv.config();

const defaultNodeDefinitions: IDagNodeDefinition[] = [
    new InputNodeDefinition(),
    new TransformNodeDefinition(),
    new LlmTextNodeDefinition(),
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
    nodeCatalogService: defaultNodeCatalogService
});
