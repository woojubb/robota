/**
 * SELFHOST-012 P1 — manager schedule-lifecycle verbs (pause/resume/edit) + list view.
 * Uses a fake scheduled runner whose handle records the lifecycle calls and drives the sleeping event.
 */

import { describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-task-manager.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IScheduledBackgroundTaskRequest,
  IScheduleEditPatch,
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
    agentInstruction: 'wake',
    ...overrides,
  };
}

interface IFakeHandle extends IBackgroundTaskHandle {
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  editSchedule: ReturnType<typeof vi.fn>;
}

function createFakeScheduledRunner(): { runner: IBackgroundTaskRunner; handles: IFakeHandle[] } {
  const handles: IFakeHandle[] = [];
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      const emit = task.emit ?? (() => undefined);
      // announce the initial sleeping state so the manager status is `sleeping`
      emit({ type: 'background_task_sleeping', nextFireAt: '2030-01-01T00:00:00.000Z' });
      const handle: IFakeHandle = {
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel: () => Promise.resolve(),
        pause: vi.fn(() => Promise.resolve()),
        // resume re-emits sleeping (like the real croner runner)
        resume: vi.fn(() => {
          emit({ type: 'background_task_sleeping', nextFireAt: '2030-01-02T00:00:00.000Z' });
          return Promise.resolve();
        }),
        editSchedule: vi.fn((_patch: IScheduleEditPatch) => Promise.resolve()),
      };
      handles.push(handle);
      return handle;
    },
  };
  return { runner, handles };
}

async function spawnScheduled(): Promise<{
  manager: BackgroundTaskManager;
  handles: IFakeHandle[];
  id: string;
}> {
  const { runner, handles } = createFakeScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const created = await manager.spawn(scheduledRequest());
  await Promise.resolve();
  return { manager, handles, id: created.id };
}

describe('SELFHOST-012 manager schedule lifecycle', () => {
  it('pauseScheduledTask sets status paused, clears nextFireAt, calls handle.pause (TC-02/TC-04)', async () => {
    const { manager, handles, id } = await spawnScheduled();
    expect(manager.get(id)?.status).toBe('sleeping');

    await manager.pauseScheduledTask(id);

    expect(handles[0]?.pause).toHaveBeenCalledOnce();
    expect(manager.get(id)?.status).toBe('paused');
    expect(manager.get(id)?.nextFireAt).toBeUndefined();
    // list surfaces the paused entry with its status
    const listed = manager.list().find((t) => t.id === id);
    expect(listed?.status).toBe('paused');
  });

  it('resumeScheduledTask returns to sleeping and refreshes nextFireAt (TC-02)', async () => {
    const { manager, handles, id } = await spawnScheduled();
    await manager.pauseScheduledTask(id);
    await manager.resumeScheduledTask(id);

    expect(handles[0]?.resume).toHaveBeenCalledOnce();
    expect(manager.get(id)?.status).toBe('sleeping');
    expect(manager.get(id)?.nextFireAt).toBe('2030-01-02T00:00:00.000Z');
  });

  it('editScheduledTask calls handle.editSchedule and updates the persisted schedule (TC-03)', async () => {
    const { manager, handles, id } = await spawnScheduled();
    await manager.editScheduledTask(id, { cronExpression: '*/5 * * * *' });

    expect(handles[0]?.editSchedule).toHaveBeenCalledWith({ cronExpression: '*/5 * * * *' });
    expect(manager.get(id)?.schedule?.cronExpression).toBe('*/5 * * * *');
    expect(manager.get(id)?.id).toBe(id); // same identity
  });

  it('pause is idempotent and resume is a no-op on a non-paused task', async () => {
    const { manager, handles, id } = await spawnScheduled();
    await manager.pauseScheduledTask(id);
    await manager.pauseScheduledTask(id); // idempotent
    expect(handles[0]?.pause).toHaveBeenCalledOnce();
    await manager.resumeScheduledTask(id);
    await manager.resumeScheduledTask(id); // already resumed → no-op
    expect(handles[0]?.resume).toHaveBeenCalledOnce();
  });

  it('rejects lifecycle verbs on a non-scheduled task', async () => {
    const { runner } = createFakeScheduledRunner();
    // a process runner so the spawned task is not `scheduled`
    const processRunner: IBackgroundTaskRunner = {
      kind: 'process',
      start: (task) => ({
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel: () => Promise.resolve(),
      }),
    };
    const manager = new BackgroundTaskManager({ runners: [runner, processRunner] });
    const created = await manager.spawn({
      kind: 'process',
      command: 'echo hi',
      label: 'proc',
      parentSessionId: 's',
      mode: 'background',
      depth: 1,
      cwd: '/workspace',
    });
    await expect(manager.pauseScheduledTask(created.id)).rejects.toThrow('Not a scheduled task');
  });
});
