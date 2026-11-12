/**
 * On session resume, a persisted sleeping scheduled wake is re-armed
 * (re-spawned from its persisted `schedule`) instead of being killed as stale, and a
 * missed-wake note is surfaced when its fire time elapsed while the session was closed.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { createScheduledTaskRunner } from '@robota-sdk/agent-executor/node';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { SessionHistoryTracker } from '../interactive-session-history-tracker.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-session';

const testHost = createTestFrameworkHost();

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_resumed',
    assertInputAllowed: vi.fn(),
    getConversationSnapshot: () => ({ id: 'session_resumed', cwd: '/workspace', messages: [] }),
    getHistory: () => [],
    getSystemMessage: () => 'system',
    getSystemPromptManifest: () => undefined,
    getToolSchemas: () => [],
    getContextState: () => ({
      usedTokens: 0,
      maxTokens: 100,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    abort: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  } as unknown as Session;
}

interface ITestScheduled {
  runner: IBackgroundTaskRunner<'scheduled'>;
  started: string[];
}

function createTestScheduledRunner(): ITestScheduled {
  return { runner: createScheduledTaskRunner(), started: [] };
}

function pausedScheduledRecord(): Record<string, unknown> {
  return {
    id: 'session_resumed',
    cwd: '/workspace',
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    messages: [],
    backgroundTasks: [
      {
        id: 'sched_paused',
        kind: 'scheduled',
        status: 'paused', // persisted paused — no nextFireAt
        label: 'paused daily wake',
        mode: 'background',
        parentSessionId: 'session_resumed',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-06-13T00:00:00.000Z',
        unread: false,
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'summarize overnight changes' },
      },
    ],
    backgroundTaskEvents: [],
  };
}

function setupWithRecord(
  record: Record<string, unknown>,
  disableSessionLoops = false,
  scheduledRunner?: IBackgroundTaskRunner<'scheduled'>,
): {
  started: string[];
  manager: BackgroundTaskManager;
  session: InteractiveSession;
  store: ReturnType<typeof createStore>;
} {
  const { runner, started } = createTestScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [scheduledRunner ?? runner] });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const store = createStore(record);
  const session = new InteractiveSession({
    host: testHost,
    cwd: process.cwd(),
    session: sessionStub,
    sessionStore: store as never,
    resumeSessionId: 'session_resumed',
    disableSessionLoops,
  });
  started.push(...manager.list().map((task) => task.id));
  return { started, manager, session, store };
}

function sleepingScheduledRecord(nextFireAt: string): Record<string, unknown> {
  return {
    id: 'session_resumed',
    cwd: '/workspace',
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    messages: [],
    backgroundTasks: [
      {
        id: 'sched_old',
        kind: 'scheduled',
        status: 'sleeping',
        label: 'daily wake',
        mode: 'background',
        parentSessionId: 'session_resumed',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-06-13T00:00:00.000Z',
        unread: false,
        nextFireAt,
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'summarize overnight changes' },
      },
    ],
    backgroundTaskEvents: [],
  };
}

function createStore(record: Record<string, unknown>) {
  const map = new Map<string, unknown>([['session_resumed', record]]);
  const save = vi.fn((r: { id: string }) => map.set(r.id, r));
  return withHoldReadClaim({
    load: vi.fn((id: string) => {
      const record = map.get(id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    }),
    save,
    saveRestoreTransaction: vi.fn((r: { id: string }) => {
      save(r);
      return { status: 'committed' as const };
    }),
    list: vi.fn(() =>
      [...map.entries()].map(([id, record]) => ({ id, outcome: { status: 'valid', record } })),
    ),
    delete: vi.fn((id: string) => map.delete(id)),
  });
}

function history(session: InteractiveSession): IHistoryEntry[] {
  return (session as unknown as { histTracker: SessionHistoryTracker }).histTracker.getHistory();
}

function setup(nextFireAt: string): { started: string[]; session: InteractiveSession } {
  const { runner, started } = createTestScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const store = createStore(sleepingScheduledRecord(nextFireAt));
  const session = new InteractiveSession({
    host: testHost,
    cwd: process.cwd(),
    session: sessionStub,
    sessionStore: store as never,
    resumeSessionId: 'session_resumed',
  });
  started.push(...manager.list().map((task) => task.id));
  return { started, session };
}

describe('resume re-arm + missed-wake', () => {
  it('a restored sleeping scheduled wake is re-armed (re-spawned), not killed', () => {
    const { started } = setup('2999-01-01T00:00:00.000Z');
    expect(started).toHaveLength(1); // the manager re-spawned the schedule
  });

  it('an elapsed nextFireAt surfaces exactly one missed-wake note', () => {
    const { session } = setup('2000-01-01T00:00:00.000Z');
    const notes = history(session).filter(
      (e) => e.type === 'system' && JSON.stringify(e).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(1);
  });

  it('a future nextFireAt re-arms without a missed-wake note', () => {
    const { session } = setup('2999-01-01T00:00:00.000Z');
    const notes = history(session).filter((e) =>
      JSON.stringify(e).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(0);
  });

  it('does not report a skipped pre-eligibility slot as a missed loop wake on resume', () => {
    const nowMs = Date.now();
    const record = sleepingScheduledRecord(new Date(nowMs - 60_000).toISOString());
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks[0]!['metadata'] = {
      sessionLoop: true,
      sessionLoopId: 'loop_first_window',
      sessionLoopFirstAllowedAt: new Date(nowMs + 5 * 60_000).toISOString(),
      sessionLoopExpiresAt: new Date(nowMs + 5 * 24 * 60 * 60_000).toISOString(),
    };

    const { session } = setupWithRecord(record);
    const notes = history(session).filter((entry) =>
      JSON.stringify(entry).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(0);
  });

  it.each([
    ['before', '2026-09-24T00:17:00.000Z', 0],
    ['after', '2026-09-24T00:21:00.000Z', 1],
  ])(
    'reports a missed loop wake only %s the first eligible cron slot',
    (_position, resumedAt, expectedNotes) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(resumedAt));
      try {
        const record = sleepingScheduledRecord('2026-09-24T00:10:00.000Z');
        const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
        tasks[0]!['schedule'] = {
          cronExpression: '0 */10 * * * *',
          agentInstruction: 'check',
        };
        tasks[0]!['metadata'] = {
          sessionLoop: true,
          sessionLoopId: 'loop_missed_first_eligible_slot',
          sessionLoopFirstAllowedAt: '2026-09-24T00:16:00.000Z',
          sessionLoopExpiresAt: '2026-09-30T00:00:00.000Z',
        };

        const { session } = setupWithRecord(record);
        const notes = history(session).filter((entry) =>
          JSON.stringify(entry).includes('Missed scheduled wake'),
        );
        expect(notes).toHaveLength(expectedNotes);
        if (expectedNotes) expect(JSON.stringify(notes[0])).toContain('2026-09-24T00:20:00.000Z');
      } finally {
        now.mockRestore();
      }
    },
  );

  it('uses the scheduled runner timezone when reporting a missed eligible loop wake', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T08:00:00.000Z'));
    try {
      const record = sleepingScheduledRecord('2026-09-24T07:00:00.000Z');
      const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
      tasks[0]!['metadata'] = {
        sessionLoop: true,
        sessionLoopId: 'loop_timezone',
        sessionLoopFirstAllowedAt: '2026-09-25T01:00:00.000Z',
        sessionLoopExpiresAt: '2026-09-30T00:00:00.000Z',
      };

      const { session, manager } = setupWithRecord(
        record,
        false,
        createScheduledTaskRunner({ timezone: 'America/Los_Angeles' }),
      );
      try {
        const notes = history(session).filter((entry) =>
          JSON.stringify(entry).includes('Missed scheduled wake'),
        );
        expect(notes).toHaveLength(1);
        expect(JSON.stringify(notes[0])).toContain('2026-09-25T07:00:00.000Z');
      } finally {
        for (const task of manager.list()) await manager.cancel(task.id);
      }
    } finally {
      now.mockRestore();
    }
  });

  it('retains a loop identity marker and task id when a schedule is restored', () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    const firstAllowedAt = new Date(Date.now() + 60_000).toISOString();
    tasks[0]!['metadata'] = {
      sessionLoop: true,
      sessionLoopId: 'loop_stable',
      sessionLoopFirstAllowedAt: firstAllowedAt,
      sessionLoopExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
    };
    const { manager, session } = setupWithRecord(record);
    const rearmed = manager.list().find((task) => task.kind === 'scheduled');
    expect(rearmed?.id).toBe('sched_old');
    expect(rearmed?.metadata?.['sessionLoop']).toBe(true);
    expect(rearmed?.metadata?.['sessionLoopId']).toBe('loop_stable');
    expect(rearmed?.metadata?.['sessionLoopFirstAllowedAt']).toBe(firstAllowedAt);
    expect(session.requestWakeup('check', rearmed!.id)).toBe(false);
  });

  it('expires a restored paused loop without a scheduled wake', async () => {
    vi.useFakeTimers();
    try {
      const record = pausedScheduledRecord();
      const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
      tasks[0]!['metadata'] = {
        sessionLoop: true,
        sessionLoopId: 'loop_restored',
        sessionLoopExpiresAt: new Date(Date.now() + 1_000).toISOString(),
      };
      const { manager, store } = setupWithRecord(record);
      await vi.advanceTimersByTimeAsync(0);
      const rearmed = manager
        .list()
        .find((task) => task.metadata?.['sessionLoopId'] === 'loop_restored');
      expect(rearmed?.status).toBe('paused');

      await vi.advanceTimersByTimeAsync(1_001);

      expect(manager.get(rearmed!.id)?.status).toBe('cancelled');
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundTasks: expect.arrayContaining([
            expect.objectContaining({ id: rearmed!.id, status: 'cancelled' }),
          ]),
        }),
        // Every save of the session's own record carries its claim.
        expect.objectContaining({ claim: expect.anything() }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-arm an expired session loop while restoring unrelated schedules normally', () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks[0]!['metadata'] = {
      sessionLoop: true,
      sessionLoopId: 'loop_expired',
      sessionLoopExpiresAt: '2000-01-01T00:00:00.000Z',
    };
    tasks.push({
      ...tasks[0]!,
      id: 'sched_unrelated',
      label: 'ordinary schedule',
      metadata: undefined,
    });
    const { started, manager, session, store } = setupWithRecord(record);

    expect(started).toHaveLength(1);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]?.label).toBe('ordinary schedule');
    expect(history(session).some((entry) => JSON.stringify(entry).includes('expired'))).toBe(true);
    const saved = store.load('session_resumed').record as Record<string, unknown>;
    const savedTasks = saved['backgroundTasks'] as Array<Record<string, unknown>>;
    expect(
      savedTasks.find(
        (task) =>
          task['metadata'] &&
          (task['metadata'] as Record<string, unknown>)['sessionLoopId'] === 'loop_expired',
      )?.['status'],
    ).toBe('cancelled');
  });

  it('keeps a disabled loop visible and stoppable without re-arming it', async () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks[0]!['metadata'] = {
      sessionLoop: true,
      sessionLoopId: 'loop_disabled',
      sessionLoopExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
    };
    const { started, manager, session, store } = setupWithRecord(record, true);

    expect(started).toHaveLength(0);
    expect(manager.list()).toHaveLength(0);
    expect(history(session).some((entry) => JSON.stringify(entry).includes('disabled'))).toBe(true);
    const saved = store.load('session_resumed').record as Record<string, unknown>;
    const savedTasks = saved['backgroundTasks'] as Array<Record<string, unknown>>;
    expect(
      savedTasks.some(
        (task) =>
          (task['metadata'] as Record<string, unknown> | undefined)?.['sessionLoopId'] ===
          'loop_disabled',
      ),
    ).toBe(true);
    expect(session.listSchedules().some((task) => task.id === 'sched_old')).toBe(true);
    await session.cancelBackgroundTask('sched_old', 'Loop stopped by user');
    const stopped = store.load('session_resumed').record as Record<string, unknown>;
    expect(
      (stopped['backgroundTasks'] as Array<Record<string, unknown>>).find(
        (task) => task['id'] === 'sched_old',
      )?.['status'],
    ).toBe('cancelled');

    const enabledAfterStop = setupWithRecord(stopped, false);
    expect(enabledAfterStop.started).toHaveLength(0);
  });

  it('re-arms a disabled loop after a later restart with the switch off', () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks[0]!['metadata'] = {
      sessionLoop: true,
      sessionLoopId: 'loop_reenabled',
      sessionLoopExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
    };
    const disabled = setupWithRecord(record, true);
    const saved = disabled.store.load('session_resumed').record as Record<string, unknown>;

    const enabled = setupWithRecord(saved, false);
    expect(enabled.started).toHaveLength(1);
    expect(enabled.manager.list()[0]?.metadata?.['sessionLoopId']).toBe('loop_reenabled');
  });

  it('preserves a disabled loop in every re-arm event snapshot even when another schedule starts first', () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks.push({
      ...tasks[0]!,
      id: 'sched_held',
      label: 'Loop: held',
      metadata: {
        sessionLoop: true,
        sessionLoopId: 'loop_held',
        sessionLoopExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
      },
    });

    const { started, store } = setupWithRecord(record, true);
    expect(started).toHaveLength(1);
    expect(store.save).toHaveBeenCalled();
    for (const [saved] of store.save.mock.calls) {
      const savedTasks = (saved as Record<string, unknown>)['backgroundTasks'] as Array<
        Record<string, unknown>
      >;
      expect(
        savedTasks.some(
          (task) =>
            (task['metadata'] as Record<string, unknown> | undefined)?.['sessionLoopId'] ===
            'loop_held',
        ),
      ).toBe(true);
    }
  });

  // A persisted PAUSED schedule re-arms as paused (not failed, not firing) on restart.
  it('a restored paused schedule is kept + re-armed paused, not reconciled to failed', async () => {
    const { started, manager, session } = setupWithRecord(pausedScheduledRecord());

    // Re-armed (re-spawned), not killed as a stale worker.
    expect(started).toHaveLength(1);
    // The restored paused task was NOT reconciled to `failed`, and no missed-wake note fired.
    const notes = history(session).filter((e) =>
      JSON.stringify(e).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(0);

    // The re-arm-then-pause lands on a microtask — after it, the re-spawned schedule is paused.
    await Promise.resolve();
    await Promise.resolve();
    const scheduled = manager.list().filter((t) => t.kind === 'scheduled');
    expect(scheduled.some((t) => t.status === 'paused')).toBe(true);
    expect(scheduled.some((t) => t.status === 'failed')).toBe(false);
  });
});

describe('restored task reservation capability', () => {
  it.each(['restored first', 'empty first'] as const)(
    'rejects a second claimed session sharing a manager and the same session id: %s',
    async (order) => {
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const restored = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
      const empty = { ...restored, backgroundTasks: [] };
      const firstStub = createSessionStub();
      const secondStub = createSessionStub();
      storeAgentToolDeps(firstStub, {
        backgroundTaskManager: manager,
      } as unknown as IAgentToolDeps);
      storeAgentToolDeps(secondStub, {
        backgroundTaskManager: manager,
      } as unknown as IAgentToolDeps);
      const firstStore = createStore(order === 'restored first' ? restored : empty);
      const secondStore = createStore(order === 'restored first' ? empty : restored);
      const first = new InteractiveSession({
        host: testHost,
        cwd: process.cwd(),
        session: firstStub,
        sessionStore: firstStore as never,
        resumeSessionId: 'session_resumed',
      });
      expect(
        () =>
          new InteractiveSession({
            host: testHost,
            cwd: process.cwd(),
            session: secondStub,
            sessionStore: secondStore as never,
            resumeSessionId: 'session_resumed',
          }),
      ).toThrow(/exclusive/i);
      expect(secondStore.save).not.toHaveBeenCalled();
      if (order === 'restored first')
        expect(manager.get('sched_old')).toMatchObject({ status: 'sleeping' });
      await first.shutdown();
    },
  );
  it('refuses a different session task while subscribing the claimed manager', async () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const subscribe = manager.subscribe.bind(manager);
    let foreign: Promise<unknown> | undefined;
    Object.defineProperty(manager, 'subscribe', {
      value: (listener: Parameters<typeof subscribe>[0]) => {
        foreign = manager
          .spawn({
            kind: 'scheduled',
            cronExpression: '0 0 * * *',
            label: 'other',
            mode: 'background',
            parentSessionId: 'another-session',
            depth: 1,
            cwd: process.cwd(),
            agentInstruction: 'wake',
          })
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        return subscribe(listener);
      },
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    const session = new InteractiveSession({
      host: testHost,
      cwd: process.cwd(),
      session: sessionStub,
      sessionStore: store as never,
      resumeSessionId: 'session_resumed',
    });
    expect(await foreign).toMatchObject({ message: expect.stringMatching(/exclusive/i) });
    expect(manager.list()).toEqual([expect.objectContaining({ id: 'sched_old' })]);
    await session.shutdown();
  });

  it('refuses a manager that emits during subscription before writing any record', () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const subscribe = manager.subscribe.bind(manager);
    Object.defineProperty(manager, 'subscribe', {
      value: (listener: Parameters<typeof subscribe>[0]) => {
        listener({ type: 'background_task_waking', taskId: 'foreign', instruction: 'wake' });
        return subscribe(listener);
      },
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/event.*restore/i);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
    expect(store.hasWriter('session_resumed')).toBe(false);
  });

  it('refuses a restored session when the manager already owns an unrelated task', async () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const other = await manager.spawn({
      kind: 'scheduled',
      cronExpression: '0 0 * * *',
      label: 'other',
      mode: 'background',
      parentSessionId: 'another-session',
      depth: 1,
      cwd: process.cwd(),
      agentInstruction: 'wake',
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/already owns.*task/i);
    expect(manager.get(other.id)).toMatchObject({
      id: other.id,
      parentSessionId: 'another-session',
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
    await manager.shutdown();
  });

  it.each(['store', 'manager'] as const)(
    'refuses a restored schedule before any write when the %s lacks the transaction capability',
    (missing) => {
      const { runner, started } = createTestScheduledRunner();
      const manager = new BackgroundTaskManager({ runners: [runner] });
      const sessionStub = createSessionStub();
      storeAgentToolDeps(sessionStub, {
        backgroundTaskManager: manager,
      } as unknown as IAgentToolDeps);
      const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
      const store = createStore(saved);
      if (missing === 'store')
        Object.defineProperty(store, 'saveRestoreTransaction', { value: undefined });
      else Object.defineProperty(manager, 'prepareRestoredSchedules', { value: undefined });
      expect(
        () =>
          new InteractiveSession({
            host: testHost,
            cwd: process.cwd(),
            session: sessionStub,
            sessionStore: store as never,
            resumeSessionId: 'session_resumed',
          }),
      ).toThrow(
        missing === 'store'
          ? /atomic store and a prepared schedule manager/i
          : /built.in.*manager/i,
      );
      expect(started).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
      expect(store.hasWriter('session_resumed')).toBe(false);
      expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
      if (missing === 'store') {
        const release = manager.attachSession({}, true, 'session_resumed');
        release();
      }
    },
  );

  it('rejects a custom asynchronous preparation before committing the restored record', async () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const prepare = vi.fn(() => Promise.reject(new Error('late preparation failure')));
    Object.defineProperty(manager, 'prepareRestoredSchedules', { value: prepare });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/built.in.*manager/i);
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
  });

  it('refuses a custom manager that ignores the final activation gate before saving', () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const activate = vi.fn(() => 'active' as const);
    const prepare = vi.fn(() => ({ activate, abort: vi.fn() }));
    Object.defineProperty(manager, 'prepareRestoredSchedules', { value: prepare });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/built.in.*manager/i);
    expect(prepare).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
  });

  it('uses the verified prepare method when a getter changes its return value', async () => {
    const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
    const original = manager.prepareRestoredSchedules;
    const malicious = vi.fn(() => ({ activate: () => 'active' as const, abort: vi.fn() }));
    let reads = 0;
    Object.defineProperty(manager, 'prepareRestoredSchedules', {
      get: () => (++reads < 3 ? original : malicious),
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const store = createStore(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    const session = new InteractiveSession({
      host: testHost,
      cwd: process.cwd(),
      session: sessionStub,
      sessionStore: store as never,
      resumeSessionId: 'session_resumed',
    });
    expect(malicious).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([expect.objectContaining({ id: 'sched_old' })]);
    await session.shutdown();
  });

  it('does not invoke a custom asynchronous batch and leaves the manager usable', async () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const prepare = manager.prepareRestoredSchedules.bind(manager);
    const customPrepare = vi.fn((...args: Parameters<typeof prepare>) =>
      Promise.resolve(prepare(...args)),
    );
    Object.defineProperty(manager, 'prepareRestoredSchedules', { value: customPrepare });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const store = createStore(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/built.in.*manager/i);
    await Promise.resolve();
    expect(customPrepare).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    const task = await manager.spawn({
      kind: 'scheduled',
      cronExpression: '* * * * *',
      agentInstruction: 'wake',
      label: 'other',
      mode: 'background',
      parentSessionId: 'other',
      depth: 0,
      cwd: process.cwd(),
    });
    expect(task.label).toBe('other');
    await manager.shutdown();
  });

  it('retains a sleeping schedule across a normal shutdown and another resume', async () => {
    const first = setupWithRecord(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    await first.session.shutdown();
    const outcome = first.store.load('session_resumed');
    expect(outcome).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_old', status: 'sleeping' })],
      },
    });
    if (outcome.status !== 'valid') throw new Error('session record unavailable');
    const second = setupWithRecord(outcome.record as Record<string, unknown>);
    expect(second.started).toEqual(['sched_old']);
    await second.session.shutdown();
  });

  it('preserves a paused schedule across shutdown without firing it', async () => {
    const { session, store } = setupWithRecord(pausedScheduledRecord());
    await session.shutdown();
    expect(store.load('session_resumed')).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_paused', status: 'paused' })],
      },
    });
  });

  it('does not restore a schedule that was explicitly cancelled before shutdown', async () => {
    const { session, store } = setupWithRecord(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    await session.cancelBackgroundTask('sched_old', 'stopped by owner');
    await session.shutdown();
    const outcome = store.load('session_resumed');
    expect(outcome).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_old', status: 'cancelled' })],
      },
    });
    if (outcome.status !== 'valid') throw new Error('session record unavailable');
    const resumed = setupWithRecord(outcome.record as Record<string, unknown>);
    expect(resumed.started).toEqual([]);
    await resumed.session.shutdown();
  });

  it('refuses an explicit cancellation while normal shutdown preserves the schedule', async () => {
    const { session, store, manager } = setupWithRecord(
      sleepingScheduledRecord('2999-01-01T00:00:00.000Z'),
    );
    const original = manager.shutdown.bind(manager);
    let releaseCancel: (() => void) | undefined;
    let signalCancel: (() => void) | undefined;
    const cancelStarted = new Promise<void>((resolve) => {
      signalCancel = resolve;
    });
    vi.spyOn(manager, 'shutdown').mockImplementation(async (reason) => {
      await new Promise<void>((resolve) => {
        releaseCancel = resolve;
        signalCancel?.();
      });
      await original(reason);
    });
    const shutdown = session.shutdown();
    await cancelStarted;
    try {
      await expect(session.cancelBackgroundTask('sched_old', 'stop')).rejects.toThrow(
        /shutting down/i,
      );
    } finally {
      releaseCancel?.();
      await shutdown;
    }
    expect(store.load('session_resumed')).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_old', status: 'sleeping' })],
      },
    });
  });

  it('does not start a restored schedule when the store reports an unknown commit', () => {
    const { runner, started } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    Object.defineProperty(store, 'saveRestoreTransaction', {
      value: () => ({ status: 'unknown', error: new Error('commit uncertain') }),
    });
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/unknown/i);
    expect(started).toEqual([]);
    expect(store.hasWriter('session_resumed')).toBe(false);
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
  });

  it('does not activate a schedule when a complete candidate was saved before an unknown outcome', () => {
    const { runner, started } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const store = createStore(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    Object.defineProperty(store, 'saveRestoreTransaction', {
      value: (candidate: { id: string }) => {
        store.save(candidate);
        return { status: 'unknown', error: new Error('post-write failure') };
      },
    });
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/unknown/i);
    expect(started).toEqual([]);
    expect(manager.list()).toEqual([]);
    expect(store.hasWriter('session_resumed')).toBe(false);
    expect(store.load('session_resumed')).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_old', status: 'sleeping' })],
      },
    });
  });

  it('holds reentrant timer ticks until a successful restore commit', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const manager = new BackgroundTaskManager({ runners: [createScheduledTaskRunner()] });
      const seen: string[] = [];
      manager.subscribe((event) => seen.push(event.type));
      const sessionStub = createSessionStub();
      storeAgentToolDeps(sessionStub, {
        backgroundTaskManager: manager,
      } as unknown as IAgentToolDeps);
      const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
      const tasks = saved['backgroundTasks'] as Array<Record<string, unknown>>;
      tasks[0]!['schedule'] = { cronExpression: '* * * * * *', agentInstruction: 'wake' };
      const store = createStore(saved);
      Object.defineProperty(store, 'saveRestoreTransaction', {
        value: (candidate: { id: string }) => {
          vi.advanceTimersByTime(2000);
          expect(seen).toEqual([]);
          store.save(candidate);
          return { status: 'committed' };
        },
      });
      const session = new InteractiveSession({
        host: testHost,
        cwd: process.cwd(),
        session: sessionStub,
        sessionStore: store as never,
        resumeSessionId: 'session_resumed',
      });
      expect(seen).toEqual([]);
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
      expect(seen.filter((event) => event === 'background_task_waking')).toHaveLength(2);
      await session.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the restored batch and expiry timers when post-commit setup fails', () => {
    vi.useFakeTimers();
    const timer = globalThis.setTimeout;
    let calls = 0;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('expiry timer unavailable');
      return timer(...args);
    });
    try {
      const { runner } = createTestScheduledRunner();
      const manager = new BackgroundTaskManager({ runners: [runner] });
      const sessionStub = createSessionStub();
      storeAgentToolDeps(sessionStub, {
        backgroundTaskManager: manager,
      } as unknown as IAgentToolDeps);
      const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
      const tasks = saved['backgroundTasks'] as Array<Record<string, unknown>>;
      tasks[0]!['metadata'] = {
        sessionLoop: true,
        sessionLoopExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      tasks.push({ ...tasks[0]!, id: 'sched_other', label: 'other' });
      const store = createStore(saved);
      expect(
        () =>
          new InteractiveSession({
            host: testHost,
            cwd: process.cwd(),
            session: sessionStub,
            sessionStore: store as never,
            resumeSessionId: 'session_resumed',
          }),
      ).toThrow(/expiry timer unavailable/i);
      expect(manager.list()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      expect(store.load('session_resumed')).toMatchObject({
        status: 'valid',
        record: {
          backgroundTasks: [
            expect.objectContaining({ id: 'sched_old', status: 'sleeping' }),
            expect.objectContaining({ id: 'sched_other', status: 'sleeping' }),
          ],
        },
      });
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('releases restored ID ownership after session shutdown', async () => {
    const record = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = record['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks[0]!['status'] = 'completed';
    const { session, manager } = setupWithRecord(record);
    await session.shutdown();
    expect(() => manager.reserveTaskIds(['sched_old'])).not.toThrow();
  });

  it('refuses to resume tasks when a custom manager cannot reserve their IDs, without saving', () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    Object.defineProperty(manager, 'reserveTaskIds', { value: undefined });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/reserv/i);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.hasWriter('session_resumed')).toBe(false);
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
  });

  it('refuses asynchronous custom reservation before rearming or saving', () => {
    const { runner, started } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    Object.defineProperty(manager, 'reserveTaskIds', {
      value: () => Promise.reject(new Error('late reservation failure')),
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/synchronously/i);
    expect(started).toHaveLength(0);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('releases a reservation returned asynchronously after refusing the restore', async () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const reserve = manager.reserveTaskIds.bind(manager);
    Object.defineProperty(manager, 'reserveTaskIds', {
      value: (ids: string[]) => Promise.resolve(reserve(ids)),
    });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const store = createStore(sleepingScheduledRecord('2999-01-01T00:00:00.000Z'));
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/synchronously/i);
    await Promise.resolve();
    expect(store.save).not.toHaveBeenCalled();
    const reservation = reserve(['sched_old']);
    reservation.release();
    await manager.shutdown();
  });

  it('keeps accepting a custom manager without reservation when no tasks are restored', async () => {
    const manager = new BackgroundTaskManager({ runners: [] });
    Object.defineProperty(manager, 'reserveTaskIds', { value: undefined });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = { ...sleepingScheduledRecord('2999-01-01T00:00:00.000Z'), backgroundTasks: [] };
    const store = createStore(saved);
    const session = new InteractiveSession({
      host: testHost,
      cwd: process.cwd(),
      session: sessionStub,
      sessionStore: store as never,
      resumeSessionId: 'session_resumed',
    });
    await expect(session.whenInitialized()).resolves.toBeUndefined();
    await session.shutdown();
  });

  it('refuses duplicate restored task IDs rather than overwriting either record', () => {
    const { runner } = createTestScheduledRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
    const tasks = saved['backgroundTasks'] as Array<Record<string, unknown>>;
    tasks.push({ ...tasks[0]!, label: 'other task' });
    const store = createStore(saved);
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: process.cwd(),
          session: sessionStub,
          sessionStore: store as never,
          resumeSessionId: 'session_resumed',
        }),
    ).toThrow(/duplicate/i);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.hasWriter('session_resumed')).toBe(false);
    expect(store.load('session_resumed')).toMatchObject({ status: 'valid', record: saved });
  });
});

it('restores the original schedule ID even if the manager factory repeats that ID', async () => {
  const { runner, started } = createTestScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner], idFactory: () => 'sched_old' });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const saved = sleepingScheduledRecord('2999-01-01T00:00:00.000Z');
  const store = createStore(saved);
  const session = new InteractiveSession({
    host: testHost,
    cwd: process.cwd(),
    session: sessionStub,
    sessionStore: store as never,
    resumeSessionId: 'session_resumed',
  });
  try {
    await Promise.resolve();
    expect(manager.list().map((task) => task.id)).toEqual(['sched_old']);
    expect(store.load('session_resumed')).toMatchObject({
      status: 'valid',
      record: {
        backgroundTasks: [expect.objectContaining({ id: 'sched_old', status: 'sleeping' })],
      },
    });
  } finally {
    await session.shutdown();
  }
});
