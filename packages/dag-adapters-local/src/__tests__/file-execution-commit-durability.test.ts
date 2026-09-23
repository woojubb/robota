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
