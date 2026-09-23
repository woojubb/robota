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
        };
        started.push(startedJob);
        return {
          taskId: job.taskId,
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
        taskId: job.taskId,
        result: Promise.resolve({
          taskId: job.taskId,
          output,
        }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

/** A runner whose result carries the ANALYTICS-001 `usage` field the contract declares. */
function createUsageReportingRunner(output: string, usage: ITokenUsage): ISubagentRunner {
  return {
    start(job: ISubagentJobStart): ISubagentJobHandle {
      return {
        taskId: job.taskId,
        result: Promise.resolve({ taskId: job.taskId, output, usage }),
        cancel: () => Promise.resolve(),
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

  // ARCH-025: `ISubagentJobResult.usage` is declared (ANALYTICS-001) and populated end to end, but
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
