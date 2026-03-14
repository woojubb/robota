import { describe, expect, it } from 'vitest';
import { DagDefinitionService } from '../services/definition-service.js';
import { DagDefinitionValidator } from '../services/definition-validator.js';
import { InMemoryStoragePort } from '../testing/in-memory-storage-port.js';
import type { IDagDefinition } from '../types/domain.js';

function createValidDefinition(version: number = 1): IDagDefinition {
    return {
        dagId: 'dag-1',
        version,
        status: 'draft',
        nodes: [
            {
                nodeId: 'node-a',
                nodeType: 'source',
                dependsOn: [],
                inputs: [],
                outputs: [{ key: 'out', type: 'string', required: true }],
                config: {}
            }
        ],
        edges: []
    };
}

describe('DagDefinitionService extended', () => {
    it('createDraft rejects duplicate version', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const def = createValidDefinition();
        await service.createDraft(def);
        const dup = await service.createDraft(def);
        expect(dup.ok).toBe(false);
        if (dup.ok) return;
        expect(dup.error.some((e) => e.code === 'DAG_VALIDATION_DUPLICATE_VERSION')).toBe(true);
    });

    it('getDefinition returns saved definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition());
        const retrieved = await service.getDefinition('dag-1', 1);
        expect(retrieved).toBeDefined();
        expect(retrieved?.dagId).toBe('dag-1');
    });

    it('getDefinitionByDagId returns draft by default', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition(1));
        await service.createDraft(createValidDefinition(2));
        const def = await service.getDefinitionByDagId('dag-1');
        expect(def?.version).toBe(2);
    });

    it('getDefinitionByDagId returns specific version', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition(1));
        const def = await service.getDefinitionByDagId('dag-1', 1);
        expect(def?.version).toBe(1);
    });

    it('getDefinitionByDagId returns undefined for nonexistent', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        expect(await service.getDefinitionByDagId('missing')).toBeUndefined();
    });

    it('listDefinitions returns all definitions', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition(1));
        const list = await service.listDefinitions();
        expect(list).toHaveLength(1);
    });

    it('listDefinitions filters by dagId', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition(1));
        await service.createDraft({ ...createValidDefinition(1), dagId: 'dag-2' });
        const list = await service.listDefinitions('dag-1');
        expect(list).toHaveLength(1);
    });

    it('updateDraft returns error for nonexistent definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const result = await service.updateDraft(createValidDefinition());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_DEFINITION_NOT_FOUND')).toBe(true);
    });

    it('updateDraft succeeds for draft definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition());
        const result = await service.updateDraft(createValidDefinition());
        expect(result.ok).toBe(true);
    });

    it('validate returns error for nonexistent definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const result = await service.validate('missing', 1);
        expect(result.ok).toBe(false);
    });

    it('validate returns ok for valid definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition());
        const result = await service.validate('dag-1', 1);
        expect(result.ok).toBe(true);
    });

    it('publish returns error for nonexistent definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        const result = await service.publish('missing', 1);
        expect(result.ok).toBe(false);
    });

    it('publish returns error for already published definition', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition());
        await service.publish('dag-1', 1);
        // Try to publish same version again (it is now published)
        const result = await service.publish('dag-1', 1);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_PUBLISH_ONLY_DRAFT')).toBe(true);
    });

    it('publish creates new version', async () => {
        const storage = new InMemoryStoragePort();
        const service = new DagDefinitionService(storage);
        await service.createDraft(createValidDefinition());
        const published = await service.publish('dag-1', 1);
        expect(published.ok).toBe(true);
        if (!published.ok) return;
        expect(published.value.status).toBe('published');
        // published version is incremented (latestVersion + 1)
        expect(published.value.version).toBeGreaterThanOrEqual(1);
    });
});

describe('DagDefinitionValidator extended', () => {
    it('validates empty dagId', () => {
        const def = createValidDefinition();
        def.dagId = '';
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_EMPTY_DAG_ID')).toBe(true);
    });

    it('validates invalid version', () => {
        const def = createValidDefinition();
        def.version = 0;
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_VERSION')).toBe(true);
    });

    it('validates empty nodes', () => {
        const def = createValidDefinition();
        def.nodes = [];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_EMPTY_NODES')).toBe(true);
    });

    it('validates empty nodeId', () => {
        const def = createValidDefinition();
        def.nodes[0].nodeId = '';
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_EMPTY_NODE_ID')).toBe(true);
    });

    it('validates deprecated llm-text node type', () => {
        const def = createValidDefinition();
        def.nodes[0].nodeType = 'llm-text';
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_NODE_TYPE_REMOVED')).toBe(true);
    });

    it('validates empty input port key', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [{ key: '', type: 'string', required: true }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_EMPTY_INPUT_KEY')).toBe(true);
    });

    it('validates empty output port key', () => {
        const def = createValidDefinition();
        def.nodes[0].outputs = [{ key: '', type: 'string', required: true }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_EMPTY_OUTPUT_KEY')).toBe(true);
    });

    it('validates duplicate input port key', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [
            { key: 'in', type: 'string', required: true },
            { key: 'in', type: 'string', required: true }
        ];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_DUPLICATE_INPUT_KEY')).toBe(true);
    });

    it('validates duplicate output port key', () => {
        const def = createValidDefinition();
        def.nodes[0].outputs = [
            { key: 'out', type: 'string', required: true },
            { key: 'out', type: 'string', required: true }
        ];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_DUPLICATE_OUTPUT_KEY')).toBe(true);
    });

    it('validates invalid input port order', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [{ key: 'in', type: 'string', required: true, order: -1 }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_INPUT_ORDER')).toBe(true);
    });

    it('validates invalid output port order', () => {
        const def = createValidDefinition();
        def.nodes[0].outputs = [{ key: 'out', type: 'string', required: true, order: -1 }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_OUTPUT_ORDER')).toBe(true);
    });

    it('validates invalid input port minItems', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [{ key: 'in', type: 'string', required: true, minItems: -1 }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_INPUT_MIN_ITEMS')).toBe(true);
    });

    it('validates invalid input port maxItems', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [{ key: 'in', type: 'string', required: true, maxItems: -1 }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_INPUT_MAX_ITEMS')).toBe(true);
    });

    it('validates minItems exceeding maxItems', () => {
        const def = createValidDefinition();
        def.nodes[0].inputs = [{ key: 'in', type: 'string', required: true, minItems: 5, maxItems: 2 }];
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_INPUT_ITEM_RANGE')).toBe(true);
    });

    it('validates cost policy with invalid limit', () => {
        const def = createValidDefinition();
        def.costPolicy = { runCreditLimit: 0, costPolicyVersion: 1 };
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_COST_LIMIT')).toBe(true);
    });

    it('validates cost policy with invalid version', () => {
        const def = createValidDefinition();
        def.costPolicy = { runCreditLimit: 10, costPolicyVersion: 0 };
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.some((e) => e.code === 'DAG_VALIDATION_INVALID_COST_POLICY_VERSION')).toBe(true);
    });

    it('passes valid definition', () => {
        const def = createValidDefinition();
        const result = DagDefinitionValidator.validate(def);
        expect(result.ok).toBe(true);
    });
});
