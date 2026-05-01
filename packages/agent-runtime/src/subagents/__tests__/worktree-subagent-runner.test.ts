import { describe, expect, it } from 'vitest';
import type { IHookInput, IHookResult, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { ISubagentJobHandle, ISubagentJobStart, ISubagentRunner } from '../index.js';
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

function createAdapter(clean: boolean): IFakeWorktreeAdapter {
  return {
    removed: [],
    prepare: () => TEST_WORKTREE,
    isClean: () => clean,
    remove(worktree) {
      this.removed.push(worktree);
    },
  };
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
