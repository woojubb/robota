import { describe, it, expect } from 'vitest';
import type { TPrompt, TObjectInfo } from '@robota-sdk/dag-core';
import type { ICostMetaStoragePort, ICostMeta } from '@robota-sdk/dag-cost';
import { CelCostEstimatorAdapter } from '../adapters/cel-cost-estimator-adapter.js';

function createMockStorage(metas: Record<string, ICostMeta>): ICostMetaStoragePort {
    return {
        get: async (nodeType: string) => metas[nodeType],
        getAll: async () => Object.values(metas),
        save: async () => {},
        delete: async () => {},
    };
}

const objectInfo: TObjectInfo = {
    TestNode: {
        display_name: 'Test',
        category: 'test',
        input: { required: {} },
        output: ['STRING'],
        output_is_list: [false],
        output_name: ['output'],
        output_node: false,
        description: '',
    },
};

const baseMeta: ICostMeta = {
    nodeType: 'TestNode',
    displayName: 'Test Node',
    category: 'ai-inference',
    estimateFormula: 'baseCost',
    variables: { baseCost: 10 },
    enabled: true,
    updatedAt: '2026-01-01T00:00:00Z',
};

describe('CelCostEstimatorAdapter', () => {
    it('should estimate cost for nodes with known formulas', async () => {
        const storage = createMockStorage({ TestNode: baseMeta });
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'TestNode', inputs: {} },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBe(10);
            expect(result.value.perNode['1'].estimatedCredits).toBe(10);
            expect(result.value.perNode['1'].nodeType).toBe('TestNode');
        }
    });

    it('should return 0 credits for unknown node types', async () => {
        const storage = createMockStorage({});
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'UnknownNode', inputs: {} },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBe(0);
            expect(result.value.perNode['1'].estimatedCredits).toBe(0);
        }
    });

    it('should sum total credits across multiple nodes', async () => {
        const storage = createMockStorage({
            TestNode: baseMeta,
            OtherNode: {
                ...baseMeta,
                nodeType: 'OtherNode',
                displayName: 'Other',
                estimateFormula: 'baseCost * 2.0',
                variables: { baseCost: 5 },
            },
        });
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'TestNode', inputs: {} },
            '2': { class_type: 'OtherNode', inputs: {} },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        if (!result.ok) {
            throw new Error(`Expected ok but got error: ${JSON.stringify(result.error)}`);
        }
        expect(result.value.perNode['1'].estimatedCredits).toBe(10);
        expect(result.value.perNode['2'].estimatedCredits).toBe(10);
        expect(result.value.totalEstimatedCredits).toBe(20);
    });

    it('should return 0 credits for disabled nodes', async () => {
        const disabledMeta: ICostMeta = { ...baseMeta, enabled: false };
        const storage = createMockStorage({ TestNode: disabledMeta });
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'TestNode', inputs: {} },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBe(0);
            expect(result.value.perNode['1'].estimatedCredits).toBe(0);
        }
    });

    it('should use node inputs as context variables in formula', async () => {
        const formulaMeta: ICostMeta = {
            ...baseMeta,
            estimateFormula: 'width * height * costPerPixel',
            variables: { costPerPixel: 0.001 },
        };
        const storage = createMockStorage({ TestNode: formulaMeta });
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'TestNode', inputs: { width: 512, height: 512 } },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBeCloseTo(262.144);
        }
    });

    it('should return error for invalid formula', async () => {
        const badMeta: ICostMeta = {
            ...baseMeta,
            estimateFormula: '!!!invalid',
        };
        const storage = createMockStorage({ TestNode: badMeta });
        const adapter = new CelCostEstimatorAdapter(storage);

        const prompt: TPrompt = {
            '1': { class_type: 'TestNode', inputs: {} },
        };

        const result = await adapter.estimateCost(prompt, objectInfo);
        expect(result.ok).toBe(false);
    });
});
