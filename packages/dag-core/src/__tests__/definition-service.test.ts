import { describe, expect, it } from 'vitest';
import { DagDefinitionService } from '../services/definition-service.js';
import { DagDefinitionValidator } from '../services/definition-validator.js';
import { InMemoryStoragePort } from '../testing/in-memory-storage-port.js';
import type { IDagDefinition } from '../types/domain.js';

function createValidDefinition(): IDagDefinition {
    return {
        dagId: 'dag-sample',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: 'node-a',
                nodeType: 'input',
                dependsOn: [],
                config: {}
            },
            {
                nodeId: 'node-b',
                nodeType: 'processor',
                dependsOn: ['node-a'],
                config: {}
            }
        ],
        edges: [
            { from: 'node-a', to: 'node-b' }
        ]
    };
}

describe('DagDefinitionValidator', () => {
    it('returns validation error for duplicate nodeId', () => {
        const definition = createValidDefinition();
        definition.nodes[1] = {
            ...definition.nodes[1],
            nodeId: 'node-a'
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
        definition.edges.push({ from: 'node-b', to: 'node-a' });

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
                    dependsOn: ['node-b'],
                    config: {}
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
