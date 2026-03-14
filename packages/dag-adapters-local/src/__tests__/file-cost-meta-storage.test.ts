import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { FileCostMetaStorage } from '../file-cost-meta-storage.js';
import type { ICostMeta } from '@robota-sdk/dag-cost';

const TEST_DIR = '/tmp/robota-cost-meta-test';

describe('FileCostMetaStorage', () => {
    let storage: FileCostMetaStorage;

    const sampleMeta: ICostMeta = {
        nodeType: 'test-node',
        displayName: 'Test Node',
        category: 'ai-inference',
        estimateFormula: '10.0',
        variables: {},
        enabled: true,
        updatedAt: '2026-03-15T00:00:00Z',
    };

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        mkdirSync(TEST_DIR, { recursive: true });
        storage = new FileCostMetaStorage(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it('returns undefined for unknown nodeType', async () => {
        expect(await storage.get('unknown')).toBeUndefined();
    });

    it('saves and retrieves cost meta', async () => {
        await storage.save(sampleMeta);
        const result = await storage.get('test-node');
        expect(result).toEqual(sampleMeta);
    });

    it('lists all cost metas', async () => {
        await storage.save(sampleMeta);
        await storage.save({ ...sampleMeta, nodeType: 'test-node-2', displayName: 'Test 2' });
        const all = await storage.getAll();
        expect(all).toHaveLength(2);
    });

    it('deletes cost meta', async () => {
        await storage.save(sampleMeta);
        await storage.delete('test-node');
        expect(await storage.get('test-node')).toBeUndefined();
    });

    it('persists across instances', async () => {
        await storage.save(sampleMeta);
        const storage2 = new FileCostMetaStorage(TEST_DIR);
        expect(await storage2.get('test-node')).toEqual(sampleMeta);
    });
});
