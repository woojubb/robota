/**
 * What a surface reads of a fork job through the session (live follow).
 *
 * A follower that looks at a running fork sees what the job is doing now: the rows of its recent
 * events, kept by the parent in a small window. Asking for more — a cursor — reads the job's own
 * conversation, page by page. The window is a view: the saved record of the session is what it was,
 * and a task that is not a fork has no window at all.
 */
import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { InteractiveSession } from '../interactive-session.js';
import { STREAM_EVENT_SAVE_INTERVAL_MS } from '../recorded-task-events.js';
import { createSessionStub } from './helpers/session-stub.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskResult,
} from '@robota-sdk/agent-interface/execution';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';

const testHost = createTestFrameworkHost();
const FORK_ID = 'session_fork';

type TEmit = NonNullable<IBackgroundTaskStart<'agent'>['emit']>;

/** A running job the test drives: it emits what the test says, takes input, and reads its own log. */
interface IScriptedJob {
  emit: TEmit;
  sent: string[];
  refuseSends: boolean;
  readLogCursors: Array<IBackgroundTaskLogCursor | undefined>;
  finish: (output: string) => void;
}

function createScriptedRunner(options: { withLogPath?: boolean } = {}): {
  runner: IBackgroundTaskRunner<'agent'>;
  job: IScriptedJob;
} {
  const job: IScriptedJob = {
    emit: () => {
      throw new Error('the job has not started');
    },
    sent: [],
    refuseSends: false,
    readLogCursors: [],
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
      return {
        taskId: task.taskId,
        ...(options.withLogPath === true ? { logPath: '/tmp/agent.log' } : {}),
        result,
        cancel: () => Promise.resolve(),
        send: (input) => {
          if (job.refuseSends) return Promise.reject(new Error('the job has ended'));
          job.sent.push(input.prompt ?? '');
          return Promise.resolve();
        },
        readLog: (cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage> => {
          job.readLogCursors.push(cursor);
          return Promise.resolve({
            taskId: task.taskId,
            ...(cursor === undefined ? {} : { cursor }),
            lines: ['user: keep going', 'assistant: began'],
            nextCursor: { offset: 2 },
            unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
          });
        },
      };
    },
  };
  return { runner, job };
}

function agentRequest(options: { fork: boolean }) {
  return {
    kind: 'agent' as const,
    label: 'experiment',
    parentSessionId: 'session_parent',
    mode: 'background' as const,
    depth: 1,
    cwd: '/workspace',
    agentType: 'general-purpose',
    prompt: 'keep going',
    permissionPolicy: 'inherit-allowlist' as const,
    ...(options.fork ? { resumeSessionId: FORK_ID } : {}),
  };
}

function createSession(runner: IBackgroundTaskRunner<'agent'>, sessionStore?: unknown) {
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub({ getSessionId: () => 'session_parent' });
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const interactiveSession = new InteractiveSession({
    host: testHost,
    cwd: process.cwd(),
    session: sessionStub,
    ...(sessionStore === undefined ? {} : { sessionStore: sessionStore as never }),
  });
  return { manager, interactiveSession };
}

function entryIdOf(interactiveSession: InteractiveSession, taskId: string): string {
  const entry = interactiveSession
    .listExecutionWorkspaceEntries()
    .find((candidate) => candidate.sourceId === taskId);
  if (entry === undefined) throw new Error(`no entry for ${taskId}`);
  return entry.id;
}

function streamSomeOutput(job: IScriptedJob): void {
  job.emit({ type: 'background_task_text_delta', delta: 'Looking at ' });
  job.emit({ type: 'background_task_text_delta', delta: 'the parser.' });
  job.emit({ type: 'background_task_tool_start', toolName: 'Read', firstArg: '/src/a.ts' });
  job.emit({ type: 'background_task_tool_end', toolName: 'Read', success: true });
}

describe('reading a running fork through the session', () => {
  it('shows the rows of its recent events, with no further page to read', async () => {
    const { runner, job } = createScriptedRunner();
    const { manager, interactiveSession } = createSession(runner);
    const created = await manager.spawn(agentRequest({ fork: true }));

    streamSomeOutput(job);
    const detail = await interactiveSession.readExecutionWorkspaceDetail(
      entryIdOf(interactiveSession, created.id),
    );

    expect(detail.records.map((record) => [record.kind, record.text])).toEqual([
      ['message', 'Looking at the parser.'],
      ['tool_activity', 'Read /src/a.ts — done'],
    ]);
    expect(detail.nextCursor).toBeUndefined();
    expect(job.readLogCursors).toEqual([]);
  });

  it('shows a message the person sent once the job accepted it, and nothing when it refused', async () => {
    const { runner, job } = createScriptedRunner();
    const { manager, interactiveSession } = createSession(runner);
    const created = await manager.spawn(agentRequest({ fork: true }));
    const entryId = entryIdOf(interactiveSession, created.id);
    streamSomeOutput(job);

    await interactiveSession.sendBackgroundTask(created.id, { prompt: 'also add a test' });
    job.refuseSends = true;
    await expect(
      interactiveSession.sendBackgroundTask(created.id, { prompt: 'too late' }),
    ).rejects.toThrow('has ended');

    expect(job.sent).toEqual(['also add a test']);
    const detail = await interactiveSession.readExecutionWorkspaceDetail(entryId);
    expect(detail.records.map((record) => record.text)).toEqual([
      'Looking at the parser.',
      'Read /src/a.ts — done',
      'You: also add a test',
    ]);
  });

  it('keeps the rows of a job that ended, with how it ended, until the task is closed', async () => {
    const { runner, job } = createScriptedRunner();
    const { manager, interactiveSession } = createSession(runner);
    const created = await manager.spawn(agentRequest({ fork: true }));
    const entryId = entryIdOf(interactiveSession, created.id);
    streamSomeOutput(job);

    job.finish('all done');
    await manager.wait(created.id);
    const detail = await interactiveSession.readExecutionWorkspaceDetail(entryId);

    expect(detail.records.map((record) => [record.kind, record.text])).toEqual([
      ['message', 'Looking at the parser.'],
      ['tool_activity', 'Read /src/a.ts — done'],
      ['result', 'all done'],
    ]);
  });

  it('reads the job’s own conversation, page by page, when asked with a cursor', async () => {
    const { runner, job } = createScriptedRunner();
    const { manager, interactiveSession } = createSession(runner);
    const created = await manager.spawn(agentRequest({ fork: true }));
    streamSomeOutput(job);

    const page = await interactiveSession.readExecutionWorkspaceDetail(
      entryIdOf(interactiveSession, created.id),
      { offset: 0 },
    );

    expect(job.readLogCursors).toEqual([{ offset: 0 }]);
    expect(page.records.map((record) => record.text)).toEqual([
      'user: keep going',
      'assistant: began',
    ]);
    expect(page.cursor).toEqual({ offset: 0 });
    expect(page.nextCursor).toEqual({ offset: 2 });
    // Records that could not be shown are counted, so a reader can say why a page is short.
    expect(page.unreadable).toEqual({ locked: 1, noKeys: 0, doesNotOpen: 0 });
  });
});

describe('a task that is not a fork', () => {
  it('has no window: its detail is still its log, or its state', async () => {
    const withLog = createScriptedRunner({ withLogPath: true });
    const logged = createSession(withLog.runner);
    const loggedTask = await logged.manager.spawn(agentRequest({ fork: false }));
    streamSomeOutput(withLog.job);

    const fromLog = await logged.interactiveSession.readExecutionWorkspaceDetail(
      entryIdOf(logged.interactiveSession, loggedTask.id),
    );

    expect(fromLog.records.map((record) => record.text)).toEqual([
      'user: keep going',
      'assistant: began',
    ]);

    const bare = createScriptedRunner();
    const stateOnly = createSession(bare.runner);
    const bareTask = await stateOnly.manager.spawn(agentRequest({ fork: false }));
    streamSomeOutput(bare.job);

    const fromState = await stateOnly.interactiveSession.readExecutionWorkspaceDetail(
      entryIdOf(stateOnly.interactiveSession, bareTask.id),
    );

    expect(fromState.records.map((record) => record.text)).not.toContain('Looking at the parser.');
    expect(bare.job.readLogCursors).toEqual([]);
  });
});

describe('the saved record of a session with a fork running', () => {
  it('holds the events as they came once the save that waits for output has run, not the window', async () => {
    vi.useFakeTimers();
    const { runner, job } = createScriptedRunner();
    const records = new Map<string, unknown>();
    const sessionStore = withHoldReadClaim({
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
    const { manager } = createSession(runner, sessionStore);
    await manager.spawn(agentRequest({ fork: true }));

    streamSomeOutput(job);
    vi.advanceTimersByTime(STREAM_EVENT_SAVE_INTERVAL_MS);
    vi.useRealTimers();

    const saved = sessionStore.save.mock.calls.at(-1)?.[0] as {
      backgroundTaskEvents?: Array<{ type: string; delta?: string }>;
    };
    expect(
      saved.backgroundTaskEvents
        ?.filter((event) => event.type === 'background_task_text_delta')
        .map((event) => event.delta),
    ).toEqual(['Looking at ', 'the parser.']);
    expect(saved.backgroundTaskEvents?.map((event) => event.type)).toEqual([
      'background_task_created',
      'background_task_started',
      'background_task_text_delta',
      'background_task_text_delta',
      'background_task_updated',
      'background_task_tool_start',
      'background_task_updated',
      'background_task_tool_end',
    ]);
  });
});
