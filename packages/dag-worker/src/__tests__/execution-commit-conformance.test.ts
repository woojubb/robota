import { TaskSnapshotBudget } from '@robota-sdk/dag-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStoragePort, InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { SqliteStorageAdapter } from '@robota-sdk/dag-adapters-sqlite';
import type { IStoragePort, TExecutionCommit } from '@robota-sdk/dag-core';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
const cancellation: TExecutionCommit = {
  kind: 'transition-run',
  expectedStatus: 'running',
  event: 'CANCEL',
  endedAt: '2026-09-24',
};
const success: TExecutionCommit = {
  kind: 'settle',
  taskRunId: 'task',
  attempt: 1,
  leaseOwner: 'worker',
  status: 'success',
  outputSnapshot: '{"done":true}',
  estimatedCredits: 2,
  totalCredits: 2,
};

async function fixture(
  kind: string,
  creditPolicy = false,
): Promise<{ storage: IStoragePort; reopen: () => IStoragePort }> {
  const root = mkdtempSync(join(tmpdir(), 'dag-arbitration-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const sqlite = (): SqliteStorageAdapter => {
    const adapter = new SqliteStorageAdapter(join(root, 'runs.db'));
    cleanup.push(() => adapter.close());
    return adapter;
  };
  const storage =
    kind === 'sqlite'
      ? sqlite()
      : kind === 'file'
        ? new FileStoragePort(root)
        : new InMemoryStoragePort();
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    ...(creditPolicy
      ? {
          definitionSnapshot: JSON.stringify({
            dagId: 'dag',
            version: 1,
            status: 'published',
            nodes: [],
            edges: [],
            costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
          }),
        }
      : {}),
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'parent',
    status: 'running',
    attempt: 1,
    leaseOwner: 'worker',
  });
  return {
    storage,
    reopen: () =>
      kind === 'sqlite' ? sqlite() : kind === 'file' ? new FileStoragePort(root) : storage,
  };
}

describe.each(['memory', 'file', 'sqlite'])('%s execution arbitration', (kind) => {
  it('does not admit against a legacy success whose cumulative cost lacks an estimate', async () => {
    const { storage, reopen } = await fixture(kind, true);
    await storage.createTaskRun({
      taskRunId: 'legacy',
      dagRunId: 'run',
      nodeId: 'legacy',
      status: 'success',
      attempt: 1,
      totalCredits: 0.8,
    });
    const result = await storage.commitExecution('run', {
      kind: 'reserve-credits',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      estimatedCredits: 0.6,
    });
    expect(result).toMatchObject({
      applied: false,
      error: { code: 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED' },
    });
    expect((await reopen().getTaskRun('task'))?.reservedCredits).toBeUndefined();
    expect((await reopen().getTaskRun('legacy'))?.totalCredits).toBe(0.8);
  });
  it('carries a legacy cumulative floor into a new successful charge', async () => {
    const { storage, reopen } = await fixture(kind, true);
    await storage.createTaskRun({
      taskRunId: 'legacy',
      dagRunId: 'run',
      nodeId: 'legacy',
      status: 'success',
      attempt: 1,
      totalCredits: 0.2,
    });
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'reserve-credits',
          taskRunId: 'task',
          attempt: 1,
          leaseOwner: 'worker',
          estimatedCredits: 0.6,
        })
      ).applied,
    ).toBe(true);
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'settle',
          taskRunId: 'task',
          attempt: 1,
          leaseOwner: 'worker',
          status: 'success',
          outputSnapshot: '{}',
          estimatedCredits: 0.6,
        })
      ).applied,
    ).toBe(true);
    expect((await reopen().getTaskRun('task'))?.totalCredits).toBe(0.8);
  });
  it('fails closed when a legacy success has no cost evidence', async () => {
    const { storage } = await fixture(kind, true);
    await storage.createTaskRun({
      taskRunId: 'legacy',
      dagRunId: 'run',
      nodeId: 'legacy',
      status: 'success',
      attempt: 1,
    });
    expect(
      await storage.commitExecution('run', {
        kind: 'reserve-credits',
        taskRunId: 'task',
        attempt: 1,
        leaseOwner: 'worker',
        estimatedCredits: 0.1,
      }),
    ).toMatchObject({ applied: false, error: { code: 'DAG_VALIDATION_CREDIT_HISTORY_AMBIGUOUS' } });
  });
  it('does not count a failed task cumulative total as a successful charge', async () => {
    const { storage } = await fixture(kind, true);
    await storage.createTaskRun({
      taskRunId: 'sibling',
      dagRunId: 'run',
      nodeId: 'sibling',
      status: 'running',
      attempt: 1,
      leaseOwner: 'worker-2',
    });
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'settle',
          taskRunId: 'task',
          attempt: 1,
          leaseOwner: 'worker',
          status: 'failed',
          totalCredits: 0.9,
        })
      ).applied,
    ).toBe(true);
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'reserve-credits',
          taskRunId: 'sibling',
          attempt: 1,
          leaseOwner: 'worker-2',
          estimatedCredits: 0.6,
        })
      ).applied,
    ).toBe(true);
  });
  it('atomically admits only one parallel sibling credit hold and releases it on failure', async () => {
    const { storage, reopen } = await fixture(kind, true);
    await storage.createTaskRun({
      taskRunId: 'sibling',
      dagRunId: 'run',
      nodeId: 'sibling',
      status: 'running',
      attempt: 1,
      leaseOwner: 'worker-2',
    });
    const second = kind === 'sqlite' ? reopen() : storage;
    const reserve = (taskRunId: string, leaseOwner: string): TExecutionCommit => ({
      kind: 'reserve-credits',
      taskRunId,
      attempt: 1,
      leaseOwner,
      estimatedCredits: 0.6,
    });
    const results = await Promise.all([
      storage.commitExecution('run', reserve('task', 'worker')),
      second.commitExecution('run', reserve('sibling', 'worker-2')),
    ]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(
      results.filter((result) => result.error?.code === 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED'),
    ).toHaveLength(1);
    const winner = results[0].applied ? 'task' : 'sibling';
    const loser = winner === 'task' ? 'sibling' : 'task';
    const owner = winner === 'task' ? 'worker' : 'worker-2';
    await storage.commitExecution('run', {
      kind: 'settle',
      taskRunId: winner,
      attempt: 1,
      leaseOwner: owner,
      status: 'failed',
    });
    expect(
      (
        await second.commitExecution(
          'run',
          reserve(loser, loser === 'task' ? 'worker' : 'worker-2'),
        )
      ).applied,
    ).toBe(true);
    expect((await reopen().getTaskRun(loser))?.reservedCredits).toBe(0.6);
  });

  it('charges a successful held estimate once and fences mismatched settlement', async () => {
    const { storage, reopen } = await fixture(kind, true);
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'reserve-credits',
          taskRunId: 'task',
          attempt: 1,
          leaseOwner: 'worker',
          estimatedCredits: 0.6,
        })
      ).applied,
    ).toBe(true);
    const settle: TExecutionCommit = {
      kind: 'settle',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      status: 'success',
      outputSnapshot: '{}',
      estimatedCredits: 0.6,
      totalCredits: 0.6,
    };
    expect(
      (await storage.commitExecution('run', { ...settle, estimatedCredits: 0.1 })).applied,
    ).toBe(false);
    expect((await storage.commitExecution('run', settle)).applied).toBe(true);
    expect(await reopen().getTaskRun('task')).toMatchObject({
      status: 'success',
      estimatedCredits: 0.6,
      totalCredits: 0.6,
    });
    expect((await reopen().getTaskRun('task'))?.reservedCredits).toBeUndefined();
    expect((await storage.commitExecution('run', settle)).applied).toBe(false);
  });
  it('releases rejected cancelled/stale snapshot reservations for a live sibling', async () => {
    const { storage } = await fixture(kind);
    const sibling = await fixture(kind);
    const budget = new TaskSnapshotBudget({ inputBytes: 2, outputBytes: 2 });
    const mutation: TExecutionCommit = { ...success, outputSnapshot: '{}' };
    expect(
      await budget.admit('output', '{}', () =>
        storage.commitExecution('run', { ...mutation, attempt: 2 }),
      ),
    ).toMatchObject({ ok: true, value: { applied: false } });
    await storage.commitExecution('run', cancellation);
    expect(
      await budget.admit('output', '{}', () => storage.commitExecution('run', mutation)),
    ).toMatchObject({ ok: true, value: { applied: false } });
    expect(
      await budget.admit('output', '{}', () => sibling.storage.commitExecution('run', mutation)),
    ).toMatchObject({ ok: true, value: { applied: true } });
    expect((await sibling.reopen().getTaskRun('task'))?.outputSnapshot).toBe('{}');
  });

  it('admits input snapshots only for the current live attempt and persists them', async () => {
    const { storage, reopen } = await fixture(kind);
    const mutation: TExecutionCommit = {
      kind: 'snapshot-input',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      inputSnapshot: '{"text":"first"}',
    };
    expect(await storage.commitExecution('run', mutation)).toMatchObject({ applied: true });
    expect((await reopen().getTaskRun('task'))?.inputSnapshot).toBe('{"text":"first"}');
    expect(
      await storage.commitExecution('run', { ...mutation, attempt: 2, inputSnapshot: 'stale' }),
    ).toMatchObject({ applied: false });
    await storage.commitExecution('run', cancellation);
    expect(
      await storage.commitExecution('run', { ...mutation, inputSnapshot: 'late' }),
    ).toMatchObject({ applied: false });
    expect((await reopen().getTaskRun('task'))?.inputSnapshot).toBe('{"text":"first"}');
  });

  it('commits cancellation before a late result, with no output or credits after reopening', async () => {
    const { storage, reopen } = await fixture(kind);
    const [cancelled, settled] = await Promise.all([
      storage.commitExecution('run', cancellation),
      storage.commitExecution('run', success),
    ]);
    expect(cancelled.applied).toBe(true);
    expect(settled.applied).toBe(false);
    const read = reopen();
    expect((await read.getDagRun('run'))?.status).toBe('cancelled');
    expect(await read.getTaskRun('task')).toMatchObject({ status: 'cancelled', attempt: 1 });
    expect((await read.getTaskRun('task'))?.outputSnapshot).toBeUndefined();
    expect((await read.getTaskRun('task'))?.estimatedCredits).toBeUndefined();
  });

  it('commits the successful snapshot together and keeps the first terminal run decision', async () => {
    const { storage, reopen } = await fixture(kind);
    expect((await storage.commitExecution('run', success)).applied).toBe(true);
    const [finished, cancelled] = await Promise.all([
      storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' }),
      storage.commitExecution('run', cancellation),
    ]);
    expect(finished).toMatchObject({ applied: true, runStatus: 'success' });
    expect(cancelled).toMatchObject({ applied: false, runStatus: 'success' });
    expect(await reopen().getTaskRun('task')).toMatchObject({
      status: 'success',
      outputSnapshot: '{"done":true}',
      estimatedCredits: 2,
      totalCredits: 2,
    });
  });

  it.each(['attempt', 'owner'])(
    'rejects stale %s without touching the replacement',
    async (fence) => {
      const { storage } = await fixture(kind);
      if (fence === 'attempt') await storage.incrementTaskAttempt('task');
      else await storage.setTaskRunLease('task', 'replacement', '2099-01-01');
      const before = await storage.getTaskRun('task');
      expect((await storage.commitExecution('run', success)).applied).toBe(false);
      expect(await storage.getTaskRun('task')).toEqual(before);
    },
  );

  it('rejects retry and child admission after cancellation wins', async () => {
    const { storage } = await fixture(kind);
    await storage.commitExecution('run', cancellation);
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'settle',
          taskRunId: 'task',
          attempt: 1,
          leaseOwner: 'worker',
          status: 'failed',
          reserveRetry: true,
        })
      ).applied,
    ).toBe(false);
    expect(
      (
        await storage.commitExecution('run', {
          kind: 'admit',
          dependsOn: [],
          taskRun: {
            taskRunId: 'child',
            dagRunId: 'run',
            nodeId: 'child',
            status: 'queued',
            attempt: 1,
          },
        })
      ).applied,
    ).toBe(false);
    expect((await storage.getTaskRun('task'))?.attempt).toBe(1);
    expect(await storage.getTaskRun('child')).toBeUndefined();
    expect(
      (await storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' })).runStatus,
    ).toBe('cancelled');
  });

  it('reserves the retry with failure settlement so finalization cannot overtake it', async () => {
    const { storage, reopen } = await fixture(kind);
    const retry: TExecutionCommit = {
      kind: 'settle',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      status: 'failed',
      reserveRetry: true,
    };
    expect((await storage.commitExecution('run', retry)).applied).toBe(true);
    expect(
      (await storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' })).applied,
    ).toBe(false);
    expect((await storage.commitExecution('run', retry)).applied).toBe(false);
    expect(await reopen().getTaskRun('task')).toMatchObject({ status: 'queued', attempt: 2 });
  });

  it('admits a ready child once under contention and keeps the run pending', async () => {
    const { storage } = await fixture(kind);
    await storage.commitExecution('run', success);
    const admission: TExecutionCommit = {
      kind: 'admit',
      dependsOn: ['parent'],
      taskRun: {
        taskRunId: 'child',
        dagRunId: 'run',
        nodeId: 'child',
        status: 'queued',
        attempt: 1,
      },
    };
    const admitted = await Promise.all([
      storage.commitExecution('run', admission),
      storage.commitExecution('run', admission),
    ]);
    expect(admitted.map((result) => result.applied)).toEqual([true, false]);
    expect(
      (await storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' })).applied,
    ).toBe(false);
  });
});
