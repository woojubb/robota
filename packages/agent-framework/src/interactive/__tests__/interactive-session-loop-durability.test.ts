import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { SessionExecutionController } from '../interactive-session-execution-controller.js';
import { createSessionStub } from './helpers/session-stub.js';

function holdForeground(interactive: InteractiveSession): {
  controller: SessionExecutionController;
  release: () => void;
} {
  const controller = (interactive as unknown as { execCtrl: SessionExecutionController }).execCtrl;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void controller.executeForegroundCommand(
    async () => {
      await held;
      return { success: true, message: 'released' };
    },
    () => Promise.resolve(),
  );
  return { controller, release };
}

interface ITestRecord {
  id: string;
  backgroundTasks?: Array<{ id?: string; status?: string; metadata?: Record<string, unknown> }>;
  sessionLoops?: Array<{ loopId: string; phase: string }>;
}

function setup(
  save: (record: ITestRecord) => void,
  maxConcurrent?: number,
  disableSessionLoops = false,
  run?: ReturnType<typeof vi.fn>,
) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const runner: IBackgroundTaskRunner<'scheduled'> = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart<'scheduled'>): IBackgroundTaskHandle<'scheduled'> {
      task.emit?.({ type: 'background_task_sleeping', nextFireAt: '2999-01-01T00:00:00.000Z' });
      return {
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel,
        pause: vi.fn().mockResolvedValue(undefined),
      };
    },
  };
  const manager = new BackgroundTaskManager({ runners: [runner], maxConcurrent });
  const session = createSessionStub({
    getSessionId: () => 'loop_durable',
    getEventService: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getModelId: () => 'test-model',
    run: run ?? vi.fn().mockResolvedValue('done'),
  } as never);
  storeAgentToolDeps(session, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const records = new Map<string, ITestRecord>();
  const store = {
    load: vi.fn((id: string) => {
      const record = records.get(id);
      return record ? { status: 'valid' as const, record } : { status: 'missing' as const };
    }),
    save: vi.fn((record: ITestRecord) => {
      save(record);
      records.set(record.id, record);
    }),
    list: vi.fn(() => []),
    delete: vi.fn(),
  };
  const interactive = new InteractiveSession({
    session,
    sessionStore: store as never,
    cwd: '/workspace',
    disableSessionLoops,
  });
  return { interactive, manager, store, cancel, records };
}

const loop = {
  label: 'Loop: check',
  cronExpression: '0 0 * * *',
  agentInstruction: 'check',
  sessionLoop: true,
  sessionLoopId: 'loop_stable',
};

describe('session-loop creation durability', () => {
  it('commits running before the model call and waiting before arming the next timer', async () => {
    let records!: Map<string, ITestRecord>;
    const run = vi.fn().mockImplementation(async () => {
      expect(records.get('loop_durable')?.sessionLoops?.[0]?.phase).toBe('running');
      return 'done';
    });
    const context = setup(() => undefined, undefined, false, run);
    records = context.records;
    const created = await context.interactive.createSelfPacedLoop('check the build');
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(context.interactive.listSelfPacedLoops()[0]).toMatchObject({
        loopId: created.loopId,
        phase: 'waiting',
        generation: 1,
        fallbackUsed: true,
      }),
    );
    expect(
      context.manager.list().filter((task) => task.metadata?.['sessionLoopSelfPaced']),
    ).toHaveLength(1);
  });

  it('keeps two pending loops separate and stopping one does not remove the other', async () => {
    const { interactive } = setup(() => undefined);
    const held = holdForeground(interactive);
    try {
      const first = await interactive.createSelfPacedLoop('first');
      const second = await interactive.createSelfPacedLoop('second');
      await vi.waitFor(() => expect(held.controller.pendingCount()).toBe(2));
      await interactive.stopSelfPacedLoop(first.loopId);
      expect(held.controller.pendingCount()).toBe(1);
      expect(
        interactive.listSelfPacedLoops().find((loop) => loop.loopId === second.loopId)?.phase,
      ).toBe('pending');
    } finally {
      held.controller.clearPendingQueue();
      held.release();
    }
  });

  it('does not arm a successor when a running loop is stopped', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn().mockImplementation(() => held.then(() => 'done'));
    const { interactive, manager } = setup(() => undefined, undefined, false, run);
    const created = await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await interactive.stopSelfPacedLoop(created.loopId);
    release();
    await vi.waitFor(() => expect(interactive.listSelfPacedLoops()[0]?.phase).toBe('stopped'));
    expect(manager.list().filter((task) => task.metadata?.['sessionLoopSelfPaced'])).toHaveLength(
      0,
    );
  });

  it('does not announce another check when stopped during timer spawn', async () => {
    const { interactive, manager } = setup(() => undefined);
    const spawn = manager.spawn.bind(manager);
    let releaseSpawn!: () => void;
    const heldSpawn = new Promise<void>((resolve) => {
      releaseSpawn = resolve;
    });
    const spawning = vi.spyOn(manager, 'spawn').mockImplementation(async (...args) => {
      await heldSpawn;
      return spawn(...args);
    });
    const created = await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() => expect(spawning).toHaveBeenCalledOnce());
    await interactive.stopSelfPacedLoop(created.loopId);
    releaseSpawn();
    await vi.waitFor(() =>
      expect(JSON.stringify(interactive.getFullHistory())).toContain('Loop stopped by user'),
    );
    expect(JSON.stringify(interactive.getFullHistory())).not.toContain('next check in');
  });

  it('treats cancellation of its one-shot timer as a durable loop stop', async () => {
    const { interactive, manager } = setup(() => undefined);
    await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() =>
      expect(manager.list().some((task) => task.metadata?.['sessionLoopSelfPaced'])).toBe(true),
    );
    const timer = manager.list().find((task) => task.metadata?.['sessionLoopSelfPaced'])!;
    await interactive.cancelBackgroundTask(timer.id, 'Cancelled in the task panel');
    expect(interactive.listSelfPacedLoops()[0]?.phase).toBe('stopped');
  });

  it('holds a restored self-paced loop while the host kill switch is on', async () => {
    const { interactive, store, manager } = setup(() => undefined);
    await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() => expect(interactive.listSelfPacedLoops()[0]?.phase).toBe('waiting'));
    const oldTimerCount = manager
      .list()
      .filter((task) => task.metadata?.['sessionLoopSelfPaced']).length;
    const resumed = new InteractiveSession({
      session: interactive.getSession(),
      sessionStore: store as never,
      resumeSessionId: 'loop_durable',
      cwd: '/workspace',
      disableSessionLoops: true,
    });
    expect(resumed.listSelfPacedLoops()[0]?.phase).toBe('waiting');
    expect(manager.list().filter((task) => task.metadata?.['sessionLoopSelfPaced'])).toHaveLength(
      oldTimerCount,
    );
  });

  it('stops visibly when the next one-shot timer cannot acquire a scheduler slot', async () => {
    const { interactive, manager } = setup(() => undefined, 0);
    await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() =>
      expect(interactive.listSelfPacedLoops()[0]).toMatchObject({
        phase: 'stopped',
        terminalReason: 'Could not arm the next timer',
      }),
    );
    expect(
      manager
        .list()
        .filter((task) => task.metadata?.['sessionLoopSelfPaced'] && task.status === 'sleeping'),
    ).toHaveLength(0);
  });

  it('never emits completion when the final durable loop transition fails', async () => {
    const { interactive } = setup((record) => {
      if (record.sessionLoops?.[0]?.phase === 'waiting') throw new Error('disk full');
    });
    const complete = vi.fn();
    const error = vi.fn();
    interactive.on('complete', complete);
    interactive.on('error', error);
    await interactive.createSelfPacedLoop('check');
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not leave a restored loop waiting when its timer cannot be re-armed', async () => {
    const { interactive, store, records } = setup(() => undefined, 0);
    const now = Date.now();
    records.set('loop_durable', {
      ...records.get('loop_durable')!,
      sessionLoops: [
        {
          loopId: 'loop_restored',
          instruction: 'check',
          phase: 'waiting',
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
          nextAllowedAt: new Date(now + 60_000).toISOString(),
          revision: 1,
          generation: 1,
          delaySeconds: 60,
          reason: 'check later',
          fallbackUsed: false,
        },
      ] as never,
    });
    const resumed = new InteractiveSession({
      session: interactive.getSession(),
      sessionStore: store as never,
      resumeSessionId: 'loop_durable',
      cwd: '/workspace',
    });
    await vi.waitFor(() =>
      expect(resumed.listSelfPacedLoops()[0]).toMatchObject({
        phase: 'stopped',
        terminalReason: 'Could not restore timer',
      }),
    );
  });

  it('settles a loop whose wake cannot enter the full queue without disturbing other entries', async () => {
    const { interactive } = setup(() => undefined);
    const held = holdForeground(interactive);
    try {
      for (let index = 0; index < 32; index++) {
        const turn = held.controller.turns.begin();
        void turn.completed.catch(() => undefined);
        held.controller.enqueuePending({
          turnId: turn.turnId,
          input: `other ${index}`,
          options: { driverId: 'agent', wakeTaskId: `unrelated:${index}` },
        });
      }
      const created = await interactive.createSelfPacedLoop('check');
      await vi.waitFor(() =>
        expect(
          interactive.listSelfPacedLoops().find((loop) => loop.loopId === created.loopId),
        ).toMatchObject({ phase: 'stopped', terminalReason: 'Self-paced loop turn was dropped' }),
      );
      expect(held.controller.pendingCount()).toBe(32);
    } finally {
      held.controller.clearPendingQueue();
      held.release();
    }
  });

  it('commits a self-paced loop before its first iteration is queued', async () => {
    const { interactive, store } = setup(() => undefined);
    const held = holdForeground(interactive);
    try {
      const created = await interactive.createSelfPacedLoop('check the build');
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionLoops: [expect.objectContaining({ loopId: created.loopId, phase: 'pending' })],
        }),
      );
      await vi.waitFor(() => expect(held.controller.pendingCount()).toBe(1));
    } finally {
      held.controller.clearPendingQueue();
      held.release();
    }
  });

  it('does not queue an iteration when self-paced creation cannot be stored', async () => {
    const { interactive, manager } = setup((record) => {
      if (record.sessionLoops?.length) throw new Error('disk full');
    });
    const controller = (interactive as unknown as { execCtrl: SessionExecutionController })
      .execCtrl;
    await expect(interactive.createSelfPacedLoop('check the build')).rejects.toThrow('disk full');
    expect(controller.pendingCount()).toBe(0);
    expect(manager.list()).toHaveLength(0);
  });

  it('refuses loop creation while the host kill switch is on', async () => {
    const { interactive, manager } = setup(() => undefined, undefined, true);
    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('disabled');
    expect(manager.list()).toHaveLength(0);
  });

  it('refuses a loop that has already expired before a timer is spawned', async () => {
    const { interactive, manager } = setup(() => undefined);
    await expect(
      interactive.spawnScheduledWake({
        ...loop,
        sessionLoopExpiresAt: '2000-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('expired');
    expect(manager.list()).toHaveLength(0);
  });

  it('rejects an expiry later than seven days instead of accepting an unbounded timer', async () => {
    const { interactive, manager } = setup(() => undefined);
    await expect(
      interactive.spawnScheduledWake({
        ...loop,
        sessionLoopExpiresAt: new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString(),
      }),
    ).rejects.toThrow('seven days');
    expect(manager.list()).toHaveLength(0);
  });

  it.each(['not-a-date', new Date(Date.now() + 2 * 60 * 60_000).toISOString()])(
    'rejects a first-fire boundary %s before creating a timer',
    async (firstAllowedAt) => {
      const { interactive, manager } = setup(() => undefined);
      await expect(
        interactive.spawnScheduledWake({
          ...loop,
          sessionLoopFirstAllowedAt: firstAllowedAt,
          sessionLoopExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      ).rejects.toThrow('first-fire boundary');
      expect(manager.list()).toHaveLength(0);
    },
  );

  it('refuses and cancels a loop wake after its seven-day expiry', async () => {
    const { interactive, manager } = setup(() => undefined);
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    const task = await interactive.spawnScheduledWake({ ...loop, sessionLoopExpiresAt: expiresAt });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt) + 1);
    try {
      expect(interactive.requestWakeup('check', task.id)).toBe(false);
      await vi.waitFor(() => expect(manager.get(task.id)?.status).toBe('cancelled'));
    } finally {
      clock.mockRestore();
    }
  });

  it('skips an aligned cron slot before the requested first-fire window', async () => {
    const { interactive, manager } = setup(() => undefined);
    const firstAllowedAt = new Date(Date.now() + 7 * 60_000).toISOString();
    const task = await interactive.spawnScheduledWake({
      ...loop,
      sessionLoopFirstAllowedAt: firstAllowedAt,
    });

    expect(interactive.requestWakeup('check', task.id)).toBe(false);
    expect(manager.get(task.id)?.status).toBe('sleeping');
    expect(manager.get(task.id)?.metadata?.['sessionLoopFirstAllowedAt']).toBe(firstAllowedAt);
  });

  it('expires a paused live loop without waiting for another wake', async () => {
    vi.useFakeTimers();
    try {
      const { interactive, manager, records } = setup(() => undefined);
      const expiresAt = new Date(Date.now() + 1_000).toISOString();
      const task = await interactive.spawnScheduledWake({
        ...loop,
        sessionLoopExpiresAt: expiresAt,
      });
      await manager.pauseScheduledTask(task.id);
      expect(manager.get(task.id)?.status).toBe('paused');

      await vi.advanceTimersByTimeAsync(1_001);

      expect(manager.get(task.id)?.status).toBe('cancelled');
      expect(
        records.get('loop_durable')?.backgroundTasks?.find((entry) => entry.id === task.id)?.status,
      ).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not acknowledge a loop when its session record cannot be saved', async () => {
    const { interactive, manager, cancel } = setup(() => {
      throw new Error('disk full');
    });

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('disk full');
    expect(manager.list().filter((task) => task.status === 'sleeping')).toHaveLength(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a loop when the existing record is unreadable instead of overwriting it', async () => {
    const { interactive, manager, store, cancel } = setup(() => undefined);
    store.save.mockClear();
    store.load.mockImplementation(() => ({ status: 'corrupt' }) as never);

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('corrupt');
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.list().filter((task) => task.status === 'sleeping')).toHaveLength(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does not leave a previously saved loop active after a later write fails', async () => {
    const durable: Array<{
      backgroundTasks?: Array<{ status?: string; metadata?: Record<string, unknown> }>;
    }> = [];
    let writes = 0;
    const { interactive } = setup((record) => {
      writes += 1;
      if (writes >= 4) throw new Error('store disconnected');
      durable.push(record);
    });
    writes = 0; // Ignore the session's initial empty snapshot.

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('store disconnected');
    expect(
      durable
        .at(-1)
        ?.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_stable'),
    ).not.toBe(true);
  });

  it('does not publish a concurrent loop that has not passed its own strict write', async () => {
    const durable: Array<{
      backgroundTasks?: Array<{ metadata?: Record<string, unknown> }>;
    }> = [];
    let unavailable = false;
    const { interactive } = setup((record) => {
      if (
        unavailable ||
        record.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_b')
      ) {
        unavailable = true;
        throw new Error('store disconnected');
      }
      durable.push(record);
    });

    const first = interactive.spawnScheduledWake({ ...loop, sessionLoopId: 'loop_a' });
    const second = interactive.spawnScheduledWake({ ...loop, sessionLoopId: 'loop_b' });
    await expect(first).resolves.toMatchObject({ metadata: { sessionLoopId: 'loop_a' } });
    await expect(second).rejects.toThrow('store disconnected');
    expect(
      durable.at(-1)?.backgroundTasks?.map((task) => task.metadata?.['sessionLoopId']),
    ).toContain('loop_a');
    expect(
      durable
        .at(-1)
        ?.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_b'),
    ).not.toBe(true);
  });

  it('refuses a queued loop that could not be re-armed after restart', async () => {
    const { interactive, manager } = setup(() => undefined, 0);

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('resumable timer');
    expect(manager.list()).toMatchObject([{ status: 'cancelled' }]);
  });

  it('acknowledges a loop only after a record containing its stable identity is saved', async () => {
    const saved: Array<{ backgroundTasks?: Array<{ metadata?: Record<string, unknown> }> }> = [];
    const { interactive } = setup((record) => saved.push(record));

    const task = await interactive.spawnScheduledWake(loop);
    expect(task.metadata?.['sessionLoopId']).toBe('loop_stable');
    expect(
      saved
        .at(-1)
        ?.backgroundTasks?.some((item) => item.metadata?.['sessionLoopId'] === 'loop_stable'),
    ).toBe(true);
  });
});

describe('session-loop stop durability', () => {
  it('removes a queued wake before the stop operation yields', async () => {
    const { interactive } = setup(() => undefined);
    const task = await interactive.spawnScheduledWake(loop);
    const { controller, release } = holdForeground(interactive);
    expect(interactive.requestWakeup('check', task.id)).toBe(true);
    await Promise.resolve();
    expect(controller.pending.contents).toHaveLength(1);

    const stopping = interactive.cancelBackgroundTask(task.id, 'Loop stopped by user');
    expect(controller.pending.contents).toHaveLength(0);
    await stopping;
    release();
  });

  it('keeps a queued wake when the durable stop write fails', async () => {
    let failStop = false;
    const { interactive } = setup((record) => {
      if (failStop && record.backgroundTasks?.some((task) => task.status === 'cancelled')) {
        throw new Error('disk full');
      }
    });
    const task = await interactive.spawnScheduledWake(loop);
    const { controller, release } = holdForeground(interactive);
    expect(interactive.requestWakeup('check', task.id)).toBe(true);
    await Promise.resolve();
    failStop = true;

    await expect(interactive.cancelBackgroundTask(task.id, 'Loop stopped by user')).rejects.toThrow(
      'disk full',
    );
    expect(controller.pending.contents).toHaveLength(1);
    interactive.cancelQueue();
    release();
  });

  it('does not stop a loop when its durable stop record cannot be written', async () => {
    let failStop = false;
    const { interactive, manager, cancel, records } = setup((record) => {
      if (failStop && record.backgroundTasks?.some((task) => task.status === 'cancelled')) {
        throw new Error('disk full');
      }
    });
    const task = await interactive.spawnScheduledWake(loop);
    failStop = true;

    await expect(interactive.cancelBackgroundTask(task.id, 'Loop stopped by user')).rejects.toThrow(
      'disk full',
    );
    expect(manager.get(task.id)?.status).toBe('sleeping');
    expect(
      records.get('loop_durable')?.backgroundTasks?.find((entry) => entry.id === task.id)?.status,
    ).toBe('sleeping');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('persists a terminal loop before acknowledging stop', async () => {
    let beforeRuntimeCancellation = false;
    const observation: { stoppedId?: string; manager?: BackgroundTaskManager } = {};
    const { interactive, manager, records } = setup((record) => {
      if (
        observation.stoppedId &&
        record.backgroundTasks?.some(
          (entry) => entry.id === observation.stoppedId && entry.status === 'cancelled',
        )
      ) {
        beforeRuntimeCancellation ||=
          observation.manager?.get(observation.stoppedId)?.status === 'sleeping';
      }
    });
    observation.manager = manager;
    const task = await interactive.spawnScheduledWake(loop);
    observation.stoppedId = task.id;

    await interactive.cancelBackgroundTask(task.id, 'Loop stopped by user');
    expect(beforeRuntimeCancellation).toBe(true);
    expect(manager.get(task.id)?.status).toBe('cancelled');
    expect(
      records.get('loop_durable')?.backgroundTasks?.find((entry) => entry.id === task.id)?.status,
    ).toBe('cancelled');
  });
});
