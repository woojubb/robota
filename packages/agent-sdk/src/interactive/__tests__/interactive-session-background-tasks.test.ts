import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@robota-sdk/agent-sessions';
import { BackgroundTaskManager } from '../../background-tasks/index.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskLogPage,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IExecutionWorkspaceEvent,
  TBackgroundTaskEvent,
} from '../../background-tasks/index.js';
import { InteractiveSession } from '../interactive-session.js';
import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_parent',
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
  } as unknown as Session;
}

function createSessionStoreStub() {
  const records = new Map<string, unknown>();
  return {
    load: vi.fn((id: string) => records.get(id)),
    save: vi.fn((record: { id: string } & Record<string, unknown>) =>
      records.set(record.id, record),
    ),
    list: vi.fn(() => [...records.values()]),
    delete: vi.fn((id: string) => records.delete(id)),
  };
}

function createResolvedRunner(output: string): IBackgroundTaskRunner {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      return {
        taskId: task.taskId,
        result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

function createAgentRequest(prompt: string) {
  return {
    kind: 'agent' as const,
    label: 'Explore',
    parentSessionId: 'session_parent',
    mode: 'background' as const,
    depth: 1,
    cwd: '/workspace',
    agentType: 'Explore',
    prompt,
    permissionPolicy: 'inherit-allowlist' as const,
  };
}

describe('InteractiveSession background task integration', () => {
  it('forwards background task manager events through background_task_event', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('done')] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({ session: sessionStub });
    const events: TBackgroundTaskEvent['type'][] = [];

    interactiveSession.on('background_task_event', (event) => {
      events.push(event.type);
    });

    const created = await manager.spawn(createAgentRequest('Find files'));
    const result: IBackgroundTaskResult = await manager.wait(created.id);

    expect(result.output).toBe('done');
    expect(events).toEqual([
      'background_task_created',
      'background_task_started',
      'background_task_completed',
    ]);
  });

  it('exposes background task list and close APIs', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('done')] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({ session: sessionStub });

    const created = await manager.spawn(createAgentRequest('Find files'));
    await manager.wait(created.id);

    expect(interactiveSession.listBackgroundTasks()).toHaveLength(1);
    expect(interactiveSession.getBackgroundTask(created.id)?.status).toBe('completed');

    await interactiveSession.closeBackgroundTask(created.id);

    expect(interactiveSession.listBackgroundTasks()).toHaveLength(0);
  });

  it('projects an execution workspace with main thread and background tasks', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('done')] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({ session: sessionStub });
    const workspaceEvents: IExecutionWorkspaceEvent[] = [];
    interactiveSession.on('execution_workspace_event', (event) => {
      workspaceEvents.push(event);
    });

    const created = await manager.spawn(createAgentRequest('Find files'));
    await manager.wait(created.id);

    const entries = interactiveSession.listExecutionWorkspaceEntries();
    expect(entries.map((entry) => entry.kind)).toEqual(['main_thread', 'background_task']);
    expect(entries[1]).toMatchObject({
      sourceId: created.id,
      taskKind: 'agent',
      attention: 'unread',
    });
    expect(workspaceEvents.map((event) => event.cause)).toContain('background_task');
  });

  it('reads execution workspace detail from a background task log', async () => {
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        return {
          taskId: task.taskId,
          logPath: '/tmp/agent.log',
          result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'done' }),
          cancel: () => Promise.resolve(),
          readLog: (): Promise<IBackgroundTaskLogPage> =>
            Promise.resolve({
              taskId: task.taskId,
              lines: ['line 1', 'line 2'],
              nextCursor: { offset: 2 },
            }),
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({ session: sessionStub });

    const created = await manager.spawn(createAgentRequest('Read logs'));
    const entry = interactiveSession
      .listExecutionWorkspaceEntries()
      .find((workspaceEntry) => workspaceEntry.sourceId === created.id);
    const detail = await interactiveSession.readExecutionWorkspaceDetail(entry?.id ?? '');

    expect(detail.records.map((record) => record.text)).toEqual(['line 1', 'line 2']);
    expect(detail.nextCursor).toEqual({ offset: 2 });
  });

  it('persists background task snapshots and streaming deltas into session JSON', async () => {
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        task.emit?.({ type: 'background_task_text_delta', delta: 'partial ' });
        return {
          taskId: task.taskId,
          transcriptPath: '/tmp/agent_1.jsonl',
          result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'done' }),
          cancel: () => Promise.resolve(),
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    const sessionStore = createSessionStoreStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    new InteractiveSession({
      session: sessionStub,
      sessionStore: sessionStore as never,
    });

    const created = await manager.spawn(createAgentRequest('Find files'));
    await manager.wait(created.id);

    const lastSaved = sessionStore.save.mock.calls.at(-1)?.[0] as {
      backgroundTasks?: Array<{ id: string; status: string; transcriptPath?: string }>;
      backgroundTaskEvents?: Array<{ type: string }>;
    };
    expect(lastSaved.backgroundTasks?.[0]).toMatchObject({
      id: created.id,
      status: 'completed',
      transcriptPath: '/tmp/agent_1.jsonl',
    });
    expect(lastSaved.backgroundTaskEvents?.map((event) => event.type)).toContain(
      'background_task_completed',
    );
    expect(lastSaved.backgroundTaskEvents?.map((event) => event.type)).toContain(
      'background_task_text_delta',
    );
  });

  it('persists and emits background job group events', async () => {
    const manager = new BackgroundTaskManager({ runners: [createResolvedRunner('summary')] });
    const sessionStub = createSessionStub();
    const sessionStore = createSessionStoreStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({
      session: sessionStub,
      sessionStore: sessionStore as never,
    });
    const events: string[] = [];

    interactiveSession.on('background_job_group_event', (event) => {
      events.push(event.type);
    });

    const first = await manager.spawn(createAgentRequest('first'));
    const second = await manager.spawn(createAgentRequest('second'));
    await manager.wait(first.id);
    await manager.wait(second.id);

    const group = interactiveSession.createBackgroundJobGroup({
      waitPolicy: 'wait_all',
      taskIds: [first.id, second.id],
      label: 'agent parallel',
    });
    const completed = await interactiveSession.waitBackgroundJobGroup(group.id);

    expect(completed.status).toBe('completed');
    expect(events).toContain('background_job_group_created');
    expect(events).toContain('background_job_group_completed');

    const lastSaved = sessionStore.save.mock.calls.at(-1)?.[0] as {
      backgroundJobGroups?: Array<{ id: string; status: string }>;
      backgroundJobGroupEvents?: Array<{ type: string }>;
    };
    expect(lastSaved.backgroundJobGroups?.[0]).toMatchObject({
      id: group.id,
      status: 'completed',
    });
    expect(lastSaved.backgroundJobGroupEvents?.map((event) => event.type)).toContain(
      'background_job_group_completed',
    );
  });

  it('shutdown cancels background tasks through the manager and ends the session once', async () => {
    let cancelReason = '';
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
        return {
          taskId: task.taskId,
          result: new Promise<IBackgroundTaskResult>(() => {}),
          cancel: (reason?: string) => {
            cancelReason = reason ?? '';
            return Promise.resolve();
          },
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const sessionStub = createSessionStub();
    storeAgentToolDeps(sessionStub, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const interactiveSession = new InteractiveSession({ session: sessionStub });

    const created = await manager.spawn(createAgentRequest('Find files'));
    await interactiveSession.shutdown({
      reason: 'prompt_input_exit',
      message: 'Ctrl-C shutdown',
    });
    await interactiveSession.shutdown({ reason: 'other', message: 'ignored' });

    expect(cancelReason).toBe('Ctrl-C shutdown');
    expect(manager.get(created.id)?.status).toBe('cancelled');
    expect(sessionStub.abort).toHaveBeenCalledTimes(1);
    expect(sessionStub.shutdown).toHaveBeenCalledTimes(1);
    expect(sessionStub.shutdown).toHaveBeenCalledWith({ reason: 'prompt_input_exit' });
  });

  it('marks restored running background tasks as stale when they cannot be reattached', () => {
    const sessionStub = createSessionStub();
    const sessionStore = createSessionStoreStub();
    sessionStore.save({
      id: 'session_stale',
      cwd: '/workspace',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      messages: [],
      history: [],
      backgroundTasks: [
        {
          id: 'agent_stale',
          kind: 'agent',
          label: 'Explore',
          agentType: 'Explore',
          status: 'running',
          mode: 'background',
          parentSessionId: 'session_stale',
          depth: 1,
          cwd: '/workspace',
          updatedAt: '2026-05-01T00:00:00.000Z',
          unread: false,
          promptPreview: 'Find files',
        },
      ],
      backgroundTaskEvents: [],
    });

    new InteractiveSession({
      session: sessionStub,
      sessionStore: sessionStore as never,
      resumeSessionId: 'session_stale',
    });

    const lastSaved = sessionStore.save.mock.calls.at(-1)?.[0] as {
      backgroundTasks?: Array<{ id: string; status: string; timeoutReason?: string }>;
      backgroundTaskEvents?: Array<{ type: string; task?: { id: string } }>;
    };
    expect(lastSaved.backgroundTasks?.[0]).toMatchObject({
      id: 'agent_stale',
      status: 'failed',
      timeoutReason: 'stale_worker',
    });
    expect(lastSaved.backgroundTaskEvents?.at(-1)).toMatchObject({
      type: 'background_task_failed',
      task: { id: 'agent_stale' },
    });
  });
});
