/**
 * What a session saves of a background job's events while the job streams.
 *
 * A save rewrites the whole record, and a job streams its output as many small events. The record
 * must therefore carry a bounded recent window of those events, and a stream of output must not
 * rewrite it once per event.
 */
import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { SessionBackgroundTaskTracker } from '../interactive-session-background-tracker.js';
import { InteractiveSession } from '../interactive-session.js';
import {
  MAX_RECORDED_STREAM_EVENTS,
  STREAM_EVENT_SAVE_INTERVAL_MS,
} from '../recorded-task-events.js';
import { createSessionStub } from './helpers/session-stub.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskResult,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface/execution';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';

const testHost = createTestFrameworkHost();
const DELTAS = 5000;

type TEmit = NonNullable<IBackgroundTaskStart<'agent'>['emit']>;

interface IScriptedJob {
  emit: TEmit;
  finish: (output: string) => void;
}

function createScriptedRunner(): { runner: IBackgroundTaskRunner<'agent'>; job: IScriptedJob } {
  const job: IScriptedJob = {
    emit: () => {
      throw new Error('the job has not started');
    },
    finish: () => {
      throw new Error('the job has not started');
    },
  };
  const runner: IBackgroundTaskRunner<'agent'> = {
    kind: 'agent',
    start(task: IBackgroundTaskStart<'agent'>): IBackgroundTaskHandle<'agent'> {
      const result = new Promise<IBackgroundTaskResult<'agent'>>((resolve) => {
        job.finish = (output) => resolve({ taskId: task.taskId, kind: 'agent', output });
      });
      job.emit = (event) => task.emit?.(event);
      return { taskId: task.taskId, result, cancel: () => Promise.resolve() };
    },
  };
  return { runner, job };
}

function createSessionStoreStub() {
  const records = new Map<string, unknown>();
  return withHoldReadClaim({
    load: vi.fn((id: string) => {
      const record = records.get(id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    }),
    save: vi.fn((record: { id: string } & Record<string, unknown>) =>
      records.set(record.id, record),
    ),
    list: vi.fn(() => []),
    delete: vi.fn((id: string) => records.delete(id)),
  });
}

interface ISavedRecord {
  backgroundTaskEvents?: TBackgroundTaskEvent[];
}

function lastSaved(store: ReturnType<typeof createSessionStoreStub>): ISavedRecord {
  return store.save.mock.calls.at(-1)?.[0] as ISavedRecord;
}

function createSession() {
  const { runner, job } = createScriptedRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub({ getSessionId: () => 'session_parent' });
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const sessionStore = createSessionStoreStub();
  const interactiveSession = new InteractiveSession({
    host: testHost,
    cwd: process.cwd(),
    session: sessionStub,
    sessionStore: sessionStore as never,
  });
  return { manager, job, sessionStore, interactiveSession };
}

const request = {
  kind: 'agent' as const,
  label: 'streamer',
  parentSessionId: 'session_parent',
  mode: 'background' as const,
  depth: 1,
  cwd: '/workspace',
  agentType: 'general-purpose',
  prompt: 'stream a lot',
  permissionPolicy: 'inherit-allowlist' as const,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a job that streams its output', () => {
  it('does not rewrite the record per delta, and the saved events stay a bounded window', async () => {
    const { manager, job, sessionStore } = createSession();
    await manager.spawn(request);
    const savesBeforeStream = sessionStore.save.mock.calls.length;

    for (let index = 0; index < DELTAS; index += 1) {
      job.emit({ type: 'background_task_text_delta', delta: `chunk ${index} ` });
    }
    // Whatever rate-limited save there is has had its time.
    vi.advanceTimersByTime(60_000);

    const savesDuringStream = sessionStore.save.mock.calls.length - savesBeforeStream;
    const saved = lastSaved(sessionStore).backgroundTaskEvents ?? [];
    expect(savesDuringStream).toBeLessThan(10);
    expect(saved.length).toBeLessThan(DELTAS / 4);
    // The window is the most recent events; the job's lifecycle is still in the record.
    expect(saved.at(-1)).toEqual({
      type: 'background_task_text_delta',
      taskId: expect.any(String),
      delta: `chunk ${DELTAS - 1} `,
    });
    expect(saved.map((event) => event.type)).toEqual(
      expect.arrayContaining(['background_task_created', 'background_task_started']),
    );
  });
});

describe('the saves of a job that streams', () => {
  it('saves once an interval, and what it saves is the newest window beside the lifecycle', async () => {
    const { manager, job, sessionStore } = createSession();
    await manager.spawn(request);
    const savesBeforeStream = sessionStore.save.mock.calls.length;

    for (let index = 0; index < DELTAS; index += 1) {
      job.emit({ type: 'background_task_text_delta', delta: `chunk ${index} ` });
    }
    expect(sessionStore.save.mock.calls.length).toBe(savesBeforeStream);

    vi.advanceTimersByTime(STREAM_EVENT_SAVE_INTERVAL_MS);
    expect(sessionStore.save.mock.calls.length).toBe(savesBeforeStream + 1);
    // created and started, then the newest window of output.
    expect(lastSaved(sessionStore).backgroundTaskEvents).toHaveLength(
      2 + MAX_RECORDED_STREAM_EVENTS,
    );

    vi.advanceTimersByTime(10 * STREAM_EVENT_SAVE_INTERVAL_MS);
    expect(sessionStore.save.mock.calls.length).toBe(savesBeforeStream + 1);
  });

  it('does not save for the tool activity of a running job, nor for the updates it causes', async () => {
    const { manager, job, sessionStore } = createSession();
    await manager.spawn(request);
    const savesBefore = sessionStore.save.mock.calls.length;

    job.emit({ type: 'background_task_tool_start', toolName: 'Read', firstArg: '/src/a.ts' });
    job.emit({ type: 'background_task_tool_end', toolName: 'Read', success: true });
    expect(sessionStore.save.mock.calls.length).toBe(savesBefore);

    vi.advanceTimersByTime(STREAM_EVENT_SAVE_INTERVAL_MS);
    expect(sessionStore.save.mock.calls.length).toBe(savesBefore + 1);
    expect(lastSaved(sessionStore).backgroundTaskEvents?.map((event) => event.type)).toEqual([
      'background_task_created',
      'background_task_started',
      'background_task_updated',
      'background_task_tool_start',
      'background_task_updated',
      'background_task_tool_end',
    ]);
  });

  it('saves at once when the job ends, with the output that was still waiting', async () => {
    const { manager, job, sessionStore } = createSession();
    const created = await manager.spawn(request);
    job.emit({ type: 'background_task_text_delta', delta: 'almost ' });
    job.emit({ type: 'background_task_text_delta', delta: 'there' });
    const savesBefore = sessionStore.save.mock.calls.length;

    job.finish('done');
    await manager.wait(created.id);

    expect(sessionStore.save.mock.calls.length).toBe(savesBefore + 1);
    const types = lastSaved(sessionStore).backgroundTaskEvents?.map((event) => event.type);
    expect(types?.slice(-3)).toEqual([
      'background_task_text_delta',
      'background_task_text_delta',
      'background_task_completed',
    ]);
    // The save that carried the output is the one the wait was for: nothing is left to save.
    vi.advanceTimersByTime(10 * STREAM_EVENT_SAVE_INTERVAL_MS);
    expect(sessionStore.save.mock.calls.length).toBe(savesBefore + 1);
  });

  it('is saved in full by shutdown, and leaves no save waiting behind it', async () => {
    const { manager, job, sessionStore, interactiveSession } = createSession();
    await manager.spawn(request);
    job.emit({ type: 'background_task_text_delta', delta: 'last words' });

    await interactiveSession.shutdown({ reason: 'other', message: 'closing' });

    const savesAtShutdown = sessionStore.save.mock.calls.length;
    const kept = lastSaved(sessionStore).backgroundTaskEvents ?? [];
    expect(kept.map((event) => event.type)).toContain('background_task_text_delta');
    expect(kept.at(-1)).toMatchObject({ type: 'background_task_cancelled' });
    vi.advanceTimersByTime(10 * STREAM_EVENT_SAVE_INTERVAL_MS);
    expect(sessionStore.save.mock.calls.length).toBe(savesAtShutdown);
  });
});

describe('a tracker that is disposed', () => {
  it('does not save the output it was still waiting to save', async () => {
    const { runner, job } = createScriptedRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub({ getSessionId: () => 'session_parent' });
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const persist = vi.fn();
    const tracker = new SessionBackgroundTaskTracker(
      () => manager,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      persist,
    );
    tracker.subscribe(sessionStub);
    await manager.spawn(request);
    job.emit({ type: 'background_task_text_delta', delta: 'still waiting' });
    const savesBefore = persist.mock.calls.length;

    tracker.dispose();
    vi.advanceTimersByTime(10 * STREAM_EVENT_SAVE_INTERVAL_MS);

    expect(persist.mock.calls.length).toBe(savesBefore);
  });
});

describe('resuming a record written without a bound', () => {
  it('carries only a bounded window of its events on, with the lifecycle it had', () => {
    const sessionStub = createSessionStub({ getSessionId: () => 'session_old' });
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: new BackgroundTaskManager({ runners: [] }),
    } as unknown as IAgentToolDeps);
    const sessionStore = createSessionStoreStub();
    const running = {
      id: 'agent_old',
      kind: 'agent',
      label: 'Explore',
      agentType: 'Explore',
      status: 'running',
      mode: 'background',
      parentSessionId: 'session_old',
      depth: 1,
      cwd: '/workspace',
      updatedAt: '2026-05-01T00:00:00.000Z',
      unread: false,
    };
    sessionStore.save({
      id: 'session_old',
      cwd: '/workspace',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      messages: [],
      history: [],
      backgroundTasks: [running],
      backgroundTaskEvents: [
        { type: 'background_task_created', task: running },
        ...Array.from({ length: DELTAS }, (_, index) => ({
          type: 'background_task_text_delta',
          taskId: 'agent_old',
          delta: `chunk ${index} `,
        })),
      ],
    });

    new InteractiveSession({
      host: testHost,
      cwd: process.cwd(),
      session: sessionStub,
      sessionStore: sessionStore as never,
      resumeSessionId: 'session_old',
    });

    const kept = lastSaved(sessionStore).backgroundTaskEvents ?? [];
    expect(kept.map((event) => event.type)).toEqual([
      'background_task_created',
      ...Array.from({ length: MAX_RECORDED_STREAM_EVENTS }, () => 'background_task_text_delta'),
      // The task could not be reattached, which the resume records as its end.
      'background_task_failed',
    ]);
    expect(kept.at(-2)).toMatchObject({ delta: `chunk ${DELTAS - 1} ` });
  });
});
