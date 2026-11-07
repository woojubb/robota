/**
 * The jobs a switch of the session would stop (#3679 3f, live follow).
 *
 * Continuing a fork points the terminal at another session, and the session left behind is shut
 * down, which cancels every job of it that has not ended. A person is asked before that happens, and
 * the number they are told has to be the number that is cancelled: it is counted from the same
 * statuses the shutdown acts on, never from a list of its own.
 */
import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it } from 'vitest';

import { liveBackgroundJobCount } from '../execution-workspace-attach.js';
import { createExecutionWorkspaceSnapshot } from '../execution-workspace-projection.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type {
  IAgentBackgroundTaskState,
  IExecutionWorkspaceSnapshot,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface-execution';

const LIVE_STATUSES = ['queued', 'running', 'waiting_permission', 'sleeping', 'paused'] as const;
const ENDED_STATUSES = ['completed', 'failed', 'cancelled'] as const;

function task(id: string, status: TBackgroundTaskStatus): IAgentBackgroundTaskState {
  return {
    id,
    kind: 'agent',
    label: id,
    status,
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/work',
    updatedAt: '2026-11-01T00:00:01.000Z',
    unread: false,
    agentType: 'general-purpose',
  };
}

function snapshotOf(tasks: readonly IAgentBackgroundTaskState[]): IExecutionWorkspaceSnapshot {
  return createExecutionWorkspaceSnapshot({
    sessionId: 'session_parent',
    mainThread: {
      sessionId: 'session_parent',
      isExecuting: true,
      hasPendingPrompt: false,
      historyLength: 3,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    tasks: [...tasks],
    groups: [],
  });
}

function entryIdOf(snapshot: IExecutionWorkspaceSnapshot, taskId: string): string {
  const entry = snapshot.entries.find((candidate) => candidate.sourceId === taskId);
  if (entry === undefined) throw new Error(`no entry for ${taskId}`);
  return entry.id;
}

describe('the jobs a switch of the session would stop', () => {
  it.each(LIVE_STATUSES)('counts a %s job', (status) => {
    const snapshot = snapshotOf([task('other', status), task('forked', 'completed')]);

    expect(liveBackgroundJobCount(snapshot, entryIdOf(snapshot, 'forked'))).toBe(1);
  });

  it.each(ENDED_STATUSES)('does not count a %s job', (status) => {
    const snapshot = snapshotOf([task('other', status), task('forked', 'completed')]);

    expect(liveBackgroundJobCount(snapshot, entryIdOf(snapshot, 'forked'))).toBe(0);
  });

  it('does not count the job being continued, the main thread, or no snapshot at all', () => {
    const snapshot = snapshotOf([task('forked', 'running')]);

    expect(liveBackgroundJobCount(snapshot, entryIdOf(snapshot, 'forked'))).toBe(0);
    expect(liveBackgroundJobCount(null, 'task:forked')).toBe(0);
  });

  it('counts every other job that has not ended', () => {
    const snapshot = snapshotOf([
      task('a', 'running'),
      task('b', 'queued'),
      task('c', 'sleeping'),
      task('d', 'failed'),
      task('forked', 'completed'),
    ]);

    expect(liveBackgroundJobCount(snapshot, entryIdOf(snapshot, 'forked'))).toBe(3);
  });

  it('is what shutting the session’s manager down cancels', async () => {
    const releases: Array<() => void> = [];
    const runner: IBackgroundTaskRunner<'agent'> = {
      kind: 'agent',
      start(start: IBackgroundTaskStart<'agent'>): IBackgroundTaskHandle<'agent'> {
        const result = new Promise<{ taskId: string; kind: 'agent'; output: string }>((resolve) => {
          releases.push(() => resolve({ taskId: start.taskId, kind: 'agent', output: 'done' }));
        });
        return { taskId: start.taskId, result, cancel: () => Promise.resolve() };
      },
    };
    // Room for two at a time: the third waits in the queue, which a shutdown cancels as well.
    const manager = new BackgroundTaskManager({ runners: [runner], maxConcurrent: 2 });
    const request = (label: string) => ({
      kind: 'agent' as const,
      label,
      parentSessionId: 'session_parent',
      mode: 'background' as const,
      depth: 1,
      cwd: '/work',
      agentType: 'general-purpose',
      prompt: label,
      permissionPolicy: 'inherit-allowlist' as const,
    });
    const first = await manager.spawn(request('first'));
    await manager.spawn(request('second'));
    await manager.spawn(request('third'));
    // One job has ended already: the fork being continued.
    releases[0]?.();
    await manager.wait(first.id);

    const snapshot = snapshotOf(manager.list() as IAgentBackgroundTaskState[]);
    const counted = liveBackgroundJobCount(snapshot, entryIdOf(snapshot, first.id));
    const before = new Set(manager.list({ status: 'cancelled' }).map((state) => state.id));
    await manager.shutdown('switching');
    const cancelled = manager
      .list({ status: 'cancelled' })
      .filter((state) => !before.has(state.id));

    expect(counted).toBe(2);
    expect(cancelled).toHaveLength(counted);
  });
});
