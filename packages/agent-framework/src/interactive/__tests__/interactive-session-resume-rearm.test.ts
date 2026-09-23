/**
 * FLOW-003 (Layer 3): on session resume, a persisted sleeping scheduled wake is re-armed
 * (re-spawned from its persisted `schedule`) instead of being killed as stale, and a
 * missed-wake note is surfaced when its fire time elapsed while the session was closed.
 */

import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type { SessionHistoryTracker } from '../interactive-session-history-tracker.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-session';

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_resumed',
    getHistory: () => [],
    getSystemMessage: () => 'system',
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

interface IFakeScheduled {
  runner: IBackgroundTaskRunner;
  started: string[];
}

function createFakeScheduledRunner(): IFakeScheduled {
  const started: string[] = [];
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      started.push(task.taskId);
      const emit = task.emit ?? (() => undefined);
      emit({ type: 'background_task_sleeping', nextFireAt: '2999-01-01T00:00:00.000Z' });
      return {
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel: () => Promise.resolve(),
        pause: () => Promise.resolve(),
        resume: () => Promise.resolve(),
        editSchedule: () => Promise.resolve(),
      };
    },
  };
  return { runner, started };
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
): {
  started: string[];
  manager: BackgroundTaskManager;
  session: InteractiveSession;
  store: ReturnType<typeof createStore>;
} {
  const { runner, started } = createFakeScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const store = createStore(record);
  const session = new InteractiveSession({
    session: sessionStub,
    sessionStore: store as never,
    resumeSessionId: 'session_resumed',
    disableSessionLoops,
  });
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
  return {
    load: vi.fn((id: string) => {
      const record = map.get(id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    }),
    save: vi.fn((r: { id: string }) => map.set(r.id, r)),
    list: vi.fn(() =>
      [...map.entries()].map(([id, record]) => ({ id, outcome: { status: 'valid', record } })),
    ),
    delete: vi.fn((id: string) => map.delete(id)),
  };
}

function history(session: InteractiveSession): IHistoryEntry[] {
  return (session as unknown as { histTracker: SessionHistoryTracker }).histTracker.getHistory();
}

function setup(nextFireAt: string): { started: string[]; session: InteractiveSession } {
  const { runner, started } = createFakeScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const store = createStore(sleepingScheduledRecord(nextFireAt));
  const session = new InteractiveSession({
    session: sessionStub,
    sessionStore: store as never,
    resumeSessionId: 'session_resumed',
  });
  return { started, session };
}

describe('FLOW-003 resume re-arm + missed-wake', () => {
  it('TC-01: a restored sleeping scheduled wake is re-armed (re-spawned), not killed', () => {
    const { started } = setup('2999-01-01T00:00:00.000Z');
    expect(started).toHaveLength(1); // the manager re-spawned the schedule
  });

  it('TC-02: an elapsed nextFireAt surfaces exactly one missed-wake note', () => {
    const { session } = setup('2000-01-01T00:00:00.000Z');
    const notes = history(session).filter(
      (e) => e.type === 'system' && JSON.stringify(e).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(1);
  });

  it('TC-03: a future nextFireAt re-arms without a missed-wake note', () => {
    const { session } = setup('2999-01-01T00:00:00.000Z');
    const notes = history(session).filter((e) =>
      JSON.stringify(e).includes('Missed scheduled wake'),
    );
    expect(notes).toHaveLength(0);
  });

  it('retains a loop identity marker when a restored schedule receives a new runtime id', () => {
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
    expect(rearmed?.id).not.toBe('sched_old');
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

  // SELFHOST-012 TC-06: a persisted PAUSED schedule re-arms as paused (not failed, not firing) on restart.
  it('TC-06: a restored paused schedule is kept + re-armed paused, not reconciled to failed', async () => {
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
