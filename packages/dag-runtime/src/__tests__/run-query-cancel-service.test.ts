import { describe, expect, it, vi } from 'vitest';
import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { ManualClockPort } from '@robota-sdk/dag-adapters-local/testing';
import { RunCancelService } from '../services/run-cancel-service.js';
import { RunQueryService } from '../services/run-query-service.js';

function createRun(): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'dag-1',
    version: 1,
    status: 'running',
    runKey: 'dag-1:run-1',
    logicalDate: '2026-02-14T03:00:00.000Z',
    trigger: 'manual',
    startedAt: '2026-02-14T03:00:00.000Z',
  };
}

function createTaskRun(): ITaskRun {
  return {
    taskRunId: 'task-1',
    dagRunId: 'run-1',
    nodeId: 'entry',
    status: 'queued',
    attempt: 1,
  };
}

describe('RunQueryService and RunCancelService', () => {
  it('queries run and task runs', async () => {
    const storage = new InMemoryStoragePort();
    await storage.createDagRun(createRun());
    await storage.createTaskRun(createTaskRun());
    const service = new RunQueryService(storage);

    const queried = await service.getRun('run-1');
    expect(queried.ok).toBe(true);
    if (!queried.ok) {
      return;
    }

    expect(queried.value.dagRun.status).toBe('running');
    expect(queried.value.taskRuns).toHaveLength(1);
    expect(queried.value.taskRuns[0]?.taskRunId).toBe('task-1');
  });

  it('cancels run from running status', async () => {
    const storage = new InMemoryStoragePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 4, 0, 0));
    await storage.createDagRun(createRun());
    const service = new RunCancelService(storage, clock);

    const cancelled = await service.cancelRun('run-1');
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }

    const run = await storage.getDagRun('run-1');
    expect(run?.status).toBe('cancelled');
    expect(run?.endedAt).toBe('2026-02-14T04:00:00.000Z');
  });
  it('does not overwrite finalization that commits after cancellation reads the run', async () => {
    const storage = new InMemoryStoragePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14));
    await storage.createDagRun(createRun());
    const getRun = storage.getDagRun.bind(storage);
    vi.spyOn(storage, 'getDagRun').mockImplementationOnce(async (runId) => {
      const observed = await getRun(runId);
      await storage.updateDagRunStatus(runId, 'success', clock.nowIso());
      return observed;
    });
    const cancelled = await new RunCancelService(storage, clock).cancelRun('run-1');
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'DAG_STATE_TRANSITION_INVALID' } });
    expect((await storage.getDagRun('run-1'))?.status).toBe('success');
  });
});
