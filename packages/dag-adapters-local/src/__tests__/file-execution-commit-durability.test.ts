import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FileStoragePort } from '../file-storage-port.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(writeFile).mockRestore();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('cannot acknowledge finalization based on a task outcome whose persistence failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-commit-durability-'));
  directories.push(root);
  const storage = new FileStoragePort(root);
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'running',
    attempt: 1,
    leaseOwner: 'worker',
  });
  const failure = new Error('disk write failed');
  vi.mocked(writeFile).mockRejectedValueOnce(failure);
  await expect(
    storage.commitExecution('run', {
      kind: 'settle',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      status: 'success',
      outputSnapshot: '{"done":true}',
    }),
  ).rejects.toBe(failure);

  // The I/O failure is gone. A later operation still cannot treat the undurable cached outcome
  // as evidence that the run completed; recovery must reopen the persisted state.
  await expect(
    storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' }),
  ).rejects.toBe(failure);
  const reopened = new FileStoragePort(root);
  expect((await reopened.getDagRun('run'))?.status).toBe('running');
  expect((await reopened.getTaskRun('task'))?.status).toBe('running');
  expect((await reopened.getTaskRun('task'))?.outputSnapshot).toBeUndefined();
});

it('waits for the task snapshot write before persisting concurrent finalization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-commit-order-'));
  directories.push(root);
  const storage = new FileStoragePort(root);
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'running',
    attempt: 1,
    leaseOwner: 'worker',
  });
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writes: string[] = [];
  vi.mocked(writeFile).mockImplementation(async (...args) => {
    const path = String(args[0]);
    writes.push(path);
    if (path.includes('task-runs.json.tmp-')) {
      started();
      await blocked;
    }
    return actual.writeFile(...args);
  });
  const settled = storage.commitExecution('run', {
    kind: 'settle',
    taskRunId: 'task',
    attempt: 1,
    leaseOwner: 'worker',
    status: 'success',
    outputSnapshot: '{"done":true}',
  });
  await observed;
  const finalized = storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.some((path) => path.includes('dag-runs.json.tmp-'))).toBe(false);
  } finally {
    release();
    await Promise.all([settled, finalized]);
  }
  const reopened = new FileStoragePort(root);
  expect((await reopened.getDagRun('run'))?.status).toBe('success');
  expect(await reopened.getTaskRun('task')).toMatchObject({
    status: 'success',
    outputSnapshot: '{"done":true}',
  });
});

it('does not let cancelled-run cleanup acknowledge a message before cancellation is durable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-cancel-visibility-'));
  directories.push(root);
  const storage = new FileStoragePort(root);
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'queued',
    attempt: 1,
  });
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let failWrite!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => {
    failWrite = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const failure = new Error('cancellation persistence failed');
  vi.mocked(writeFile).mockImplementation(async (...args) => {
    if (String(args[0]).includes('dag-runs.json.tmp-')) {
      reached();
      await blocked;
      throw failure;
    }
    return actual.writeFile(...args);
  });
  const cancellation = storage
    .commitExecution('run', { kind: 'transition-run', expectedStatus: 'running', event: 'CANCEL' })
    .catch((error: unknown) => error);
  await observed;
  const ack = vi.fn();
  // The storage sequence in WorkerLoopService.cancelIfRunCancelled/settleCancelledRunMessage.
  const cleanup = (async () => {
    if ((await storage.getDagRun('run'))?.status !== 'cancelled') return;
    const task = await storage.getTaskRun('task');
    if (task) {
      await storage.updateTaskRunStatus(task.taskRunId, 'cancelled');
      await storage.setTaskRunLease(task.taskRunId, undefined, undefined);
    }
    ack();
  })().catch((error: unknown) => error);
  await new Promise<void>((resolve) => setImmediate(resolve));
  failWrite();
  const cancellationResult = await cancellation;
  const cleanupResult = await cleanup;
  const reopened = new FileStoragePort(root);
  expect({
    cancellationResult,
    cleanupResult,
    acked: ack.mock.calls.length,
    runStatus: (await reopened.getDagRun('run'))?.status,
    taskStatus: (await reopened.getTaskRun('task'))?.status,
  }).toEqual({
    cancellationResult: failure,
    cleanupResult: failure,
    acked: 0,
    runStatus: 'running',
    taskStatus: 'queued',
  });
});

it('does not let a raw task setter flush an unfinished execution commit after its write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-raw-setter-order-'));
  directories.push(root);
  const storage = new FileStoragePort(root);
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'running',
    attempt: 1,
    leaseOwner: 'worker',
  });
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let failWrite!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => {
    failWrite = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const failure = new Error('task commit persistence failed');
  let writes = 0;
  vi.mocked(writeFile).mockImplementation(async (...args) => {
    if (String(args[0]).includes('task-runs.json.tmp-') && ++writes === 1) {
      reached();
      await blocked;
      throw failure;
    }
    return actual.writeFile(...args);
  });
  const committed = storage
    .commitExecution('run', {
      kind: 'settle',
      taskRunId: 'task',
      attempt: 1,
      leaseOwner: 'worker',
      status: 'success',
      outputSnapshot: '{}',
    })
    .catch((error: unknown) => error);
  await observed;
  const setter = storage
    .setTaskRunLease('task', 'replacement', '2099-01-01')
    .catch((error: unknown) => error);
  await new Promise<void>((resolve) => setImmediate(resolve));
  failWrite();
  expect(await committed).toBe(failure);
  expect(await setter).toBe(failure);
  expect(writes).toBe(1);
  const reopened = new FileStoragePort(root);
  expect(await reopened.getTaskRun('task')).toMatchObject({
    status: 'running',
    leaseOwner: 'worker',
  });
  expect((await reopened.getTaskRun('task'))?.outputSnapshot).toBeUndefined();
});

it('isolates every run/task read and raw mutation after a raw persistence failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-state-poison-'));
  directories.push(root);
  const storage = new FileStoragePort(root);
  const run = {
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running' as const,
    runKey: 'key',
    logicalDate: '2026-09-24',
    trigger: 'manual' as const,
  };
  const task = {
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'running' as const,
    attempt: 1,
    leaseOwner: 'worker',
  };
  await storage.createDagRun(run);
  await storage.createTaskRun(task);
  const failure = new Error('raw write failed');
  vi.mocked(writeFile).mockRejectedValueOnce(failure);
  await expect(storage.updateTaskRunStatus('task', 'cancelled')).rejects.toBe(failure);
  const operations = [
    storage.getDagRun('run'),
    storage.listDagRuns(),
    storage.getDagRunByRunKey('key'),
    storage.getTaskRun('task'),
    storage.listTaskRunsByDagRunId('run'),
    storage.listStaleRunningTaskRuns('2099-01-01'),
    storage.createDagRun(run),
    storage.updateDagRunStatus('run', 'failed'),
    storage.deleteDagRun('run'),
    storage.createTaskRun(task),
    storage.deleteTaskRunsByDagRunId('run'),
    storage.updateTaskRunStatus('task', 'success'),
    storage.setTaskRunLease('task', 'replacement'),
    storage.saveTaskRunSnapshots('task', '{}'),
    storage.incrementTaskAttempt('task'),
    storage.commitExecution('run', { kind: 'finalize', endedAt: '2026-09-24' }),
  ];
  expect(await Promise.allSettled(operations)).toEqual(
    operations.map(() => ({ status: 'rejected', reason: failure })),
  );
  // Definition files are independent of run/task state and do not expose the poisoned maps.
  await storage.saveDefinition({
    dagId: 'independent',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
  });
  expect((await storage.getDefinition('independent', 1))?.dagId).toBe('independent');
  const reopened = new FileStoragePort(root);
  expect((await reopened.getTaskRun('task'))?.status).toBe('running');
  expect((await reopened.getDagRun('run'))?.status).toBe('running');
});

it('retains hydration retry after initialization fails before any state mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dag-state-hydration-'));
  directories.push(root);
  await writeFile(join(root, 'runs'), 'obstruction');
  const storage = new FileStoragePort(root);
  await expect(storage.getDagRun('missing')).rejects.toThrow();
  await rm(join(root, 'runs'));
  await expect(storage.getDagRun('missing')).resolves.toBeUndefined();
});
