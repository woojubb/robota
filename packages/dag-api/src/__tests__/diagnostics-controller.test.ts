import { describe, expect, it } from 'vitest';
import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';
import { DagDiagnosticsController } from '../controllers/dag-diagnostics-controller.js';
import type {
  IDiagnosticsDeadLetterReinjectPort,
  IRuntimeRunReaderPort,
  IRuntimeRunStarterPort,
} from '../ports/controller-service-ports.js';

const SOURCE_DAG_RUN_ID = 'dag-diagnostics:run:1771074000000';

function createDagRun(): IDagRun {
  return {
    dagRunId: SOURCE_DAG_RUN_ID,
    dagId: 'dag-diagnostics',
    version: 1,
    status: 'failed',
    runKey: 'dag-diagnostics:2026-02-14T13:00:00.000Z',
    logicalDate: '2026-02-14T13:00:00.000Z',
    trigger: 'manual',
    startedAt: '2026-02-14T13:00:00.000Z',
    endedAt: '2026-02-14T13:00:10.000Z',
  };
}

function createFailedTaskRun(): ITaskRun {
  return {
    taskRunId: `${SOURCE_DAG_RUN_ID}:entry:1`,
    dagRunId: SOURCE_DAG_RUN_ID,
    nodeId: 'entry',
    status: 'failed',
    attempt: 1,
    errorCode: 'DAG_TASK_EXECUTION_HARD_FAIL',
    errorMessage: 'Hard failure',
  };
}

function createController(reinjectEnabled: boolean): DagDiagnosticsController {
  const runReader: IRuntimeRunReaderPort = {
    async getRun() {
      return {
        ok: true,
        value: {
          dagRun: createDagRun(),
          taskRuns: [createFailedTaskRun()],
        },
      };
    },
  };
  const runStarter: IRuntimeRunStarterPort = {
    async startRun() {
      return {
        ok: true,
        value: {
          dagRunId: 'dag-diagnostics:run:1771074000000:rerun:manual-rerun-1',
          dagId: 'dag-diagnostics',
          version: 1,
          logicalDate: '2026-02-14T13:00:00.000Z',
          taskRunIds: ['dag-diagnostics:run:1771074000000:rerun:manual-rerun-1:entry:1'],
        },
      };
    },
  };
  const dlqReinject: IDiagnosticsDeadLetterReinjectPort = {
    async reinjectOnce() {
      return {
        ok: true,
        value: {
          reinjected: true,
          taskRunId: `${SOURCE_DAG_RUN_ID}:entry:1`,
        },
      };
    },
  };

  return new DagDiagnosticsController(runReader, runStarter, dlqReinject, { reinjectEnabled });
}

describe('DagDiagnosticsController', () => {
  it('analyzes failures through runtime reader port', async () => {
    const diagnostics = createController(false);

    const failure = await diagnostics.analyzeFailure({
      dagRunId: SOURCE_DAG_RUN_ID,
      correlationId: 'corr-diagnostics-failure',
    });
    expect(failure.ok).toBe(true);
    if (!failure.ok) {
      return;
    }
    expect(failure.data.failedTaskRuns).toHaveLength(1);
    expect(failure.data.failureCodeCounts[0]?.code).toBe('DAG_TASK_EXECUTION_HARD_FAIL');
  });

  it('blocks dead letter reinject by default policy', async () => {
    const diagnostics = createController(false);

    const reinjected = await diagnostics.reinjectDeadLetter({
      workerId: 'dlq-worker-1',
      visibilityTimeoutMs: 30_000,
      correlationId: 'corr-diagnostics-reinject',
    });
    expect(reinjected.ok).toBe(false);
    if (reinjected.ok) {
      return;
    }
    expect(reinjected.status).toBe(409);
    expect(reinjected.errors[0]?.code).toBe('DAG_POLICY_REINJECT_DISABLED');
  });

  it('allows reinject and rerun through injected ports when policy enables it', async () => {
    const diagnostics = createController(true);

    const reinjected = await diagnostics.reinjectDeadLetter({
      workerId: 'dlq-worker-1',
      visibilityTimeoutMs: 30_000,
      correlationId: 'corr-diagnostics-reinject-enabled',
    });
    expect(reinjected.ok).toBe(true);
    if (!reinjected.ok) {
      return;
    }
    expect(reinjected.data.reinjected).toBe(true);

    const rerun = await diagnostics.rerun({
      sourceDagRunId: SOURCE_DAG_RUN_ID,
      rerunKey: 'manual-rerun-1',
      input: { reason: 'manual-diagnostic-rerun' },
      correlationId: 'corr-diagnostics-rerun',
    });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) {
      return;
    }
    expect(rerun.data.rerunDagRunId).not.toBe(SOURCE_DAG_RUN_ID);
  });
});
