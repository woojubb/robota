import { describe, expect, it } from 'vitest';
import { DagDefinitionService } from '../services/definition-service.js';
import { DagDefinitionValidator } from '../services/definition-validator.js';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import type { IDagDefinition } from '../types/domain.js';

function createValidDefinition(): IDagDefinition {
    return {
        dagId: 'dag-sample',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: 'node-a-image-source',
                nodeType: 'image-source',
                dependsOn: [],
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
                ],
                config: {
                    asset: {
                        referenceType: 'uri',
                        uri: 'file://sample.png'
                    },
                    mimeType: 'image/png'
                }
            },
            {
                nodeId: 'node-b-ok-emitter',
                nodeType: 'ok-emitter',
                dependsOn: ['node-a-image-source'],
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
                ],
                config: {}
            }
        ],
        edges: [
            {
                from: 'node-a-image-source',
                to: 'node-b-ok-emitter',
                bindings: [
                    { outputKey: 'image', inputKey: 'image' }
                ]
            }
        ]
    };
}

describe('DagDefinitionValidator', () => {
    it('returns validation error for duplicate nodeId', () => {
        const definition = createValidDefinition();
        definition.nodes[1] = {
            ...definition.nodes[1],
            nodeId: 'node-a-image-source'
        };

        const validated = DagDefinitionValidator.validate(definition);

        expect(validated.ok).toBe(false);
        if (validated.ok) {
            return;
        }

        expect(validated.error.some(error => error.code === 'DAG_VALIDATION_DUPLICATE_NODE_ID')).toBe(true);
    });

    it('returns validation error for cycle', () => {
        const definition = createValidDefinition();
        definition.edges.push({
            from: 'node-b-ok-emitter',
            to: 'node-a-image-source',
            bindings: [
                { outputKey: 'status', inputKey: 'image' }
            ]
        });

        const validated = DagDefinitionValidator.validate(definition);

        expect(validated.ok).toBe(false);
        if (validated.ok) {
            return;
        }

        expect(validated.error.some(error => error.code === 'DAG_VALIDATION_CYCLE_DETECTED')).toBe(true);
    });
});

describe('DagDefinitionService', () => {
    it('fails to publish invalid definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const invalid = createValidDefinition();
        invalid.nodes = [];

        const created = await service.createDraft(invalid);
        expect(created.ok).toBe(true);

        const published = await service.publish(invalid.dagId, invalid.version);
        expect(published.ok).toBe(false);
        if (published.ok) {
            return;
        }

        expect(published.error.some(error => error.code === 'DAG_VALIDATION_EMPTY_NODES')).toBe(true);
    });

    it('fails to update non-draft definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const definition = createValidDefinition();

        const created = await service.createDraft(definition);
        expect(created.ok).toBe(true);

        const published = await service.publish(definition.dagId, definition.version);
        expect(published.ok).toBe(true);

        const updateAttempt = await service.updateDraft({
            ...definition,
            nodes: [
                ...definition.nodes,
                {
                    nodeId: 'node-c',
                    nodeType: 'output',
                    dependsOn: ['node-b-ok-emitter'],
                    config: {},
                    inputs: [
                        {
                            key: 'status',
                            label: 'Status',
                            order: 0,
                            type: 'string',
                            required: true
                        }
                    ],
                    outputs: []
                }
            ]
        });

        expect(updateAttempt.ok).toBe(false);
        if (updateAttempt.ok) {
            return;
        }

        expect(updateAttempt.error.some(error => error.code === 'DAG_VALIDATION_UPDATE_ONLY_DRAFT')).toBe(true);
    });
});
