import { describe, it, expect, vi } from 'vitest';

import { executeGoalCommand } from '../goal-command.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { IGoalState } from '@robota-sdk/agent-interface-transport';

function goal(overrides: Partial<IGoalState> = {}): IGoalState {
  return {
    id: 'g1',
    objective: 'write a file',
    status: 'active',
    iterations: 1,
    maxIterations: 25,
    startedAt: '2026-06-27T00:00:00.000Z',
    progress: [{ iteration: 1, signal: 'continue', reason: 'started' }],
    ...overrides,
  };
}

function host(overrides: Partial<ICommandHostContext> = {}): ICommandHostContext {
  return overrides as unknown as ICommandHostContext;
}

describe('executeGoalCommand', () => {
  it('assigns a goal from the objective text', async () => {
    const setGoal = vi.fn().mockResolvedValue(goal());
    const result = await executeGoalCommand(host({ setGoal }), 'write a file');
    expect(setGoal).toHaveBeenCalledWith('write a file');
    expect(result.success).toBe(true);
    expect(result.message).toContain('pursuing autonomously');
    expect(result.data).toMatchObject({ goalId: 'g1' });
  });

  it('shows status when given "status"', async () => {
    const result = await executeGoalCommand(host({ getGoalState: () => goal() }), 'status');
    expect(result.success).toBe(true);
    expect(result.message).toContain('write a file');
    expect(result.message).toContain('Iterations: 1 / 25');
  });

  it('reports no goal when status is requested with none set', async () => {
    const result = await executeGoalCommand(host({ getGoalState: () => null }), 'status');
    expect(result.message).toBe('No goal is set.');
  });

  it('cancels an active goal', async () => {
    const cancelGoal = vi
      .fn()
      .mockReturnValue(goal({ status: 'stopped', stopReason: 'cancelled' }));
    const result = await executeGoalCommand(host({ cancelGoal }), 'cancel');
    expect(cancelGoal).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain('Goal cancelled');
  });

  it('reports failure when cancelling with no active goal', async () => {
    const result = await executeGoalCommand(host({ cancelGoal: () => null }), 'stop');
    expect(result.success).toBe(false);
  });

  it('shows usage on an empty argument', async () => {
    const result = await executeGoalCommand(host({}), '');
    expect(result.message).toContain('Usage');
  });

  it('surfaces an invalid-objective error as a failed result (not a crash)', async () => {
    const setGoal = vi
      .fn()
      .mockRejectedValue(new Error('A goal objective must be a non-empty string.'));
    const result = await executeGoalCommand(host({ setGoal }), 'x');
    expect(result.success).toBe(false);
    expect(result.message).toContain('non-empty');
  });
});
