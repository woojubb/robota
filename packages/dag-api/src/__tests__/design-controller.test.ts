import { describe, expect, it } from 'vitest';
import { DagDefinitionService, type IDagDefinition } from '@robota-sdk/dag-core';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-memory';
import { DagDesignController, type INodeCatalogService } from '../controllers/dag-design-controller.js';

function createMinimalDefinition(dagId = 'test-dag', version = 1): IDagDefinition {
    return {
        dagId,
        version,
        status: 'draft',
        nodes: [
            { nodeId: 'entry', nodeType: 'input', dependsOn: [], inputs: [], outputs: [], config: {} }
        ],
        edges: []
    };
}

describe('DagDesignController', () => {
    it('getDefinition returns 404 when definition not found', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));

        const result = await controller.getDefinition({ dagId: 'missing' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(404);
        }
    });

    it('getDefinition returns definition when found', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition(createMinimalDefinition());
        const controller = new DagDesignController(new DagDefinitionService(storage));

        const result = await controller.getDefinition({ dagId: 'test-dag', version: 1 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.definition.dagId).toBe('test-dag');
        }
    });

    it('listDefinitions returns items grouped by dagId', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition(createMinimalDefinition('dag-a', 1));
        await storage.saveDefinition({ ...createMinimalDefinition('dag-a', 2), status: 'published' });
        await storage.saveDefinition(createMinimalDefinition('dag-b', 1));
        const controller = new DagDesignController(new DagDefinitionService(storage));

        const result = await controller.listDefinitions({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.items).toHaveLength(2);
            const dagA = result.data.items.find((item) => item.dagId === 'dag-a');
            expect(dagA?.latestVersion).toBe(2);
            expect(dagA?.statuses).toContain('draft');
            expect(dagA?.statuses).toContain('published');
        }
    });

    it('listNodeCatalog returns error when no catalog service', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));

        const result = await controller.listNodeCatalog({});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(400);
        }
    });

    it('listNodeCatalog returns manifests when catalog configured', async () => {
        const storage = new InMemoryStoragePort();
        const catalog: INodeCatalogService = {
            listManifests: async () => [{ nodeType: 'input', displayName: 'Input', version: '1.0.0', inputs: [], outputs: [] }],
            hasNodeType: () => true
        };
        const controller = new DagDesignController(new DagDefinitionService(storage), catalog);

        const result = await controller.listNodeCatalog({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.nodes).toHaveLength(1);
        }
    });

    it('validateDefinition checks node types against catalog', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition({
            ...createMinimalDefinition(),
            nodes: [{ nodeId: 'entry', nodeType: 'unknown-type', dependsOn: [], inputs: [], outputs: [], config: {} }]
        });

        const catalog: INodeCatalogService = {
            listManifests: async () => [],
            hasNodeType: (nodeType: string) => nodeType === 'input'
        };
        const controller = new DagDesignController(new DagDefinitionService(storage), catalog);

        const result = await controller.validateDefinition({ dagId: 'test-dag', version: 1 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(400);
        }
    });

    it('validateDefinition returns 400 when definition not found with catalog', async () => {
        const storage = new InMemoryStoragePort();
        const catalog: INodeCatalogService = {
            listManifests: async () => [],
            hasNodeType: () => true
        };
        const controller = new DagDesignController(new DagDefinitionService(storage), catalog);

        const result = await controller.validateDefinition({ dagId: 'nonexistent', version: 1 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(400);
        }
    });
});
