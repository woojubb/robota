/**
 * FLOW-001 (Layer 1): the scheduled-task wake-event foundation.
 * - The scheduled request may carry an `agentInstruction` and omit `command`.
 * - The runner's `background_task_waking` event carries that instruction.
 * - The manager propagates a manager-level `background_task_waking { taskId, instruction }`
 *   (previously this event was swallowed).
 */

import { describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-task-manager.js';
import { createScheduledTaskRunner } from '../runners/scheduled-task-runner.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IScheduledBackgroundTaskRequest,
  TBackgroundTaskEvent,
  TBackgroundTaskRunnerEvent,
} from '../types.js';

function scheduledRequest(
  overrides: Partial<IScheduledBackgroundTaskRequest> = {},
): IScheduledBackgroundTaskRequest {
  return {
    kind: 'scheduled',
    label: 'wake',
    parentSessionId: 'session_parent',
    mode: 'background',
    depth: 1,
    cwd: '/workspace',
    cronExpression: '0 0 * * *',
    ...overrides,
  };
}

interface IFakeScheduled {
  runner: IBackgroundTaskRunner;
  started: Array<{ taskId: string; emit?: IBackgroundTaskStart['emit'] }>;
}

/** A scheduled runner that never fires on its own — the test drives its emit() directly. */
function createFakeScheduledRunner(): IFakeScheduled {
  const started: IFakeScheduled['started'] = [];
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      started.push({ taskId: task.taskId, emit: task.emit });
      return {
        taskId: task.taskId,
        result: new Promise<never>(() => {}), // sleeping — never resolves
        cancel: () => Promise.resolve(),
      };
    },
  };
  return { runner, started };
}

function driveFire(
  emit: IBackgroundTaskStart['emit'],
  waking: Extract<TBackgroundTaskRunnerEvent, { type: 'background_task_waking' }>,
): void {
  // Mirror the real lifecycle: sleeping → waking, so the status transition is valid.
  emit?.({ type: 'background_task_sleeping', nextFireAt: '2030-01-01T00:00:00.000Z' });
  emit?.(waking);
}

describe('FLOW-001 scheduled agent-wake foundation', () => {
  it('TC-01: scheduled runner accepts an agentInstruction-only request (no command)', () => {
    const emitted: TBackgroundTaskRunnerEvent[] = [];
    const runner = createScheduledTaskRunner();
    const handle = runner.start({
      taskId: 't1',
      // Far-future cron so no fire happens during the test (no wall-clock coupling).
      request: scheduledRequest({ agentInstruction: 'wake me', cronExpression: '0 0 1 1 *' }),
      emit: (event) => emitted.push(event),
    });

    expect(handle.taskId).toBe('t1');
    expect(emitted.some((e) => e.type === 'background_task_sleeping')).toBe(true);
    return handle.cancel();
  });

  it('TC-02: manager propagates background_task_waking with the agent instruction', async () => {
    const { runner, started } = createFakeScheduledRunner();
    const events: TBackgroundTaskEvent[] = [];
    const manager = new BackgroundTaskManager({
      runners: [runner],
      eventSink: (e) => events.push(e),
    });

    const created = await manager.spawn(scheduledRequest({ agentInstruction: 'check the build' }));
    await Promise.resolve();

    driveFire(started[0]?.emit, { type: 'background_task_waking', instruction: 'check the build' });

    const waking = events.find((e) => e.type === 'background_task_waking');
    expect(waking).toEqual({
      type: 'background_task_waking',
      taskId: created.id,
      instruction: 'check the build',
    });
  });

  it('TC-03: a shell-only wake carries no instruction (no regression)', async () => {
    const { runner, started } = createFakeScheduledRunner();
    const events: TBackgroundTaskEvent[] = [];
    const manager = new BackgroundTaskManager({
      runners: [runner],
      eventSink: (e) => events.push(e),
    });

    const created = await manager.spawn(scheduledRequest({ command: 'echo hi' }));
    await Promise.resolve();

    driveFire(started[0]?.emit, { type: 'background_task_waking' });

    const waking = events.find(
      (e): e is Extract<TBackgroundTaskEvent, { type: 'background_task_waking' }> =>
        e.type === 'background_task_waking',
    );
    expect(waking).toBeDefined();
    expect(waking?.taskId).toBe(created.id);
    expect(waking?.instruction).toBeUndefined();
  });
});

describe('SCREEN-1992 one-shot schedules reach a terminal state (TC-08)', () => {
  it('a one-shot agent-wake schedule fires once and then resolves its handle (manager → completed)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const emitted: TBackgroundTaskRunnerEvent[] = [];
      const runner = createScheduledTaskRunner();
      const handle = runner.start({
        taskId: 'once_1',
        request: scheduledRequest({
          agentInstruction: 'say hello',
          cronExpression: '2026-01-01T00:00:05.000Z',
        }),
        emit: (event) => emitted.push(event),
      });
      expect(emitted.at(-1)?.type).toBe('background_task_sleeping');

      await vi.advanceTimersByTimeAsync(6_000);
      expect(emitted.some((e) => e.type === 'background_task_waking')).toBe(true);
      // No second sleeping after the only fire — the handle resolves instead of hanging forever.
      expect(emitted.filter((e) => e.type === 'background_task_sleeping')).toHaveLength(1);
      await expect(handle.result).resolves.toMatchObject({ taskId: 'once_1', kind: 'scheduled' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a recurring schedule re-arms to sleeping after a fire and does not resolve', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
      const emitted: TBackgroundTaskRunnerEvent[] = [];
      const runner = createScheduledTaskRunner();
      const handle = runner.start({
        taskId: 'every_1',
        request: scheduledRequest({ agentInstruction: 'tick', cronExpression: '* * * * *' }),
        emit: (event) => emitted.push(event),
      });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(emitted.filter((e) => e.type === 'background_task_waking')).toHaveLength(1);
      expect(emitted.filter((e) => e.type === 'background_task_sleeping')).toHaveLength(2);
      let settled = false;
      void handle.result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await handle.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
