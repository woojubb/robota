import { describe, expect, it } from 'vitest';
import { DagDefinitionService } from '@robota-sdk/dag-core';
import type { IDagDefinition, INodeManifest } from '@robota-sdk/dag-core';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { DagDesignController, type INodeCatalogService } from '../controllers/dag-design-controller.js';

function createDefinition(): IDagDefinition {
    return {
        dagId: 'dag-e2e',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: 'image_source_1',
                nodeType: 'image-source',
                dependsOn: [],
                config: {
                    asset: {
                        referenceType: 'uri',
                        uri: 'file://sample.png'
                    }
                },
                inputs: [],
                outputs: [
                    {
                        key: 'image',
                        label: 'Image',
                        order: 0,
                        type: 'binary',
                        binaryKind: 'image',
                        mimeTypes: ['image/png'],
                        required: true
                    }
                ]
            },
            {
                nodeId: 'ok_emitter_1',
                nodeType: 'ok-emitter',
                dependsOn: ['image_source_1'],
                config: {},
                inputs: [
                    {
                        key: 'image',
                        label: 'Image',
                        order: 0,
                        type: 'binary',
                        binaryKind: 'image',
                        mimeTypes: ['image/png'],
                        required: true
                    }
                ],
                outputs: [
                    {
                        key: 'status',
                        label: 'Status',
                        order: 0,
                        type: 'string',
                        required: true
                    }
                ]
            }
        ],
        edges: [
            {
                from: 'image_source_1',
                to: 'ok_emitter_1',
                bindings: [{ outputKey: 'image', inputKey: 'image' }]
            }
        ]
    };
}

describe('Dag design flow E2E', () => {
    it('runs create -> validate -> publish flow successfully', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));
        const definition = createDefinition();

        const created = await controller.createDefinition({
            definition,
            correlationId: 'corr-e2e-success'
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
            return;
        }
        expect(created.status).toBe(201);
        expect(created.data.definition.status).toBe('draft');

        const validated = await controller.validateDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: 'corr-e2e-validate'
        });
        expect(validated.ok).toBe(true);
        if (!validated.ok) {
            return;
        }
        expect(validated.data.valid).toBe(true);

        const published = await controller.publishDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: 'corr-e2e-publish'
        });
        expect(published.ok).toBe(true);
        if (!published.ok) {
            return;
        }
        expect(published.status).toBe(200);
        expect(published.data.definition.status).toBe('published');
    });

    it('returns validation errors for invalid definition in validate flow', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));
        const invalidDefinition = createDefinition();
        invalidDefinition.nodes = [];

        const created = await controller.createDefinition({
            definition: invalidDefinition,
            correlationId: 'corr-e2e-invalid-create'
        });
        expect(created.ok).toBe(true);

        const validated = await controller.validateDefinition({
            dagId: invalidDefinition.dagId,
            version: invalidDefinition.version,
            correlationId: 'corr-e2e-invalid-validate'
        });
        expect(validated.ok).toBe(false);
        if (validated.ok) {
            return;
        }

        expect(validated.errors.some((error) => error.code === 'DAG_VALIDATION_EMPTY_NODES')).toBe(true);
        expect(validated.errors.every((error) => error.status === 400)).toBe(true);
    });

    it('supports list and dagId-based load flow', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));
        const definition = createDefinition();

        const created = await controller.createDefinition({
            definition,
            correlationId: 'corr-e2e-list-create'
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
            return;
        }

        const listed = await controller.listDefinitions({
            correlationId: 'corr-e2e-list'
        });
        expect(listed.ok).toBe(true);
        if (!listed.ok) {
            return;
        }
        expect(listed.data.items.some((item) => item.dagId === definition.dagId)).toBe(true);

        const loadedByDagId = await controller.getDefinition({
            dagId: definition.dagId,
            correlationId: 'corr-e2e-load'
        });
        expect(loadedByDagId.ok).toBe(true);
        if (!loadedByDagId.ok) {
            return;
        }
        expect(loadedByDagId.data.definition.dagId).toBe(definition.dagId);
    });

    it('blocks validate for invalid binding without fallback', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagDesignController(new DagDefinitionService(storage));
        const definition = createDefinition();
        definition.edges[0] = {
            from: 'image_source_1',
            to: 'ok_emitter_1',
            bindings: [{ outputKey: 'image', inputKey: 'status' }]
        };

        const created = await controller.createDefinition({
            definition,
            correlationId: 'corr-e2e-invalid-binding-create'
        });
        expect(created.ok).toBe(true);

        const validated = await controller.validateDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: 'corr-e2e-invalid-binding-validate'
        });
        expect(validated.ok).toBe(false);
        if (validated.ok) {
            return;
        }
        expect(validated.errors.some((error) => error.code === 'DAG_VALIDATION_BINDING_INPUT_NOT_FOUND')).toBe(true);
    });

    it('lists node catalog from injected service', async () => {
        const storage = new InMemoryStoragePort();
        const baseManifests: INodeManifest[] = [
            {
                nodeType: 'image-source',
                displayName: 'Image Source',
                category: 'Test',
                inputs: [],
                outputs: [{ key: 'image', type: 'binary', required: true, binaryKind: 'image' }]
            }
        ];
        const nodeCatalogService: INodeCatalogService = {
            hasNodeType: (nodeType: string) => baseManifests.some((manifest) => manifest.nodeType === nodeType),
            listManifests: async () => baseManifests
        };
        const controller = new DagDesignController(new DagDefinitionService(storage), nodeCatalogService);

        const listed = await controller.listNodeCatalog({ correlationId: 'corr-node-list' });
        expect(listed.ok).toBe(true);
        if (!listed.ok) {
            return;
        }
        expect(listed.data.nodes.length).toBe(1);
        expect(listed.data.nodes[0]?.nodeType).toBe('image-source');
    });

    it('fails validate when node type is not in node catalog', async () => {
        const storage = new InMemoryStoragePort();
        const nodeCatalogService: INodeCatalogService = {
            hasNodeType: (nodeType: string) => nodeType === 'image-source',
            listManifests: async () => []
        };
        const controller = new DagDesignController(new DagDefinitionService(storage), nodeCatalogService);
        const definition = createDefinition();

        const created = await controller.createDefinition({
            definition,
            correlationId: 'corr-node-type-create'
        });
        expect(created.ok).toBe(true);

        const validated = await controller.validateDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: 'corr-node-type-validate'
        });
        expect(validated.ok).toBe(false);
        if (validated.ok) {
            return;
        }
        expect(validated.errors.some((error) => error.code === 'DAG_VALIDATION_NODE_TYPE_NOT_REGISTERED')).toBe(true);
    });
});
