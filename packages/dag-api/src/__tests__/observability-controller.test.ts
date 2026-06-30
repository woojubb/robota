import { describe, expect, it } from 'vitest';
import { buildValidationError } from '@robota-sdk/dag-core';
import { DagObservabilityController } from '../controllers/dag-observability-controller.js';
import type { IObservabilityProjectionReaderPort } from '../ports/controller-service-ports.js';

function createMissingProjectionReader(): IObservabilityProjectionReaderPort {
  const error = buildValidationError(
    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
    'DagRun was not found for projection',
    { dagRunId: 'nonexistent' },
  );
  return {
    async buildRunProjection() {
      return { ok: false, error };
    },
    async buildLineageProjection() {
      return { ok: false, error };
    },
    async buildDashboardProjection() {
      return { ok: false, error };
    },
  };
}

describe('DagObservabilityController', () => {
  it('queryRunProjection returns error when dag run not found', async () => {
    const controller = new DagObservabilityController(createMissingProjectionReader());

    const result = await controller.queryRunProjection({ dagRunId: 'nonexistent' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('queryLineageProjection returns error when dag run not found', async () => {
    const controller = new DagObservabilityController(createMissingProjectionReader());

    const result = await controller.queryLineageProjection({ dagRunId: 'nonexistent' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('queryDashboard returns error when dag run not found', async () => {
    const controller = new DagObservabilityController(createMissingProjectionReader());

    const result = await controller.queryDashboard({ dagRunId: 'nonexistent' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
