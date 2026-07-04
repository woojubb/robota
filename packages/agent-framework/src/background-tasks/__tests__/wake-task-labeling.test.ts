/**
 * FLOW-006 (Layer 6): the execution-workspace projection labels an agent-wake schedule
 * distinctly from a shell-only schedule — a `↻ wake` marker + truncated instruction preview
 * beside the existing `next: Xm` — so the TUI row visibly distinguishes them.
 */

import { describe, expect, it } from 'vitest';

import { createExecutionWorkspaceSnapshot } from '../index.js';

import type { IExecutionWorkspaceEntry } from '../index.js';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-transport';

function scheduledTask(overrides: Partial<IBackgroundTaskState>): IBackgroundTaskState {
  return {
    id: 'sched_1',
    kind: 'scheduled',
    label: 'wake',
    status: 'sleeping',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 0,
    cwd: '/workspace',
    updatedAt: '2026-06-13T00:00:00.000Z',
    unread: false,
    nextFireAt: '2999-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function backgroundEntry(task: IBackgroundTaskState): IExecutionWorkspaceEntry | undefined {
  const snapshot = createExecutionWorkspaceSnapshot({
    sessionId: 'session_parent',
    mainThread: {
      sessionId: 'session_parent',
      isExecuting: false,
      hasPendingPrompt: false,
      historyLength: 0,
      updatedAt: '2026-06-13T00:00:00.000Z',
    },
    groups: [],
    tasks: [task],
  });
  return snapshot.entries.find((e) => e.kind === 'background_task');
}

describe('FLOW-006 agent-wake task labeling', () => {
  it('TC-01: an agent-wake schedule shows a wake marker + instruction preview', () => {
    const entry = backgroundEntry(
      scheduledTask({
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'summarize logs' },
      }),
    );
    expect(entry?.subtitle).toContain('↻ wake');
    expect(entry?.subtitle).toContain('summarize logs');
    expect(entry?.subtitle).toContain('next:');
  });

  it('TC-02: a shell-only schedule shows next: … without the wake marker', () => {
    const entry = backgroundEntry(
      scheduledTask({ schedule: { cronExpression: '0 0 * * *', command: 'backup.sh' } }),
    );
    expect(entry?.subtitle).toContain('next:');
    expect(entry?.subtitle).not.toContain('↻ wake');
  });

  it('TC-03: a long instruction preview is truncated', () => {
    const long =
      'do a very long thing that exceeds the inline preview budget by quite a lot indeed';
    const entry = backgroundEntry(
      scheduledTask({ schedule: { cronExpression: '0 0 * * *', agentInstruction: long } }),
    );
    expect(entry?.subtitle).toContain('…');
    expect(entry?.subtitle?.length ?? 0).toBeLessThan(long.length + 20);
  });
});
