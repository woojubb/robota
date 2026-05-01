import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@robota-sdk/agent-sessions';
import { BackgroundTaskManager } from '../../background-tasks/index.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
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
  } as unknown as Session;
}

function createSessionStoreStub() {
  const records = new Map<string, unknown>();
  return {
    load: vi.fn((id: string) => records.get(id)),
    save: vi.fn((record: { id: string }) => records.set(record.id, record)),
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

  it('persists background task snapshots while keeping streaming deltas out of session JSON', async () => {
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
    expect(lastSaved.backgroundTaskEvents?.map((event) => event.type)).not.toContain(
      'background_task_text_delta',
    );
  });
});
