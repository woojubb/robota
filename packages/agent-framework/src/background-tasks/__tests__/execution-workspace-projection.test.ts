import { describe, expect, it } from 'vitest';

import {
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createExecutionOriginMetadata,
  createExecutionWorkspaceSnapshot,
  createMainThreadExecutionEntryId,
} from '../index.js';

import type { IBackgroundJobGroupState } from '../background-job-orchestrator.js';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

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
          result: { taskId: 'agent_1', kind: 'agent', output: 'done' },
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

  // SCREEN-010: order must be stable (creation/start order), not churn by lastActivityAt.
  it('orders background tasks by startedAt, not by lastActivityAt', () => {
    const build = (lastActivity: { a: string; b: string; c: string }) =>
      createExecutionWorkspaceSnapshot({
        sessionId: 'session_parent',
        mainThread: {
          sessionId: 'session_parent',
          isExecuting: false,
          hasPendingPrompt: false,
          historyLength: 0,
          updatedAt: '2026-05-09T00:00:00.000Z',
        },
        groups: [],
        // Started a → b → c. lastActivityAt is varied to try to reshuffle them.
        tasks: [
          createTask({
            id: 'task_b',
            startedAt: '2026-05-09T00:00:02.000Z',
            lastActivityAt: lastActivity.b,
          }),
          createTask({
            id: 'task_c',
            startedAt: '2026-05-09T00:00:03.000Z',
            lastActivityAt: lastActivity.c,
          }),
          createTask({
            id: 'task_a',
            startedAt: '2026-05-09T00:00:01.000Z',
            lastActivityAt: lastActivity.a,
          }),
        ],
      });

    const order = (snap: ReturnType<typeof build>) =>
      snap.entries.filter((e) => e.kind === 'background_task').map((e) => e.sourceId);

    // First render: ascending startedAt regardless of input array order.
    const first = build({
      a: '2026-05-09T00:00:10.000Z',
      b: '2026-05-09T00:00:11.000Z',
      c: '2026-05-09T00:00:12.000Z',
    });
    expect(order(first)).toEqual(['task_a', 'task_b', 'task_c']);

    // Later render where activity order is reversed (c most recent): order must NOT change.
    const later = build({
      a: '2026-05-09T00:00:99.000Z',
      b: '2026-05-09T00:00:50.000Z',
      c: '2026-05-09T00:00:20.000Z',
    });
    expect(order(later)).toEqual(['task_a', 'task_b', 'task_c']);
  });
});

describe('SCREEN-1992 normalized state, headline and next fire (TC-03)', () => {
  const mainThread = {
    sessionId: 'session_parent',
    isExecuting: false,
    hasPendingPrompt: false,
    historyLength: 1,
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
  const entryFor = (task: IBackgroundTaskState) =>
    createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread,
      groups: [],
      tasks: [task],
    }).entries.find((entry) => entry.kind === 'background_task')!;

  it('maps every task status onto the five-word state, never calling a cancelled task completed', () => {
    const expected: Record<IBackgroundTaskState['status'], string> = {
      queued: 'working',
      running: 'working',
      sleeping: 'working',
      waiting_permission: 'needs-input',
      paused: 'stopped',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'stopped',
    };
    for (const [status, state] of Object.entries(expected)) {
      expect(entryFor(createTask({ status: status as IBackgroundTaskState['status'] })).state).toBe(
        state,
      );
    }
  });

  it('gives the main thread working while executing, needs-input on a parked prompt, completed when idle', () => {
    const snapshotFor = (
      input: Partial<typeof mainThread> & {
        pendingRequest?: { kind: 'permission' | 'ask'; text: string };
      },
    ) =>
      createExecutionWorkspaceSnapshot({
        sessionId: 'session_parent',
        mainThread: { ...mainThread, ...input },
        groups: [],
        tasks: [],
      }).entries[0]!;
    expect(snapshotFor({ isExecuting: true }).state).toBe('working');
    expect(snapshotFor({ isExecuting: false }).state).toBe('completed');
    // A queued co-drive prompt is "a turn waiting to run", not "waiting for you".
    expect(snapshotFor({ isExecuting: true, hasPendingPrompt: true }).state).toBe('working');
    const parked = snapshotFor({
      isExecuting: true,
      pendingRequest: { kind: 'permission', text: 'Allow tool Bash?' },
    });
    expect(parked.state).toBe('needs-input');
    expect(parked.headline).toEqual({ kind: 'question', text: 'Allow tool Bash?' });
  });

  it('chooses the headline kind by state: question, result, or activity', () => {
    expect(
      entryFor(createTask({ status: 'running', currentAction: 'Edit src/app.ts' })).headline,
    ).toEqual({
      kind: 'activity',
      text: 'Edit src/app.ts',
    });
    expect(
      entryFor(
        createTask({
          status: 'completed',
          result: { taskId: 'agent_1', kind: 'agent', output: 'Reviewed 3 files' },
        }),
      ).headline,
    ).toEqual({
      kind: 'result',
      text: 'Reviewed 3 files',
    });
    expect(
      entryFor(
        createTask({
          status: 'failed',
          error: { category: 'runner', message: 'boom', recoverable: false },
        }),
      ).headline,
    ).toEqual({
      kind: 'result',
      text: 'boom',
    });
    expect(
      entryFor(
        createTask({
          kind: 'scheduled',
          status: 'sleeping',
          nextFireAt: '2999-01-01T00:00:00.000Z',
          schedule: { cronExpression: '0 0 * * *', agentInstruction: 'summarize logs' },
        }),
      ).headline,
    ).toEqual({ kind: 'activity', text: 'summarize logs' });
  });

  it('carries nextFireAt only for a sleeping schedule and no longer bakes it into the subtitle', () => {
    const sleeping = entryFor(
      createTask({
        kind: 'scheduled',
        status: 'sleeping',
        nextFireAt: '2999-01-01T00:00:00.000Z',
        schedule: { cronExpression: '0 0 * * *' },
      }),
    );
    expect(sleeping.nextFireAt).toBe('2999-01-01T00:00:00.000Z');
    expect(sleeping.subtitle ?? '').not.toMatch(/next:/);
    expect(
      entryFor(
        createTask({
          kind: 'scheduled',
          status: 'paused',
          schedule: { cronExpression: '0 0 * * *' },
        }),
      ).nextFireAt,
    ).toBeUndefined();
  });

  it('maps a group by the same table', () => {
    const groupEntry = (group: IBackgroundJobGroupState) =>
      createExecutionWorkspaceSnapshot({
        sessionId: 'session_parent',
        mainThread,
        groups: [group],
        tasks: [],
      }).entries.find((entry) => entry.kind === 'background_group')!;
    expect(groupEntry(createGroup({ status: 'running' })).state).toBe('working');
    expect(groupEntry(createGroup({ status: 'completed' })).state).toBe('completed');
    expect(
      groupEntry(
        createGroup({
          status: 'completed',
          results: [
            {
              taskId: 'agent_1',
              label: 'Review',
              status: 'failed',
              error: { category: 'runner', message: 'x', recoverable: false },
            },
          ],
        }),
      ).state,
    ).toBe('failed');
  });
});

describe('SCREEN-1992 headline is one bounded line', () => {
  const mainThread = {
    sessionId: 'session_parent',
    isExecuting: false,
    hasPendingPrompt: false,
    historyLength: 1,
    updatedAt: '2026-05-09T00:00:00.000Z',
  };

  it('collapses newlines and cuts a long result exactly like the preview, so the two compare equal', () => {
    const output = `[stdout] line one\n[stdout] ${'x'.repeat(200)}\n[system] done`;
    const entry = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread,
      groups: [],
      tasks: [
        createTask({
          status: 'completed',
          result: { taskId: 'agent_1', kind: 'agent', output },
        }),
      ],
    }).entries.find((candidate) => candidate.kind === 'background_task')!;
    expect(entry.headline?.text).not.toContain('\n');
    expect(entry.headline?.text.length).toBeLessThanOrEqual(123);
    expect(entry.headline?.text).toBe(entry.preview);
  });

  it('falls back to the task count when no group result carries a summary', () => {
    const entry = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread,
      groups: [
        createGroup({
          status: 'running',
          results: [
            { taskId: 'agent_1', label: 'Review', status: 'completed' },
            { taskId: 'agent_2', label: 'Audit', status: 'completed' },
          ],
          taskIds: ['agent_1', 'agent_2', 'agent_3'],
        }),
      ],
      tasks: [],
    }).entries.find((candidate) => candidate.kind === 'background_group')!;
    expect(entry.headline).toEqual({ kind: 'activity', text: '2/3 tasks' });
  });
});
