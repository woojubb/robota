import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../subagent-manager.js';
import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentRunner,
} from '../types.js';

interface ITestDeferred {
  promise: Promise<ISubagentJobResult>;
  resolve: (result: ISubagentJobResult) => void;
  reject: (error: Error) => void;
}

interface IStartedJob {
  jobId: string;
  deferred: ITestDeferred;
  cancelReason?: string;
}

function createTestDeferred(): ITestDeferred {
  let resolveFn: (result: ISubagentJobResult) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<ISubagentJobResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function createControllableRunner(): { runner: ISubagentRunner; started: IStartedJob[] } {
  const started: IStartedJob[] = [];
  return {
    started,
    runner: {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        const deferred = createTestDeferred();
        const startedJob: IStartedJob = {
          jobId: job.jobId,
          deferred,
        };
        started.push(startedJob);
        return {
          jobId: job.jobId,
          result: deferred.promise,
          cancel: (reason?: string) => {
            startedJob.cancelReason = reason;
            return Promise.resolve();
          },
        };
      },
    },
  };
}

function createResolvedRunner(output: string): ISubagentRunner {
  return {
    start(job: ISubagentJobStart): ISubagentJobHandle {
      return {
        jobId: job.jobId,
        result: Promise.resolve({
          jobId: job.jobId,
          output,
        }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

function createSpawnRequest(prompt: string) {
  return {
    type: 'general-purpose',
    label: 'General purpose',
    parentSessionId: 'session_parent',
    mode: 'foreground' as const,
    depth: 1,
    cwd: '/workspace',
    prompt,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe('SubagentManager', () => {
  it('moves a spawned job from running to completed and stores the result', async () => {
    const manager = new SubagentManager({
      runner: createResolvedRunner('done'),
      now: () => '2026-04-30T00:00:00.000Z',
    });

    const created = await manager.spawn(createSpawnRequest('Summarize the project'));

    expect(created.status).toBe('running');

    const result: ISubagentJobResult = await manager.wait(created.id);
    const completed = manager.get(created.id);

    expect(result.output).toBe('done');
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toBe('done');
  });

  it('moves a failed runner result to failed and stores the error', async () => {
    const controlled = createControllableRunner();
    const manager = new SubagentManager({ runner: controlled.runner });
    const created = await manager.spawn(createSpawnRequest('Fail this job'));

    controlled.started[0]?.deferred.reject(new Error('boom'));

    await expect(manager.wait(created.id)).rejects.toThrow('boom');
    const failed = manager.get(created.id);

    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('boom');
  });

  it('cancels only the requested running job', async () => {
    const controlled = createControllableRunner();
    const manager = new SubagentManager({
      runner: controlled.runner,
      maxConcurrent: 2,
    });
    const first = await manager.spawn(createSpawnRequest('First job'));
    const second = await manager.spawn(createSpawnRequest('Second job'));

    await manager.cancel(first.id, 'stop first');

    await expect(manager.wait(first.id)).rejects.toThrow('stop first');
    expect(manager.get(first.id)?.status).toBe('cancelled');
    expect(manager.get(second.id)?.status).toBe('running');
    expect(controlled.started[0]?.cancelReason).toBe('stop first');
  });

  it('starts queued jobs only when capacity is available', async () => {
    const controlled = createControllableRunner();
    const manager = new SubagentManager({
      runner: controlled.runner,
      maxConcurrent: 1,
    });

    const first = await manager.spawn(createSpawnRequest('First job'));
    const second = await manager.spawn(createSpawnRequest('Second job'));

    expect(first.status).toBe('running');
    expect(second.status).toBe('queued');
    expect(controlled.started).toHaveLength(1);

    controlled.started[0]?.deferred.resolve({
      jobId: first.id,
      output: 'first done',
    });

    await manager.wait(first.id);
    await flushMicrotasks();

    expect(controlled.started).toHaveLength(2);
    expect(manager.get(second.id)?.status).toBe('running');
  });

  it('closes completed jobs from the registry', async () => {
    const manager = new SubagentManager({ runner: createResolvedRunner('done') });
    const created = await manager.spawn(createSpawnRequest('Close this job'));

    await manager.wait(created.id);
    await manager.close(created.id);

    expect(manager.get(created.id)).toBeUndefined();
  });
});
