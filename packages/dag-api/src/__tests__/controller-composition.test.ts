import { describe, expect, it } from 'vitest';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { buildValidationError } from '@robota-sdk/dag-core';
import { createDagControllerComposition } from '../composition/create-dag-controller-composition.js';
import type {
  IDiagnosticsDeadLetterReinjectPort,
  IObservabilityProjectionReaderPort,
  IRuntimeRunCancellerPort,
  IRuntimeRunReaderPort,
  IRuntimeRunStarterPort,
} from '../ports/controller-service-ports.js';

function createCompositionDependencies() {
  const missingRunError = buildValidationError(
    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
    'DagRun was not found',
    { dagRunId: 'missing-run' },
  );
  const runStarter: IRuntimeRunStarterPort = {
    async startRun() {
      return {
        ok: true,
        value: {
          dagRunId: 'dag-run-1',
          dagId: 'dag-1',
          version: 1,
          logicalDate: '2026-02-14T07:00:00.000Z',
          taskRunIds: [],
        },
      };
    },
  };
  const runReader: IRuntimeRunReaderPort = {
    async getRun() {
      return { ok: false, error: missingRunError };
    },
  };
  const runCanceller: IRuntimeRunCancellerPort = {
    async cancelRun(dagRunId: string) {
      return { ok: true, value: { dagRunId, status: 'cancelled' } };
    },
  };
  const projectionReader: IObservabilityProjectionReaderPort = {
    async buildRunProjection() {
      return { ok: false, error: missingRunError };
    },
    async buildLineageProjection() {
      return { ok: false, error: missingRunError };
    },
    async buildDashboardProjection() {
      return { ok: false, error: missingRunError };
    },
  };
  const deadLetterReinject: IDiagnosticsDeadLetterReinjectPort = {
    async reinjectOnce() {
      return { ok: true, value: { reinjected: false } };
    },
  };

  return {
    storage: new InMemoryStoragePort(),
    runStarter,
    runReader,
    runCanceller,
    projectionReader,
    deadLetterReinject,
  };
}

describe('createDagControllerComposition', () => {
  it('creates all four controllers', () => {
    const composition = createDagControllerComposition(createCompositionDependencies());

    expect(composition.design).toBeDefined();
    expect(composition.runtime).toBeDefined();
    expect(composition.observability).toBeDefined();
    expect(composition.diagnostics).toBeDefined();
  });

  it('passes diagnostics policy to diagnostics controller', async () => {
    const composition = createDagControllerComposition(createCompositionDependencies(), {
      diagnosticsPolicy: { reinjectEnabled: false },
    });

    const result = await composition.diagnostics.reinjectDeadLetter({
      workerId: 'w-1',
      visibilityTimeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.detail).toContain('disabled');
    }
  });

  it('passes node catalog service to design controller', async () => {
    const composition = createDagControllerComposition(createCompositionDependencies(), {
      nodeCatalogService: {
        listObjectInfo: async () => ({
          ok: true,
          value: {
            input: {
              display_name: 'Input',
              category: 'general',
              input: { required: {} },
              output: [],
              output_is_list: [],
              output_name: [],
              output_node: false,
              description: 'Input node',
            },
          },
        }),
        hasNodeType: async (nodeType: string) => ({ ok: true, value: nodeType === 'input' }),
      },
    });

    const result = await composition.design.listNodeCatalog({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.input?.display_name).toBe('Input');
    }
  });
});
