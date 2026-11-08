import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../subagent-manager.js';
import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentRunner,
  ISubagentSpawnRequest,
} from '../types.js';
import type { ITokenUsage } from '@robota-sdk/agent-core';

interface ITestDeferred {
  promise: Promise<ISubagentJobResult>;
  resolve: (result: ISubagentJobResult) => void;
  reject: (error: Error) => void;
}

interface IStartedJob {
  taskId: string;
  deferred: ITestDeferred;
  cancelReason?: string;
  /** Every prompt the job was handed with `send`, in order. */
  sent: string[];
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
          taskId: job.taskId,
          deferred,
          sent: [],
        };
        started.push(startedJob);
        return {
          taskId: job.taskId,
          result: deferred.promise,
          cancel: (reason?: string) => {
            startedJob.cancelReason = reason;
            return Promise.resolve();
          },
          send: (prompt: string) => {
            startedJob.sent.push(prompt);
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
        taskId: job.taskId,
        result: Promise.resolve({
          taskId: job.taskId,
          output,
        }),
        cancel: () => Promise.resolve(),
        send: () => Promise.resolve(),
      };
    },
  };
}

/** A runner whose result carries the `usage` field the contract declares. */
function createUsageReportingRunner(output: string, usage: ITokenUsage): ISubagentRunner {
  return {
    start(job: ISubagentJobStart): ISubagentJobHandle {
      return {
        taskId: job.taskId,
        result: Promise.resolve({ taskId: job.taskId, output, usage }),
        cancel: () => Promise.resolve(),
        send: () => Promise.resolve(),
      };
    },
  };
}

function createSpawnRequest(prompt: string): ISubagentSpawnRequest {
  return {
    agentType: 'general-purpose',
    label: 'General purpose',
    parentSessionId: 'session_parent',
    mode: 'foreground' as const,
    depth: 1,
    cwd: '/workspace',
    prompt,
    permissionPolicy: 'inherit-allowlist',
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

  // `ISubagentJobResult.usage` is declared and populated end to end, but
  // `wait()` projected `{ taskId, output, metadata }` and dropped it — so its readers saw `undefined`
  // structurally, always. The field was born dropped: the commit that added `usage` to
  // `toBackgroundResult` never touched `wait()`.
  it('wait() carries the declared usage through to its caller', async () => {
    const usage: ITokenUsage = { promptTokens: 120, completionTokens: 45, totalTokens: 165 };
    const manager = new SubagentManager({
      runner: createUsageReportingRunner('done', usage),
      now: () => '2026-04-30T00:00:00.000Z',
    });

    const created = await manager.spawn(createSpawnRequest('Summarize the project'));
    const result = await manager.wait(created.id);

    expect(result.usage).toEqual(usage);
  });

  // Guards the SHAPE of the fix, not the pre-fix code: this case passes against unfixed `wait()` too
  // (it returned a three-key literal). It fails on the plausible mutant `usage: result.usage`, which adds
  // an `undefined`-valued key and compiles because `exactOptionalPropertyTypes` is off. The red-proof is
  // the case above.
  it('wait() omits usage entirely when the runner reported none', async () => {
    const manager = new SubagentManager({
      runner: createResolvedRunner('done'),
      now: () => '2026-04-30T00:00:00.000Z',
    });

    const created = await manager.spawn(createSpawnRequest('Summarize the project'));
    const result = await manager.wait(created.id);

    // Absent, not `undefined`-valued — the conditional spread mirrors `toBackgroundResult`.
    expect('usage' in result).toBe(false);
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

  // `send` steers a running job, so it reaches the job's own handle with the prompt, and a
  // send with nothing to say never does — an empty turn would fail the job it was meant to steer.
  it('hands a sent prompt to the running job', async () => {
    const controlled = createControllableRunner();
    const manager = new SubagentManager({ runner: controlled.runner });
    const job = await manager.spawn(createSpawnRequest('Long job'));

    await manager.send(job.id, 'also check the tests');

    expect(controlled.started[0]?.sent).toEqual(['also check the tests']);
  });

  it('refuses a send with no prompt before it reaches the job', async () => {
    const controlled = createControllableRunner();
    const manager = new SubagentManager({ runner: controlled.runner });
    const job = await manager.spawn(createSpawnRequest('Long job'));

    await expect(manager.send(job.id, '')).rejects.toThrow('takes a prompt to send');
    await expect(manager.send(job.id, '   ')).rejects.toThrow('takes a prompt to send');

    expect(controlled.started[0]?.sent).toEqual([]);
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
      taskId: first.id,
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

/**
 * Whether a subagent's transcript is sealed is the runner's handle's to say, and the
 * manager projects it into the task state, which is persisted: a task restored in a later session,
 * a job-group result and a hook all say the same thing as the live task.
 */
describe('SubagentManager — a sealed transcript is part of the task state', () => {
  function sealedRunner(sealed: boolean): ISubagentRunner {
    return {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          taskId: job.taskId,
          transcriptPath: `/logs/${job.taskId}.jsonl`,
          ...(sealed ? { transcriptSealed: true as const } : {}),
          result: Promise.resolve({ taskId: job.taskId, output: 'done' }),
          cancel: () => Promise.resolve(),
          send: () => Promise.resolve(),
        };
      },
    };
  }

  it('shows on the task, the job state and every snapshot from the start, through the end', async () => {
    const manager = new SubagentManager({ runner: sealedRunner(true) });
    const tasks = manager.getBackgroundTaskManager();
    const seen: Array<boolean | undefined> = [];
    tasks.subscribe((event) => {
      if (event.type === 'background_task_updated' || event.type === 'background_task_completed') {
        seen.push(event.task.transcriptSealed);
      }
    });

    const created = await manager.spawn(createSpawnRequest('Work'));
    expect(tasks.get(created.id)?.transcriptSealed).toBe(true);
    expect(manager.get(created.id)?.transcriptSealed).toBe(true);
    await manager.wait(created.id);

    expect(tasks.get(created.id)?.transcriptSealed).toBe(true);
    expect(tasks.get(created.id)?.transcriptPath).toBe(`/logs/${created.id}.jsonl`);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((flag) => flag === true)).toBe(true);
  });

  it('is absent for a plain transcript', async () => {
    const manager = new SubagentManager({ runner: sealedRunner(false) });
    const created = await manager.spawn(createSpawnRequest('Work'));
    await manager.wait(created.id);

    const state = manager.getBackgroundTaskManager().get(created.id);
    expect(state?.transcriptPath).toBeDefined();
    expect(state).not.toHaveProperty('transcriptSealed');
  });
});
