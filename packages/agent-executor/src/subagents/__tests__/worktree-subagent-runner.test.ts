import { describe, expect, it } from 'vitest';
import type { IHookInput, IHookResult, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentRunner,
} from '../index.js';
import type { TBackgroundTaskIsolation } from '../../background-tasks/index.js';
import {
  WorktreeSubagentRunner,
  type IPreparedSubagentWorktree,
  type ISubagentWorktreeAdapter,
} from '../worktree-subagent-runner.js';

interface ICapturedRunner {
  runner: ISubagentRunner;
  getJob: () => ISubagentJobStart | undefined;
}

interface IFakeWorktreeAdapter extends ISubagentWorktreeAdapter {
  removed: IPreparedSubagentWorktree[];
  status: string;
  worktree: IPreparedSubagentWorktree;
}

const TEST_WORKTREE: IPreparedSubagentWorktree = {
  repoRoot: '/repo',
  worktreePath: '/repo/.robota/worktrees/agent_1',
  branchName: 'robota/agent_1',
};

function createJob(isolation?: TBackgroundTaskIsolation): ISubagentJobStart {
  return {
    jobId: 'agent_1',
    request: {
      type: 'tester',
      label: 'Tester',
      parentSessionId: 'session_1',
      mode: 'background',
      depth: 1,
      cwd: '/repo',
      prompt: 'do work',
      ...(isolation ? { isolation } : {}),
    },
  };
}

function createCapturedRunner(onStart?: (job: ISubagentJobStart) => void): ICapturedRunner {
  let capturedJob: ISubagentJobStart | undefined;
  return {
    getJob: () => capturedJob,
    runner: {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        capturedJob = job;
        onStart?.(job);
        return {
          jobId: job.jobId,
          result: Promise.resolve({
            jobId: job.jobId,
            output: 'completed',
            metadata: { existing: 'value' },
          }),
          cancel: () => Promise.resolve(),
        };
      },
    },
  };
}

function createAdapter(clean: boolean, status = '?? dirty.txt'): IFakeWorktreeAdapter {
  return {
    removed: [],
    status,
    worktree: TEST_WORKTREE,
    prepare() {
      return this.worktree;
    },
    isClean: () => clean,
    getStatus() {
      return this.status;
    },
    remove(worktree) {
      this.removed.push(worktree);
    },
  };
}

function createDeferredResult(): {
  promise: Promise<ISubagentJobResult>;
  resolve: (result: ISubagentJobResult) => void;
  reject: (error: Error) => void;
} {
  let resolveFn: (result: ISubagentJobResult) => void = () => undefined;
  let rejectFn: (error: Error) => void = () => undefined;
  const promise = new Promise<ISubagentJobResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.catch(() => undefined);
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function getStringMetadata(result: Record<string, string | number | boolean>, key: string): string {
  const value = result[key];
  if (typeof value !== 'string') throw new Error(`Expected string metadata for ${key}`);
  return value;
}

describe('WorktreeSubagentRunner', () => {
  it('runs isolated jobs in a prepared worktree and removes clean worktrees', async () => {
    const adapter = createAdapter(true);
    const captured = createCapturedRunner();
    const runner = new WorktreeSubagentRunner({
      runner: captured.runner,
      worktreeAdapter: adapter,
    });

    const result = await runner.start(createJob('worktree')).result;

    expect(captured.getJob()?.request.cwd).toBe(TEST_WORKTREE.worktreePath);
    expect(adapter.removed).toEqual([TEST_WORKTREE]);
    expect(result.metadata).toEqual({
      existing: 'value',
      isolation: 'worktree',
      worktreeRemoved: true,
    });
  });

  it('preserves dirty worktrees and returns handoff metadata', async () => {
    const adapter = createAdapter(false);
    const captured = createCapturedRunner();
    const runner = new WorktreeSubagentRunner({
      runner: captured.runner,
      worktreeAdapter: adapter,
    });

    const result = await runner.start(createJob('worktree')).result;
    const metadata = result.metadata ?? {};

    expect(adapter.removed).toEqual([]);
    expect(getStringMetadata(metadata, 'worktreePath')).toBe(TEST_WORKTREE.worktreePath);
    expect(getStringMetadata(metadata, 'branchName')).toBe(TEST_WORKTREE.branchName);
    expect(metadata.worktreeRemoved).toBe(false);
    expect(getStringMetadata(metadata, 'worktreeStatus')).toBe('?? dirty.txt');
    expect(getStringMetadata(metadata, 'worktreeNextAction')).toContain(TEST_WORKTREE.worktreePath);
    expect(getStringMetadata(metadata, 'worktreeNextAction')).toContain(TEST_WORKTREE.branchName);
  });

  it('removes a clean worktree when the delegated job fails', async () => {
    const adapter = createAdapter(true);
    const failingRunner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          jobId: job.jobId,
          result: Promise.reject(new Error('worker failed')),
          cancel: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({ runner: failingRunner, worktreeAdapter: adapter });

    await expect(runner.start(createJob('worktree')).result).rejects.toThrow('worker failed');
    expect(adapter.removed).toEqual([TEST_WORKTREE]);
  });

  it('removes a clean worktree when delegated startup throws synchronously', () => {
    const adapter = createAdapter(true);
    const failingRunner: ISubagentRunner = {
      start(): ISubagentJobHandle {
        throw new Error('startup failed');
      },
    };
    const runner = new WorktreeSubagentRunner({ runner: failingRunner, worktreeAdapter: adapter });

    expect(() => runner.start(createJob('worktree'))).toThrow('startup failed');
    expect(adapter.removed).toEqual([TEST_WORKTREE]);
  });

  it('removes a clean worktree when an isolated job is cancelled', async () => {
    const adapter = createAdapter(true);
    const deferred = createDeferredResult();
    const cancellableRunner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          jobId: job.jobId,
          result: deferred.promise,
          cancel: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: cancellableRunner,
      worktreeAdapter: adapter,
    });

    const handle = runner.start(createJob('worktree'));
    await handle.cancel('stop requested');
    await Promise.resolve();
    deferred.resolve({ jobId: 'agent_1', output: 'cancelled after cleanup' });
    const result = await handle.result;

    expect(adapter.removed).toEqual([TEST_WORKTREE]);
    expect(result.metadata).toMatchObject({
      isolation: 'worktree',
      worktreeRemoved: true,
    });
  });

  it('preserves a dirty worktree when an isolated job is cancelled', async () => {
    const adapter = createAdapter(false);
    const cancellableRunner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          jobId: job.jobId,
          result: new Promise<ISubagentJobResult>(() => undefined),
          cancel: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: cancellableRunner,
      worktreeAdapter: adapter,
    });

    const handle = runner.start(createJob('worktree'));
    await handle.cancel('stop requested');
    await Promise.resolve();

    expect(adapter.removed).toEqual([]);
  });

  it('includes base revision and parent status in dirty worktree handoff metadata', async () => {
    const adapter = createAdapter(false, ' M changed.ts');
    adapter.worktree = {
      ...TEST_WORKTREE,
      baseRevision: '1234567890abcdef',
      parentStatus: ' M README.md',
    };
    const captured = createCapturedRunner();
    const runner = new WorktreeSubagentRunner({
      runner: captured.runner,
      worktreeAdapter: adapter,
    });

    const result = await runner.start(createJob('worktree')).result;

    expect(result.metadata).toMatchObject({
      worktreeBaseRevision: '1234567890abcdef',
      parentWorktreeStatus: ' M README.md',
    });
    expect(getStringMetadata(result.metadata ?? {}, 'worktreeNextAction')).toContain(
      'Parent checkout had uncommitted changes',
    );
  });

  it('delegates non-worktree jobs without changing cwd', async () => {
    const adapter = createAdapter(true);
    const captured = createCapturedRunner();
    const runner = new WorktreeSubagentRunner({
      runner: captured.runner,
      worktreeAdapter: adapter,
    });

    const result = await runner.start(createJob()).result;

    expect(captured.getJob()?.request.cwd).toBe('/repo');
    expect(adapter.removed).toEqual([]);
    expect(result.metadata).toEqual({ existing: 'value' });
  });

  it('fires worktree lifecycle hooks around clean worktree execution', async () => {
    const hookInputs: IHookInput[] = [];
    const hookExecutor: IHookTypeExecutor = {
      type: 'prompt',
      execute: async (_definition, input): Promise<IHookResult> => {
        hookInputs.push(input);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: createCapturedRunner().runner,
      worktreeAdapter: createAdapter(true),
      hookTypeExecutors: [hookExecutor],
      hooks: {
        WorktreeCreate: [{ matcher: 'Agent', hooks: [{ type: 'prompt', prompt: 'create' }] }],
        WorktreeRemove: [{ matcher: 'Agent', hooks: [{ type: 'prompt', prompt: 'remove' }] }],
      },
    });

    await runner.start(createJob('worktree')).result;
    await Promise.resolve();

    expect(hookInputs.map((input) => input.hook_event_name)).toEqual([
      'WorktreeCreate',
      'WorktreeRemove',
    ]);
    expect(hookInputs[0]?.tool_input).toMatchObject({ jobId: 'agent_1', removed: false });
    expect(hookInputs[1]?.tool_input).toMatchObject({ jobId: 'agent_1', removed: true });
  });
});
