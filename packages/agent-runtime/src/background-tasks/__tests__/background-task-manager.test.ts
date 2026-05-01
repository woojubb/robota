import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskManager } from '../background-task-manager.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '../types.js';

interface ITestDeferred {
  promise: Promise<IBackgroundTaskResult>;
  resolve: (result: IBackgroundTaskResult) => void;
  reject: (error: Error) => void;
}

interface IStartedTask {
  taskId: string;
  deferred: ITestDeferred;
  cancelReason?: string;
  emit?: IBackgroundTaskStart['emit'];
}

function createTestDeferred(): ITestDeferred {
  let resolveFn: (result: IBackgroundTaskResult) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<IBackgroundTaskResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function createControllableRunner(): { runner: IBackgroundTaskRunner; started: IStartedTask[] } {
  const started: IStartedTask[] = [];
  return {
    started,
    runner: {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        const deferred = createTestDeferred();
        const startedTask: IStartedTask = { taskId: task.taskId, deferred, emit: task.emit };
        started.push(startedTask);
        return {
          taskId: task.taskId,
          result: deferred.promise,
          cancel: (reason?: string) => {
            startedTask.cancelReason = reason;
            return Promise.resolve();
          },
        };
      },
    },
  };
}

function createRejectingCancelRunner(): {
  runner: IBackgroundTaskRunner;
  started: IStartedTask[];
} {
  const started: IStartedTask[] = [];
  return {
    started,
    runner: {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        const deferred = createTestDeferred();
        const startedTask: IStartedTask = { taskId: task.taskId, deferred, emit: task.emit };
        started.push(startedTask);
        return {
          taskId: task.taskId,
          result: deferred.promise,
          cancel: (reason?: string) => {
            startedTask.cancelReason = reason;
            deferred.reject(new Error(`runner observed cancel: ${reason ?? 'cancelled'}`));
            return Promise.resolve();
          },
        };
      },
    },
  };
}

function createResolvedRunner(output: string): IBackgroundTaskRunner {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      return {
        taskId: task.taskId,
        result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

function createAgentRequest(prompt: string) {
  return {
    kind: 'agent' as const,
    label: 'General purpose',
    parentSessionId: 'session_parent',
    mode: 'foreground' as const,
    depth: 1,
    cwd: '/workspace',
    agentType: 'general-purpose',
    prompt,
    permissionPolicy: 'inherit-allowlist' as const,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe('BackgroundTaskManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves a spawned task from running to completed and emits lifecycle events', async () => {
    const eventSink = vi.fn();
    const manager = new BackgroundTaskManager({
      runners: [createResolvedRunner('done')],
      now: () => '2026-04-30T00:00:00.000Z',
      eventSink,
    });

    const created = await manager.spawn(createAgentRequest('Summarize the project'));
    const result = await manager.wait(created.id);
    const completed = manager.get(created.id);

    expect(created.status).toBe('running');
    expect(result.output).toBe('done');
    expect(completed?.status).toBe('completed');
    expect(completed?.result?.output).toBe('done');
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'background_task_created' }),
    );
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'background_task_completed' }),
    );
  });

  it('projects runner worktree metadata onto completed task state', async () => {
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        return {
          taskId: task.taskId,
          result: Promise.resolve({
            taskId: task.taskId,
            kind: 'agent',
            output: 'done',
            metadata: {
              worktreePath: '/tmp/robota-worktree',
              branchName: 'robota/agent_1',
            },
          }),
          cancel: () => Promise.resolve(),
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner] });

    const created = await manager.spawn({
      ...createAgentRequest('Run in a worktree'),
      isolation: 'worktree',
    });
    await manager.wait(created.id);
    const completed = manager.get(created.id);

    expect(completed?.isolation).toBe('worktree');
    expect(completed?.worktreePath).toBe('/tmp/robota-worktree');
    expect(completed?.branchName).toBe('robota/agent_1');
  });

  it('queues tasks when maxConcurrent capacity is full', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      maxConcurrent: 1,
    });

    const first = await manager.spawn(createAgentRequest('First job'));
    const second = await manager.spawn(createAgentRequest('Second job'));

    expect(first.status).toBe('running');
    expect(second.status).toBe('queued');
    expect(controlled.started).toHaveLength(1);

    controlled.started[0]?.deferred.resolve({
      taskId: first.id,
      kind: 'agent',
      output: 'first done',
    });

    await manager.wait(first.id);
    await flushMicrotasks();

    expect(controlled.started).toHaveLength(2);
    expect(manager.get(second.id)?.status).toBe('running');
  });

  it('cancels a queued task without starting a runner', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      maxConcurrent: 1,
    });

    const first = await manager.spawn(createAgentRequest('First job'));
    const second = await manager.spawn(createAgentRequest('Second job'));

    await manager.cancel(second.id, 'skip queued');

    expect(controlled.started).toHaveLength(1);
    expect(manager.get(second.id)?.status).toBe('cancelled');
    await expect(manager.wait(second.id)).rejects.toThrow('skip queued');

    controlled.started[0]?.deferred.resolve({
      taskId: first.id,
      kind: 'agent',
      output: 'done',
    });
    await manager.wait(first.id);
    expect(controlled.started).toHaveLength(1);
  });

  it('cancels only the requested running task', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      maxConcurrent: 2,
    });

    const first = await manager.spawn(createAgentRequest('First job'));
    const second = await manager.spawn(createAgentRequest('Second job'));

    await manager.cancel(first.id, 'stop first');

    await expect(manager.wait(first.id)).rejects.toThrow('stop first');
    expect(manager.get(first.id)?.status).toBe('cancelled');
    expect(manager.get(second.id)?.status).toBe('running');
    expect(controlled.started[0]?.cancelReason).toBe('stop first');
  });

  it('keeps manual cancellation terminal when runner result rejects during cancel', async () => {
    const controlled = createRejectingCancelRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
    });

    const created = await manager.spawn(createAgentRequest('Cancel race'));
    await manager.cancel(created.id, 'user stop');
    await flushMicrotasks();

    await expect(manager.wait(created.id)).rejects.toThrow('user stop');
    expect(manager.get(created.id)?.status).toBe('cancelled');
    expect(manager.get(created.id)?.error?.message).toBe('user stop');
  });

  it('closes terminal tasks from the registry', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('done')] });
    const created = await manager.spawn(createAgentRequest('Close this job'));

    await manager.wait(created.id);
    await manager.close(created.id);

    expect(manager.get(created.id)).toBeUndefined();
  });

  it('returns structured unsupported errors for send and log reads', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('done')] });
    const created = await manager.spawn(createAgentRequest('Unsupported controls'));

    await expect(manager.send(created.id, { prompt: 'follow up' })).rejects.toThrow(
      'does not support input',
    );
    await expect(manager.readLog(created.id)).rejects.toThrow('does not support log reads');
  });

  it('projects runner text and tool events into task state and subscribers', async () => {
    const eventSink = vi.fn();
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        task.emit?.({
          type: 'background_task_tool_start',
          toolName: 'Read',
          firstArg: 'file.ts',
        });
        task.emit?.({ type: 'background_task_text_delta', delta: 'partial' });
        task.emit?.({
          type: 'background_task_tool_end',
          toolName: 'Read',
          success: true,
        });
        return {
          taskId: task.taskId,
          result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'done' }),
          cancel: () => Promise.resolve(),
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner], eventSink });

    const created = await manager.spawn(createAgentRequest('Report progress'));
    await manager.wait(created.id);

    expect(eventSink).toHaveBeenCalledWith({
      type: 'background_task_tool_start',
      taskId: created.id,
      toolName: 'Read',
      firstArg: 'file.ts',
    });
    expect(eventSink).toHaveBeenCalledWith({
      type: 'background_task_text_delta',
      taskId: created.id,
      delta: 'partial',
    });
    expect(eventSink).toHaveBeenCalledWith({
      type: 'background_task_tool_end',
      taskId: created.id,
      toolName: 'Read',
      success: true,
    });
    expect(manager.get(created.id)?.currentAction).toBeUndefined();
  });

  it('records last activity when background agent streams text', async () => {
    let callCount = 0;
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      now: () => {
        callCount += 1;
        return `2026-04-30T00:00:0${callCount}.000Z`;
      },
    });

    const created = await manager.spawn(createAgentRequest('Stream progress'));
    const started = controlled.started[0];

    started?.emit?.({ type: 'background_task_text_delta', delta: 'partial' });

    const current = manager.get(created.id);
    expect(current?.status).toBe('running');
    expect(current?.lastActivityAt).toBe('2026-04-30T00:00:03.000Z');
  });

  it('fails an inactive agent after idle timeout and cancels its runner', async () => {
    vi.useFakeTimers();
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      agentIdleTimeoutMs: 100,
    });

    const created = await manager.spawn(createAgentRequest('Wait too long'));
    await vi.advanceTimersByTimeAsync(101);

    await expect(manager.wait(created.id)).rejects.toThrow('produced no activity');
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.timeoutReason).toBe('idle');
    expect(controlled.started[0]?.cancelReason).toContain('produced no activity');
  });

  it('uses a four minute default idle timeout for inactive agents', async () => {
    vi.useFakeTimers();
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
    });

    const created = await manager.spawn(createAgentRequest('Use default timeout'));
    await vi.advanceTimersByTimeAsync(120_001);
    expect(manager.get(created.id)?.status).toBe('running');

    await vi.advanceTimersByTimeAsync(120_000);

    await expect(manager.wait(created.id)).rejects.toThrow('produced no activity for 240000ms');
    expect(manager.get(created.id)?.timeoutReason).toBe('idle');
  });

  it('keeps timeout failure terminal when runner result rejects during watchdog cancel', async () => {
    vi.useFakeTimers();
    const controlled = createRejectingCancelRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      agentIdleTimeoutMs: 100,
    });

    const created = await manager.spawn(createAgentRequest('Timeout race'));
    await vi.advanceTimersByTimeAsync(101);
    await flushMicrotasks();

    await expect(manager.wait(created.id)).rejects.toThrow('produced no activity');
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.error?.category).toBe('timeout');
    expect(manager.get(created.id)?.timeoutReason).toBe('idle');
  });

  it('treats legacy agent timeoutMs as an idle timeout', async () => {
    vi.useFakeTimers();
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      agentIdleTimeoutMs: 1_000,
    });

    const created = await manager.spawn({
      ...createAgentRequest('Legacy timeout'),
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(26);

    await expect(manager.wait(created.id)).rejects.toThrow('produced no activity');
    expect(manager.get(created.id)?.timeoutReason).toBe('idle');
  });

  it('keeps idle timer alive on text activity but fails on max runtime', async () => {
    vi.useFakeTimers();
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      agentIdleTimeoutMs: 50,
      agentMaxRuntimeMs: 120,
    });

    const created = await manager.spawn(createAgentRequest('Never finish'));
    await vi.advanceTimersByTimeAsync(40);
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: 'still working' });
    await vi.advanceTimersByTimeAsync(40);
    expect(manager.get(created.id)?.status).toBe('running');
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: 'still working' });
    await vi.advanceTimersByTimeAsync(41);

    await expect(manager.wait(created.id)).rejects.toThrow('exceeded max runtime');
    expect(manager.get(created.id)?.timeoutReason).toBe('max_runtime');
  });

  it('does not enforce a default max runtime cap while an agent remains active', async () => {
    vi.useFakeTimers();
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
    });

    const created = await manager.spawn(createAgentRequest('Work for a long time'));
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(230_000);
      controlled.started[0]?.emit?.({
        type: 'background_task_text_delta',
        delta: `still active ${i}`,
      });
    }

    expect(manager.get(created.id)?.status).toBe('running');

    await manager.cancel(created.id, 'test cleanup');
  });

  it('fails a streaming agent that exceeds output limits', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      agentOutputLimitBytes: 8,
    });

    const created = await manager.spawn(createAgentRequest('Write too much'));
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: '12345' });
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: '6789' });

    await expect(manager.wait(created.id)).rejects.toThrow('exceeded output limit');
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.timeoutReason).toBe('output_limit');
  });

  it('fails a streaming agent that repeats the same delta', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      repetitionThreshold: 3,
    });

    const created = await manager.spawn(createAgentRequest('Loop forever'));
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: 'same sentence.' });
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: 'same sentence.' });
    controlled.started[0]?.emit?.({ type: 'background_task_text_delta', delta: 'same sentence.' });

    await expect(manager.wait(created.id)).rejects.toThrow('repetitive output');
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.timeoutReason).toBe('repetition');
  });

  it('shutdown cancels queued and running tasks exactly once', async () => {
    const controlled = createControllableRunner();
    const manager = new BackgroundTaskManager({
      runners: [controlled.runner],
      maxConcurrent: 1,
    });

    const first = await manager.spawn(createAgentRequest('First'));
    const second = await manager.spawn(createAgentRequest('Second'));

    await manager.shutdown('session shutdown');
    await manager.shutdown('session shutdown again');

    expect(manager.get(first.id)?.status).toBe('cancelled');
    expect(manager.get(second.id)?.status).toBe('cancelled');
    expect(controlled.started).toHaveLength(1);
    expect(controlled.started[0]?.cancelReason).toBe('session shutdown');
    await expect(manager.wait(first.id)).rejects.toThrow('session shutdown');
    await expect(manager.wait(second.id)).rejects.toThrow('session shutdown');
  });
});
