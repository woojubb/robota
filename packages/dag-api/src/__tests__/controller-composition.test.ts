import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort
} from '@robota-sdk/dag-adapters-memory';
import { createDagControllerComposition } from '../composition/create-dag-controller-composition.js';

describe('createDagControllerComposition', () => {
    it('creates all four controllers', () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));

        const composition = createDagControllerComposition({
            storage,
            queue,
            deadLetterQueue,
            lease,
            clock
        });

        expect(composition.design).toBeDefined();
        expect(composition.runtime).toBeDefined();
        expect(composition.observability).toBeDefined();
        expect(composition.diagnostics).toBeDefined();
    });

    it('passes diagnostics policy to diagnostics controller', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));

        const composition = createDagControllerComposition(
            { storage, queue, deadLetterQueue, lease, clock },
            { diagnosticsPolicy: { reinjectEnabled: false } }
        );

        const result = await composition.diagnostics.reinjectDeadLetter({
            workerId: 'w-1',
            visibilityTimeoutMs: 5000
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors[0]?.detail).toContain('disabled');
        }
    });

    it('passes node catalog service to design controller', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));

        const composition = createDagControllerComposition(
            { storage, queue, deadLetterQueue, lease, clock },
            {
                nodeCatalogService: {
                    listManifests: async () => [{ nodeType: 'input', displayName: 'Input', version: '1.0.0', inputs: [], outputs: [] }],
                    hasNodeType: (nodeType: string) => nodeType === 'input'
                }
            }
        );

        const result = await composition.design.listNodeCatalog({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.nodes).toHaveLength(1);
        }
    });
});
