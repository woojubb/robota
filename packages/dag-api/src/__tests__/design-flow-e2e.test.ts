import { describe, expect, it } from 'vitest';
import { DagDefinitionService, InMemoryStoragePort } from '@robota-sdk/dag-core';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { DagDesignController } from '../controllers/dag-design-controller.js';

function createDefinition(): IDagDefinition {
    return {
        dagId: 'dag-e2e',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: 'input',
                nodeType: 'input',
                dependsOn: [],
                config: {}
            },
            {
                nodeId: 'processor',
                nodeType: 'processor',
                dependsOn: ['input'],
                config: {}
            }
        ],
        edges: [
            { from: 'input', to: 'processor' }
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
});
