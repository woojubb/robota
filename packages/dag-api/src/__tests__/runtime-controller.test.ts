import { describe, expect, it } from 'vitest';
import { buildValidationError, type IDagRun, type ITaskRun } from '@robota-sdk/dag-core';
import { DagRuntimeController } from '../controllers/dag-runtime-controller.js';
import type {
  IRuntimeRunCancellerPort,
  IRuntimeRunReaderPort,
  IRuntimeRunStarterPort,
  IRuntimeStartRunInput,
} from '../ports/controller-service-ports.js';

const DAG_RUN_ID = 'dag-runtime:run:1771050000000';

function createDagRun(status: IDagRun['status']): IDagRun {
  return {
    dagRunId: DAG_RUN_ID,
    dagId: 'dag-runtime',
    version: 1,
    status,
    runKey: 'dag-runtime:2026-02-14T05:00:00.000Z',
    logicalDate: '2026-02-14T05:00:00.000Z',
    trigger: 'manual',
    startedAt: '2026-02-14T05:00:00.000Z',
  };
}

function createTaskRun(status: ITaskRun['status']): ITaskRun {
  return {
    taskRunId: `${DAG_RUN_ID}:entry:1`,
    dagRunId: DAG_RUN_ID,
    nodeId: 'entry',
    status,
    attempt: 1,
  };
}

function createController(): DagRuntimeController {
  let currentRun = createDagRun('running');
  const runStarter: IRuntimeRunStarterPort = {
    async startRun(input: IRuntimeStartRunInput) {
      currentRun = {
        ...currentRun,
        dagId: input.dagId,
        version: input.version ?? 1,
        trigger: input.trigger,
        logicalDate: input.logicalDate ?? currentRun.logicalDate,
      };
      return {
        ok: true,
        value: {
          dagRunId: currentRun.dagRunId,
          dagId: currentRun.dagId,
          version: currentRun.version,
          logicalDate: currentRun.logicalDate,
          taskRunIds: [`${DAG_RUN_ID}:entry:1`],
        },
      };
    },
  };
  const runReader: IRuntimeRunReaderPort = {
    async getRun(dagRunId: string) {
      if (dagRunId !== DAG_RUN_ID) {
        return {
          ok: false,
          error: buildValidationError('DAG_VALIDATION_DAG_RUN_NOT_FOUND', 'DagRun was not found', {
            dagRunId,
          }),
        };
      }
      return {
        ok: true,
        value: {
          dagRun: currentRun,
          taskRuns: [createTaskRun(currentRun.status === 'cancelled' ? 'cancelled' : 'running')],
        },
      };
    },
  };
  const runCanceller: IRuntimeRunCancellerPort = {
    async cancelRun(dagRunId: string) {
      currentRun = createDagRun('cancelled');
      return { ok: true, value: { dagRunId, status: 'cancelled' } };
    },
  };

  return new DagRuntimeController(runStarter, runReader, runCanceller);
}

describe('DagRuntimeController', () => {
  it('runs trigger -> query -> cancel flow through runtime ports', async () => {
    const controller = createController();

    const triggered = await controller.triggerRun({
      dagId: 'dag-runtime',
      trigger: 'manual',
      input: {},
      correlationId: 'corr-runtime-trigger',
    });
    expect(triggered.ok).toBe(true);
    if (!triggered.ok) {
      return;
    }
    expect(triggered.status).toBe(201);

    const queried = await controller.queryRun({
      dagRunId: triggered.data.dagRunId,
      correlationId: 'corr-runtime-query',
    });
    expect(queried.ok).toBe(true);
    if (!queried.ok) {
      return;
    }
    expect(queried.data.dagRun.status).toBe('running');
    expect(queried.data.taskRuns.length).toBe(1);

    const cancelled = await controller.cancelRun({
      dagRunId: triggered.data.dagRunId,
      correlationId: 'corr-runtime-cancel',
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.data.status).toBe('cancelled');
  });

  it('returns not found for unknown dagRun query', async () => {
    const controller = createController();

    const queried = await controller.queryRun({
      dagRunId: 'missing-run',
      correlationId: 'corr-runtime-missing',
    });

    expect(queried.ok).toBe(false);
    if (queried.ok) {
      return;
    }
    expect(queried.status).toBe(404);
    expect(queried.errors[0]?.code).toBe('DAG_VALIDATION_DAG_RUN_NOT_FOUND');
  });
});
