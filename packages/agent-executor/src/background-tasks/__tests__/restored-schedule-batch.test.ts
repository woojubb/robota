import { describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-task-manager.js';
import { createScheduledTaskRunner } from '../runners/scheduled-task-runner.js';

import type { IScheduledBackgroundTaskState, TBackgroundTaskEvent } from '../types.js';

function schedule(
  id: string,
  status: 'sleeping' | 'paused' = 'sleeping',
): IScheduledBackgroundTaskState {
  return {
    id,
    kind: 'scheduled',
    status,
    label: id,
    mode: 'background',
    parentSessionId: 'session_1',
    depth: 0,
    cwd: process.cwd(),
    updatedAt: '2026-01-01T00:00:00.000Z',
    unread: false,
    schedule: { cronExpression: '* * * * * *', agentInstruction: 'wake' },
  };
}

describe('prepared restored schedules', () => {
  it('refuses unrelated task admission until a prepared transaction is finished', async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const reservation = manager.reserveTaskIds(['one']);
    const prepared = manager.prepareRestoredSchedules([schedule('one')], reservation);
    try {
      await expect(
        manager.spawn({
          kind: 'scheduled',
          cronExpression: '0 0 * * *',
          agentInstruction: 'other',
          label: 'other',
          mode: 'background',
          parentSessionId: 'another',
          depth: 0,
          cwd: process.cwd(),
        }),
      ).rejects.toThrow(/restore.*progress/i);
      expect(manager.list()).toEqual([]);
    } finally {
      prepared.abort();
      await manager.shutdown();
      reservation.release();
    }
  });

  it('can close an activated batch before deferred wakes without touching unrelated jobs', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const other = await manager.spawn({
        kind: 'scheduled',
        cronExpression: '0 0 1 1 *',
        agentInstruction: 'unrelated',
        label: 'unrelated',
        mode: 'background',
        parentSessionId: 'session_1',
        depth: 0,
        cwd: process.cwd(),
      });
      await manager.pauseScheduledTask(other.id);
      const events: TBackgroundTaskEvent[] = [];
      manager.subscribe((event) => events.push(event));
      const reservation = manager.reserveTaskIds(['one']);
      const prepared = manager.prepareRestoredSchedules([schedule('one')], reservation);
      await vi.advanceTimersByTimeAsync(2000);
      expect(prepared.activate()).toBe('active');
      prepared.abort();
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toEqual([]);
      expect(manager.list()).toEqual([expect.objectContaining({ id: other.id, status: 'paused' })]);
      await manager.shutdown();
      reservation.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts every earlier timer if a later schedule cannot be prepared', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const events: TBackgroundTaskEvent[] = [];
      manager.subscribe((event) => events.push(event));
      const reservation = manager.reserveTaskIds(['one', 'bad']);
      const invalid = {
        ...schedule('bad'),
        schedule: { cronExpression: 'invalid cron', agentInstruction: 'wake' },
      };
      expect(() =>
        manager.prepareRestoredSchedules([schedule('one'), invalid], reservation),
      ).toThrow();
      await vi.advanceTimersByTimeAsync(3000);
      expect(events).toEqual([]);
      expect(manager.list()).toEqual([]);
      await manager.shutdown();
      reservation.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a prepared batch when shutdown begins before activation', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const events: TBackgroundTaskEvent[] = [];
      manager.subscribe((event) => events.push(event));
      const reservation = manager.reserveTaskIds(['one']);
      const prepared = manager.prepareRestoredSchedules([schedule('one')], reservation);
      await vi.advanceTimersByTimeAsync(1000);
      await manager.shutdown();
      expect(prepared.activate()).toBe('aborted');
      await vi.advanceTimersByTimeAsync(2000);
      expect(events).toEqual([]);
      expect(manager.list()).toEqual([]);
      reservation.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not publish or execute any task until the entire batch is activated', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const events: TBackgroundTaskEvent[] = [];
      manager.subscribe((event) => events.push(event));
      const reservation = manager.reserveTaskIds(['one', 'two']);
      const prepared = manager.prepareRestoredSchedules(
        [schedule('one'), schedule('two', 'paused')],
        reservation,
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(events).toEqual([]);
      expect(manager.list()).toEqual([]);
      expect(prepared.activate()).toBe('active');
      expect(events).toEqual([]);
      expect(manager.list().map((task) => [task.id, task.status])).toEqual([
        ['one', 'sleeping'],
        ['two', 'paused'],
      ]);
      await Promise.resolve();
      await Promise.resolve();
      expect(events.filter((event) => event.type === 'background_task_waking')).toHaveLength(2);
      await manager.shutdown();
      reservation.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
