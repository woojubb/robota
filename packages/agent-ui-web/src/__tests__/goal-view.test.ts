/**
 * #3282 §4 part b-3 — the goal row's status in plain words, never the raw `status`/`stopReason`.
 */
import { describe, expect, it } from 'vitest';

import { describeGoalStatus } from '../goal-view.js';

import type { IGoalState } from '@robota-sdk/agent-interface-session';

function goal(overrides: Partial<IGoalState> = {}): IGoalState {
  return {
    id: 'goal_1',
    objective: 'Land the release notes',
    status: 'active',
    iterations: 1,
    maxIterations: 25,
    startedAt: '2026-05-01T00:00:00.000Z',
    progress: [],
    ...overrides,
  };
}

describe('describeGoalStatus', () => {
  it('active reads "Active"', () => {
    expect(describeGoalStatus(goal({ status: 'active' }))).toBe('Active');
  });

  it('satisfied reads "Satisfied"', () => {
    expect(describeGoalStatus(goal({ status: 'satisfied' }))).toBe('Satisfied');
  });

  it.each([
    ['max-iterations', 'Stopped — reached the iteration limit'],
    ['cancelled', 'Cancelled'],
    ['no-progress', 'Stopped — no progress'],
  ] as const)('stopped with reason %s reads %j', (stopReason, expected) => {
    expect(describeGoalStatus(goal({ status: 'stopped', stopReason }))).toBe(expected);
  });

  it('stopped with no reason still reads a plain word, not undefined', () => {
    expect(describeGoalStatus(goal({ status: 'stopped' }))).toBe('Stopped');
  });
});
