import { describe, expect, it, vi } from 'vitest';
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
        const startedTask: IStartedTask = { taskId: task.taskId, deferred };
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
});
