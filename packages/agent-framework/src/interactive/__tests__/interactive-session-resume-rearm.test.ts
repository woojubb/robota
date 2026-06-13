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
} from '../../background-tasks/index.js';
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
      return {
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel: () => Promise.resolve(),
      };
    },
  };
  return { runner, started };
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
    load: vi.fn((id: string) => map.get(id)),
    save: vi.fn((r: { id: string }) => map.set(r.id, r)),
    list: vi.fn(() => [...map.values()]),
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
});
