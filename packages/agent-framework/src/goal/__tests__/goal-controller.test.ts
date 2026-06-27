import { describe, it, expect } from 'vitest';

import {
  GoalController,
  extractGoalSignal,
  DEFAULT_GOAL_MAX_ITERATIONS,
  GOAL_SIGNAL_TOOL_NAME,
} from '../index.js';

import type {
  IExecutionResult,
  IToolSummary,
  IGoalState,
} from '@robota-sdk/agent-interface-transport';

const deps = { now: () => '2026-06-27T00:00:00.000Z', createId: () => 'goal_test' };

function turn(toolSummaries: IToolSummary[]): IExecutionResult {
  return {
    response: '',
    history: [],
    toolSummaries,
    contextState: {
      maxTokens: 0,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 0,
    },
  };
}

function signal(status: 'continue' | 'satisfied', reason = ''): IToolSummary {
  return { name: GOAL_SIGNAL_TOOL_NAME, args: JSON.stringify({ status, reason }) };
}

const work: IToolSummary = { name: 'Write', args: '{}' };

describe('extractGoalSignal', () => {
  it('reads the last report_goal_status call', () => {
    expect(extractGoalSignal([signal('continue', 'a'), work, signal('satisfied', 'done')])).toEqual(
      { status: 'satisfied', reason: 'done' },
    );
  });

  it('returns null when no signal tool was called', () => {
    expect(extractGoalSignal([work])).toBeNull();
  });

  it('returns null for malformed args (no fragile fallback to prose)', () => {
    expect(extractGoalSignal([{ name: GOAL_SIGNAL_TOOL_NAME, args: 'not json' }])).toBeNull();
  });
});

describe('GoalController.start', () => {
  it('seeds an active goal and returns a prompt mentioning the objective', () => {
    const c = new GoalController(deps);
    const { goal, prompt } = c.start('build a thing', { maxIterations: 5 });
    expect(goal.status).toBe('active');
    expect(goal.objective).toBe('build a thing');
    expect(goal.maxIterations).toBe(5);
    expect(prompt).toContain('build a thing');
    expect(c.isActive()).toBe(true);
  });

  it('defaults maxIterations when not provided', () => {
    const c = new GoalController(deps);
    expect(c.start('x').goal.maxIterations).toBe(DEFAULT_GOAL_MAX_ITERATIONS);
  });

  it('throws on an empty objective', () => {
    const c = new GoalController(deps);
    expect(() => c.start('   ')).toThrow(/non-empty/);
  });
});

describe('GoalController.onTurnComplete', () => {
  it('stops when the agent signals satisfied', () => {
    const c = new GoalController(deps);
    c.start('goal', { maxIterations: 10 });
    const decision = c.onTurnComplete(turn([work, signal('satisfied', 'all done')]));
    expect(decision).toEqual({
      action: 'stop',
      reason: 'satisfied',
      goal: expect.objectContaining({ status: 'satisfied', stopReason: 'satisfied' }),
    });
  });

  it('continues with a continuation prompt while work is happening and signal is continue', () => {
    const c = new GoalController(deps);
    c.start('goal', { maxIterations: 10 });
    const decision = c.onTurnComplete(turn([work, signal('continue', 'more to do')]));
    expect(decision?.action).toBe('continue');
    if (decision?.action === 'continue') {
      expect(decision.prompt).toContain('goal');
      expect(decision.goal.iterations).toBe(1);
    }
  });

  it('stops at max-iterations (turn budget)', () => {
    const c = new GoalController(deps);
    c.start('goal', { maxIterations: 2, noProgressLimit: 99 });
    expect(c.onTurnComplete(turn([work, signal('continue')]))?.action).toBe('continue');
    const second = c.onTurnComplete(turn([work, signal('continue')]));
    expect(second).toMatchObject({ action: 'stop', reason: 'max-iterations' });
  });

  it('stops on no-progress after consecutive idle turns (convergence guard)', () => {
    const c = new GoalController(deps);
    c.start('goal', { maxIterations: 99, noProgressLimit: 2 });
    // idle turn 1: no work, no satisfied → continue
    expect(c.onTurnComplete(turn([]))?.action).toBe('continue');
    // idle turn 2: still no work → stop no-progress
    expect(c.onTurnComplete(turn([]))).toMatchObject({ action: 'stop', reason: 'no-progress' });
  });

  it('resets the idle counter when the agent does work', () => {
    const c = new GoalController(deps);
    c.start('goal', { maxIterations: 99, noProgressLimit: 2 });
    expect(c.onTurnComplete(turn([]))?.action).toBe('continue'); // idle 1
    expect(c.onTurnComplete(turn([work]))?.action).toBe('continue'); // work → reset
    expect(c.onTurnComplete(turn([]))?.action).toBe('continue'); // idle 1 again
    expect(c.onTurnComplete(turn([]))).toMatchObject({ action: 'stop', reason: 'no-progress' }); // idle 2 → stop
  });

  it('returns null for turns when no goal is active', () => {
    const c = new GoalController(deps);
    expect(c.onTurnComplete(turn([work]))).toBeNull();
  });
});

describe('GoalController.cancel and restore', () => {
  it('cancel stops an active goal', () => {
    const c = new GoalController(deps);
    c.start('goal');
    const cancelled = c.cancel();
    expect(cancelled).toMatchObject({ status: 'stopped', stopReason: 'cancelled' });
    expect(c.isActive()).toBe(false);
    expect(c.cancel()).toBeNull();
  });

  it('restore resumes only an active goal', () => {
    const active: IGoalState = {
      id: 'g',
      objective: 'o',
      status: 'active',
      iterations: 3,
      maxIterations: 10,
      startedAt: deps.now(),
      progress: [],
    };
    const c = new GoalController(deps);
    c.restore(active);
    expect(c.isActive()).toBe(true);
    expect(c.onTurnComplete(turn([work, signal('satisfied')]))).toMatchObject({
      action: 'stop',
      reason: 'satisfied',
    });

    const done: IGoalState = { ...active, status: 'satisfied' };
    const c2 = new GoalController(deps);
    c2.restore(done);
    expect(c2.isActive()).toBe(false);
  });
});
