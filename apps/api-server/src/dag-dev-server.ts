import dotenv from 'dotenv';
import {
    createDefaultNodeLifecycleFactory,
    createDefaultNodeManifestRegistry
} from '@robota-sdk/dag-core';
import { BundledNodeCatalogService } from './services/bundled-node-catalog-service.js';
import { startDagServer } from './dag-server-bootstrap.js';

dotenv.config();

const defaultManifests = createDefaultNodeManifestRegistry().listManifests();
const defaultLifecycleFactory = createDefaultNodeLifecycleFactory();
const defaultNodeCatalogService = new BundledNodeCatalogService(defaultManifests);

void startDagServer({
    nodeManifests: defaultManifests,
    nodeLifecycleFactory: defaultLifecycleFactory,
    nodeCatalogService: defaultNodeCatalogService
});
