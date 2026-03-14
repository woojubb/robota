import { describe, expect, it } from 'vitest';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-memory';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import { DagObservabilityController } from '../controllers/dag-observability-controller.js';

describe('DagObservabilityController', () => {
    it('queryRunProjection returns error when dag run not found', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagObservabilityController(
            new ProjectionReadModelService(storage)
        );

        const result = await controller.queryRunProjection({ dagRunId: 'nonexistent' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(404);
        }
    });

    it('queryLineageProjection returns error when dag run not found', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagObservabilityController(
            new ProjectionReadModelService(storage)
        );

        const result = await controller.queryLineageProjection({ dagRunId: 'nonexistent' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(404);
        }
    });

    it('queryDashboard returns error when dag run not found', async () => {
        const storage = new InMemoryStoragePort();
        const controller = new DagObservabilityController(
            new ProjectionReadModelService(storage)
        );

        const result = await controller.queryDashboard({ dagRunId: 'nonexistent' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status).toBe(404);
        }
    });
});
