import { describe, expect, it, vi } from 'vitest';

import { subagentExecutionRoot } from '../execution-root.js';
import type { IHookInput, THookOutcome, IHookTypeExecutor } from '@robota-sdk/agent-core';
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
  worktreePath: '/repo/.fixture-state/worktrees/agent_1',
  branchName: 'agent/worker_1',
};

function createJob(isolation?: TBackgroundTaskIsolation): ISubagentJobStart {
  return {
    taskId: 'agent_1',
    request: {
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_1',
      mode: 'background',
      depth: 1,
      cwd: '/repo',
      prompt: 'do work',
      permissionPolicy: 'inherit-allowlist',
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
          taskId: job.taskId,
          result: Promise.resolve({
            taskId: job.taskId,
            output: 'completed',
            metadata: { existing: 'value' },
          }),
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
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
      hookTypeExecutors: [],
    });

    const result = await runner.start(createJob('worktree')).result;

    // ARCH-031: the runner no longer rewrites `request.cwd` to the worktree. The request keeps what the
    // CALLER asked for; the worktree the runner PREPARED rides on the envelope, and
    // `subagentExecutionRoot` is the single answer to which of the two the child runs in. Rewriting cwd
    // as well gave that rule two carriers that could disagree — the duplication ARCH-010 exists to prevent.
    expect(captured.getJob()?.request.cwd).toBe('/repo');
    expect(captured.getJob()?.worktree?.path).toBe(TEST_WORKTREE.worktreePath);
    expect(subagentExecutionRoot(captured.getJob()!)).toBe(TEST_WORKTREE.worktreePath);
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
      hookTypeExecutors: [],
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
          taskId: job.taskId,
          result: Promise.reject(new Error('worker failed')),
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: failingRunner,
      worktreeAdapter: adapter,
      hookTypeExecutors: [],
    });

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
    const runner = new WorktreeSubagentRunner({
      runner: failingRunner,
      worktreeAdapter: adapter,
      hookTypeExecutors: [],
    });

    expect(() => runner.start(createJob('worktree'))).toThrow('startup failed');
    expect(adapter.removed).toEqual([TEST_WORKTREE]);
  });

  it('removes a clean worktree when an isolated job is cancelled', async () => {
    const adapter = createAdapter(true);
    const deferred = createDeferredResult();
    const cancellableRunner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          taskId: job.taskId,
          result: deferred.promise,
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: cancellableRunner,
      worktreeAdapter: adapter,
      hookTypeExecutors: [],
    });

    const handle = runner.start(createJob('worktree'));
    await handle.cancel('stop requested');
    await Promise.resolve();
    deferred.resolve({ taskId: 'agent_1', output: 'cancelled after cleanup' });
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
          taskId: job.taskId,
          result: new Promise<ISubagentJobResult>(() => undefined),
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: cancellableRunner,
      worktreeAdapter: adapter,
      hookTypeExecutors: [],
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
      hookTypeExecutors: [],
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
      hookTypeExecutors: [],
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
      execute: async (_definition, input): Promise<THookOutcome> => {
        hookInputs.push(input);
        return { outcome: 'allow', source: 'prompt', stdout: '' };
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
    expect(hookInputs[0]?.tool_input).toMatchObject({ taskId: 'agent_1', removed: false });
    expect(hookInputs[1]?.tool_input).toMatchObject({ taskId: 'agent_1', removed: true });
  });
});

/**
 * #3679 step 3b: `/fork` runs in a worktree by default, so a handle the worktree runner rebuilds must
 * keep what the inner runner's handle offers for its transcript — the paged read, the paths and the
 * in-memory fact that the transcript is sealed — or the parent can neither read the log nor say it is
 * sealed.
 */
describe('WorktreeSubagentRunner keeps the transcript of the handle it wraps', () => {
  it('forwards the log read, the transcript and log paths, and sealedness', async () => {
    const pages: unknown[] = [];
    const inner: ISubagentRunner = {
      start(job) {
        return {
          taskId: job.taskId,
          logPath: '/logs/session_1/subagents/session_fork.jsonl',
          transcriptPath: '/logs/session_1/subagents/session_fork.jsonl',
          transcriptSealed: true,
          result: Promise.resolve({ taskId: job.taskId, output: 'done' }),
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
          readLog: async (cursor) => {
            pages.push(cursor);
            return { taskId: job.taskId, lines: ['a record'] };
          },
        };
      },
    };
    const runner = new WorktreeSubagentRunner({
      runner: inner,
      worktreeAdapter: createAdapter(true),
      hookTypeExecutors: [],
    });

    const handle = runner.start(createJob('worktree'));
    const page = await handle.readLog?.({ offset: 3 });
    await handle.result;

    expect(handle.transcriptPath).toBe('/logs/session_1/subagents/session_fork.jsonl');
    expect(handle.logPath).toBe('/logs/session_1/subagents/session_fork.jsonl');
    expect(handle.transcriptSealed).toBe(true);
    expect(page).toEqual({ taskId: 'agent_1', lines: ['a record'] });
    expect(pages).toEqual([{ offset: 3 }]);
  });

  it('adds none of the optional ones when the wrapped handle has none', () => {
    const runner = new WorktreeSubagentRunner({
      runner: createCapturedRunner().runner,
      worktreeAdapter: createAdapter(true),
      hookTypeExecutors: [],
    });

    const handle = runner.start(createJob('worktree'));

    expect(Object.keys(handle).sort()).toEqual(['cancel', 'result', 'send', 'taskId']);
  });

  it('hands a follow-up prompt to the job it wraps, as it was sent', async () => {
    const sent: string[] = [];
    const runner = new WorktreeSubagentRunner({
      runner: {
        start: (job: ISubagentJobStart): ISubagentJobHandle => ({
          taskId: job.taskId,
          result: Promise.resolve({ taskId: job.taskId, output: 'done' }),
          cancel: () => Promise.resolve(),
          send: (prompt) => {
            sent.push(prompt);
            return Promise.resolve();
          },
        }),
      },
      worktreeAdapter: createAdapter(true),
      hookTypeExecutors: [],
    });

    await runner.start(createJob('worktree')).send('and another thing');

    expect(sent).toEqual(['and another thing']);
  });
});

/**
 * #3679 step 3b: what a runner refuses before it starts a job — a sealing projection that cannot hand
 * the child what it needs — must leave nothing behind, and `/fork` isolates in a worktree by default,
 * so those checks run before a worktree is prepared or any worktree hook fires.
 */
describe('WorktreeSubagentRunner runs the inner runner’s preflight first', () => {
  it('before preparing the worktree, then starts the prepared job alone', () => {
    const order: string[] = [];
    const adapter = createAdapter(true);
    const prepare = vi.fn(() => {
      order.push('prepare');
      return TEST_WORKTREE;
    });
    adapter.prepare = prepare;
    const started: unknown[][] = [];
    const inner: ISubagentRunner = {
      preflight(job) {
        order.push(
          `preflight ${job.taskId} ${job.worktree === undefined ? 'unprepared' : 'prepared'}`,
        );
      },
      start(...args: Parameters<ISubagentRunner['start']>) {
        order.push(`start ${args[0].worktree === undefined ? 'unprepared' : 'prepared'}`);
        started.push(args);
        return createCapturedRunner().runner.start(args[0]);
      },
    };

    new WorktreeSubagentRunner({
      runner: inner,
      worktreeAdapter: adapter,
      hookTypeExecutors: [],
    }).start(createJob('worktree'));

    expect(order).toEqual(['preflight agent_1 unprepared', 'prepare', 'start prepared']);
    expect(started.map((args) => args.length)).toEqual([1]);
  });

  it('prepares no worktree and fires no hook when the preflight refuses the job', async () => {
    const adapter = createAdapter(true);
    const prepare = vi.fn(() => TEST_WORKTREE);
    adapter.prepare = prepare;
    const start = vi.fn();
    const hookCalls: IHookInput[] = [];
    const executor: IHookTypeExecutor = {
      type: 'prompt',
      execute: async (_definition, input): Promise<THookOutcome> => {
        hookCalls.push(input);
        return { outcome: 'allow', source: 'prompt', stdout: '' };
      },
    };
    const inner: ISubagentRunner = {
      preflight() {
        throw new Error('the subagent was not started');
      },
      start,
    };
    const runner = new WorktreeSubagentRunner({
      runner: inner,
      worktreeAdapter: adapter,
      hooks: {
        WorktreeCreate: [{ matcher: 'Agent', hooks: [{ type: 'prompt', prompt: 'create' }] }],
      },
      hookTypeExecutors: [executor],
    });

    expect(() => runner.start(createJob('worktree'))).toThrow('the subagent was not started');
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(hookCalls).toEqual([]);
  });
});
