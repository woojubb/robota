import { describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager, isBuiltInRestoreManager } from '../background-task-manager.js';
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
  it('rechecks the claim after task-start observers before starting a runner', async () => {
    let owned = true;
    const onLoss = vi.fn();
    const start = vi.fn(({ taskId }: { taskId: string }) => ({
      taskId,
      cancel: () => Promise.resolve(),
      result: new Promise<never>(() => {}),
    }));
    const manager = new BackgroundTaskManager({ runners: [{ kind: 'process', start }] });
    const release = manager.attachSession({}, true, 'session_1', { canRun: () => owned, onLoss });
    manager.subscribe((event) => {
      if (event.type === 'background_task_started') owned = false;
    });
    const task = await manager.spawn({
      kind: 'process',
      command: 'echo ignored',
      label: 'x',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(start).not.toHaveBeenCalled();
    expect(onLoss).toHaveBeenCalledTimes(1);
    expect(manager.get(task.id)).toMatchObject({ status: 'failed' });
    release();
    await manager.shutdown();
  });
  it('calls only the verified built-in scheduled start when its getter changes', async () => {
    const runner = createScheduledTaskRunner();
    const original = runner.start;
    const replacement = vi.fn(() => {
      throw new Error('unexpected replacement');
    });
    let reads = 0;
    Object.defineProperty(runner, 'start', { get: () => (++reads < 3 ? original : replacement) });
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const release = manager.attachSession({}, true, 'session_1');
    const task = await manager.spawn({
      kind: 'scheduled',
      cronExpression: '* * * * * *',
      agentInstruction: 'wake',
      label: 'wake',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(replacement).not.toHaveBeenCalled();
    expect(manager.get(task.id)).toMatchObject({ status: 'sleeping' });
    release();
    await manager.shutdown();
  });
  it('refuses a custom scheduled runner for a claimed session but allows an unpersisted session', async () => {
    const start = vi.fn(({ taskId }: { taskId: string }) => ({
      taskId,
      cancel: () => Promise.resolve(),
      result: new Promise<never>(() => {}),
    }));
    const runner = { kind: 'scheduled' as const, start };
    const claimed = new BackgroundTaskManager({ runners: [runner] });
    const release = claimed.attachSession({}, true, 'session_1');
    const request = {
      kind: 'scheduled' as const,
      cronExpression: '* * * * * *',
      agentInstruction: 'wake',
      label: 'wake',
      mode: 'background' as const,
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    };
    await expect(claimed.spawn(request)).rejects.toThrow(/built.in.*runner/i);
    expect(start).not.toHaveBeenCalled();
    release();
    await claimed.shutdown();
    const unpersisted = new BackgroundTaskManager({ runners: [runner] });
    const attached = unpersisted.attachSession({}, false);
    const task = await unpersisted.spawn(request);
    expect(task.id).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(1);
    attached();
    await unpersisted.shutdown();
  });
  it('binds a claimed manager exclusively to a session identity for its lifetime', async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const first = {};
    const second = {};
    const release = manager.attachSession(first, true, 'session_1');
    expect(() => manager.attachSession(second, false)).toThrow(/exclusive/i);
    release();
    release();
    const otherRelease = manager.attachSession(second, false);
    expect(() => manager.attachSession(first, true, 'session_1')).toThrow(/exclusive/i);
    otherRelease();
    const finalRelease = manager.attachSession(first, true, 'session_1');
    finalRelease();
    const sharedFirst = manager.attachSession(first, false);
    const sharedSecond = manager.attachSession(second, false);
    expect(() => manager.attachSession({}, true, 'session_1')).toThrow(/exclusive/i);
    sharedFirst();
    sharedSecond();
    const afterShared = manager.attachSession({}, true, 'session_1');
    afterShared();
    await manager.shutdown();
  });
  it('does not start a runner when an observer revokes the claim at task admission', async () => {
    const start = vi.fn(({ taskId }: { taskId: string }) => ({
      taskId,
      cancel: () => Promise.resolve(),
      result: new Promise<never>(() => {}),
    }));
    const manager = new BackgroundTaskManager({ runners: [{ kind: 'process', start }] });
    manager.subscribe((event) => {
      if (event.type === 'background_task_started')
        manager.invalidateRestoredSchedules('session_1', () => undefined);
    });
    const task = await manager.spawn({
      kind: 'process',
      command: 'echo ignored',
      label: 'x',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(manager.get(task.id)).toMatchObject({ status: 'failed' });
    expect(start).not.toHaveBeenCalled();
    await manager.shutdown();
  });
  it('cancels a handle returned after reentrant ownership loss', async () => {
    let manager: BackgroundTaskManager;
    const cancel = vi.fn(() => Promise.resolve());
    const runner = {
      kind: 'process' as const,
      start: ({ taskId }: { taskId: string }) => {
        manager.invalidateRestoredSchedules('session_1', () => undefined);
        return { taskId, cancel, result: new Promise<never>(() => {}) };
      },
    };
    manager = new BackgroundTaskManager({ runners: [runner] });
    const task = await manager.spawn({
      kind: 'process',
      command: 'echo ignored',
      label: 'x',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(manager.get(task.id)).toMatchObject({ status: 'failed' });
    expect(cancel).toHaveBeenCalledTimes(1);
    await manager.shutdown();
  });
  it("fences only the lost session and leaves another session's work running", async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const reservation = manager.reserveTaskIds(['one']);
    const batch = manager.prepareRestoredSchedules([schedule('one')], reservation);
    expect(batch.activate()).toBe('active');
    const other = await manager.spawn({
      kind: 'scheduled',
      cronExpression: '* * * * * *',
      agentInstruction: 'other',
      label: 'other',
      mode: 'background',
      parentSessionId: 'session_2',
      depth: 0,
      cwd: process.cwd(),
    });
    manager.invalidateRestoredSchedules('session_1', () => undefined);
    expect(manager.get('one')).toMatchObject({ status: 'failed' });
    expect(manager.get(other.id)).toMatchObject({ status: 'sleeping' });
    await expect(
      manager.spawn({
        kind: 'scheduled',
        cronExpression: '* * * * * *',
        agentInstruction: 'lost',
        label: 'lost',
        mode: 'background',
        parentSessionId: 'session_1',
        depth: 0,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/claim.*lost/i);
    await manager.shutdown();
    reservation.release();
  });
  it('recognizes only the original built-in manager, not a clone, proxy, or altered implementation', () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    expect(isBuiltInRestoreManager(manager)).toBe(true);
    expect(isBuiltInRestoreManager({ ...manager } as unknown as BackgroundTaskManager)).toBe(false);
    expect(isBuiltInRestoreManager(new Proxy(manager, {}))).toBe(false);
    Object.defineProperty(manager, 'prepareRestoredSchedules', {
      value: () => ({ activate: () => 'active', abort() {} }),
    });
    expect(isBuiltInRestoreManager(manager)).toBe(false);
  });

  it('uses the verified runner method if its getter changes on a later read', async () => {
    const runner = createScheduledTaskRunner();
    const original = runner.prepareRestore;
    const malicious = vi.fn(() => {
      throw new Error('unexpected replacement');
    });
    let reads = 0;
    Object.defineProperty(runner, 'prepareRestore', {
      get: () => (++reads < 3 ? original : malicious),
    });
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const reservation = manager.reserveTaskIds(['one']);
    const batch = manager.prepareRestoredSchedules([schedule('one')], reservation);
    expect(malicious).not.toHaveBeenCalled();
    expect(batch.activate()).toBe('active');
    await manager.shutdown();
    reservation.release();
  });

  it.each(['clone', 'proxy', 'altered'] as const)(
    'refuses a %s built-in runner during restore',
    async (mode) => {
      const runner = createScheduledTaskRunner();
      let candidate = runner;
      if (mode === 'clone') candidate = { ...runner };
      if (mode === 'proxy') candidate = new Proxy(runner, {});
      if (mode === 'altered')
        Object.defineProperty(runner, 'prepareRestore', { value: () => undefined });
      const manager = new BackgroundTaskManager({ runners: [candidate] });
      const reservation = manager.reserveTaskIds(['one']);
      expect(() => manager.prepareRestoredSchedules([schedule('one')], reservation)).toThrow(
        /built.in.*runner/i,
      );
      expect(manager.list()).toEqual([]);
      reservation.release();
      await manager.shutdown();
    },
  );
  it('refuses an untrusted scheduled runner before it can prepare a restored timer', async () => {
    const base = createScheduledTaskRunner();
    const prepare = vi.fn((...args: Parameters<NonNullable<typeof base.prepareRestore>>) =>
      base.prepareRestore!(...args),
    );
    const manager = new BackgroundTaskManager({ runners: [{ ...base, prepareRestore: prepare }] });
    const reservation = manager.reserveTaskIds(['one']);
    expect(() => manager.prepareRestoredSchedules([schedule('one')], reservation)).toThrow(
      /built.in.*runner/i,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
    const spawned = await manager.spawn({
      kind: 'scheduled',
      cronExpression: '0 0 * * *',
      agentInstruction: 'wake',
      label: 'new',
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(spawned.label).toBe('new');
    reservation.release();
    await manager.shutdown();
  });
  it('rejects an asynchronous custom runner before invoking it', async () => {
    const prepare = vi.fn(() => Promise.reject(new Error('late runner failure')));
    const runner = {
      ...createScheduledTaskRunner(),
      prepareRestore: prepare,
    };
    const manager = new BackgroundTaskManager({
      runners: [runner as unknown as ReturnType<typeof createScheduledTaskRunner>],
    });
    const reservation = manager.reserveTaskIds(['one']);
    expect(() => manager.prepareRestoredSchedules([schedule('one')], reservation)).toThrow(
      /built.in.*runner/i,
    );
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
    await manager.shutdown();
    reservation.release();
  });
  it('keeps an activated task accessible to cancellation if abort is called later', async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const reservation = manager.reserveTaskIds(['one']);
    const batch = manager.prepareRestoredSchedules([schedule('one')], reservation);
    expect(batch.activate()).toBe('active');
    await Promise.resolve();
    batch.abort();
    expect(manager.get('one')).toMatchObject({ id: 'one', status: 'sleeping' });
    await manager.cancel('one');
    await manager.shutdown();
    reservation.release();
  });

  it('refuses to activate an aborted batch', async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const reservation = manager.reserveTaskIds(['one']);
    const batch = manager.prepareRestoredSchedules([schedule('one')], reservation);
    batch.abort();
    expect(batch.activate()).toBe('aborted');
    expect(manager.list()).toEqual([]);
    await manager.shutdown();
    reservation.release();
  });

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

  it('aborts on a failed final check without touching unrelated jobs', async () => {
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
      expect(() =>
        prepared.activate(() => {
          throw new Error('final check failed');
        }),
      ).toThrow(/final check failed/);
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
