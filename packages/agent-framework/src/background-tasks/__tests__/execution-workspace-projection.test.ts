import { describe, expect, it } from 'vitest';
import {
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createExecutionOriginMetadata,
  createExecutionWorkspaceSnapshot,
  createMainThreadExecutionEntryId,
} from '../index.js';
import type { IBackgroundTaskState } from '../index.js';
import type { IBackgroundJobGroupState } from '../background-job-orchestrator.js';

function createTask(overrides: Partial<IBackgroundTaskState> = {}): IBackgroundTaskState {
  return {
    id: 'agent_1',
    kind: 'agent',
    label: 'Review',
    agentType: 'reviewer',
    status: 'running',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
    updatedAt: '2026-05-09T00:00:01.000Z',
    lastActivityAt: '2026-05-09T00:00:02.000Z',
    unread: false,
    promptPreview: 'Review the auth module',
    ...overrides,
  };
}

function createGroup(overrides: Partial<IBackgroundJobGroupState> = {}): IBackgroundJobGroupState {
  return {
    id: 'group_1',
    parentSessionId: 'session_parent',
    waitPolicy: 'wait_all',
    taskIds: ['agent_1'],
    status: 'running',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:03.000Z',
    label: 'parallel review',
    results: [],
    ...overrides,
  };
}

describe('execution workspace projection', () => {
  it('projects main thread, groups, and background tasks into selectable entries', () => {
    const snapshot = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread: {
        sessionId: 'session_parent',
        isExecuting: true,
        hasPendingPrompt: false,
        historyLength: 2,
        updatedAt: '2026-05-09T00:00:00.000Z',
        preview: 'Working',
      },
      groups: [createGroup()],
      tasks: [
        createTask({
          metadata: createExecutionOriginMetadata({
            kind: 'skill',
            sessionId: 'session_parent',
            skillId: 'security-review',
          }),
          logPath: '/tmp/agent.log',
        }),
      ],
    });

    expect(snapshot.entries.map((entry) => entry.id)).toEqual([
      createMainThreadExecutionEntryId('session_parent'),
      createBackgroundGroupExecutionEntryId('group_1'),
      createBackgroundTaskExecutionEntryId('agent_1'),
    ]);
    expect(snapshot.entries[0]).toMatchObject({
      kind: 'main_thread',
      status: 'active',
      controls: ['select'],
    });
    expect(snapshot.entries[2]).toMatchObject({
      kind: 'background_task',
      groupId: createBackgroundGroupExecutionEntryId('group_1'),
      origin: { kind: 'skill', skillId: 'security-review' },
      controls: ['select', 'cancel', 'send', 'read_log'],
    });
  });

  it('marks clean completed tasks as collapsed while keeping them queryable', () => {
    const snapshot = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread: {
        sessionId: 'session_parent',
        isExecuting: false,
        hasPendingPrompt: false,
        historyLength: 1,
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      groups: [],
      tasks: [
        createTask({
          status: 'completed',
          unread: false,
          completedAt: '2026-05-09T00:00:04.000Z',
          result: { taskId: 'agent_1', kind: 'agent', output: 'done', exitCode: 0 },
        }),
      ],
    });

    expect(snapshot.entries[1]).toMatchObject({
      id: createBackgroundTaskExecutionEntryId('agent_1'),
      attention: 'completed',
      visibility: 'collapsed',
      controls: ['select', 'close'],
    });
  });

  it('adds send control to running agent tasks but not process tasks', () => {
    const snapshot = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread: {
        sessionId: 'session_parent',
        isExecuting: false,
        hasPendingPrompt: false,
        historyLength: 0,
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      groups: [],
      tasks: [
        createTask({ id: 'agent_1', kind: 'agent', status: 'running' }),
        createTask({ id: 'proc_1', kind: 'process', status: 'running' }),
        createTask({ id: 'agent_done', kind: 'agent', status: 'completed', unread: true }),
      ],
    });

    const taskById = Object.fromEntries(snapshot.entries.map((e) => [e.sourceId, e]));
    expect(taskById['agent_1'].controls).toContain('send');
    expect(taskById['proc_1'].controls).not.toContain('send');
    expect(taskById['agent_done'].controls).not.toContain('send');
  });
});
