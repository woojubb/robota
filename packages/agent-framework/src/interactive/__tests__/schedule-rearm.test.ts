import { describe, expect, it } from 'vitest';

import { restoredScheduleDisposition } from '../schedule-rearm.js';

import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

const NOW = Date.parse('2026-10-19T00:00:00.000Z');
const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

function task(overrides: Partial<IBackgroundTaskState<'scheduled'>> = {}): IBackgroundTaskState {
  return {
    id: 'task-1',
    kind: 'scheduled',
    label: 'check the build',
    status: 'sleeping',
    mode: 'background',
    parentSessionId: 'parent-1',
    depth: 0,
    cwd: '/workspace',
    startedAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    unread: false,
    schedule: { cronExpression: '*/10 * * * *', agentInstruction: 'check the build' },
    ...overrides,
  };
}

const liveLoop = { sessionLoop: true, sessionLoopExpiresAt: FUTURE };

describe('restoredScheduleDisposition', () => {
  it('re-arms a sleeping schedule, whether a session loop or a plain wake', () => {
    expect(restoredScheduleDisposition(task(), NOW, false)).toBe('rearm');
    expect(restoredScheduleDisposition(task({ metadata: liveLoop }), NOW, false)).toBe('rearm');
  });

  it('re-arms a paused schedule only to pause it again', () => {
    expect(restoredScheduleDisposition(task({ status: 'paused' }), NOW, false)).toBe(
      'rearm-paused',
    );
  });

  it('holds back a session loop that expired or that the host disabled, never a plain wake', () => {
    const expired = { sessionLoop: true, sessionLoopExpiresAt: PAST };
    expect(restoredScheduleDisposition(task({ metadata: expired }), NOW, false)).toBe('expired');
    expect(restoredScheduleDisposition(task({ metadata: liveLoop }), NOW, true)).toBe('disabled');
    expect(restoredScheduleDisposition(task(), NOW, true)).toBe('rearm');
  });

  it('ignores what restore does not re-arm from a schedule', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(restoredScheduleDisposition(task({ status }), NOW, false)).toBe('ignore');
    }
    expect(restoredScheduleDisposition(task({ schedule: undefined }), NOW, false)).toBe('ignore');
    expect(
      restoredScheduleDisposition(
        task({ metadata: { ...liveLoop, sessionLoopSelfPaced: true } }),
        NOW,
        false,
      ),
    ).toBe('ignore');
    expect(
      restoredScheduleDisposition(
        { ...task(), kind: 'process', status: 'running' } as IBackgroundTaskState,
        NOW,
        false,
      ),
    ).toBe('ignore');
  });
});
