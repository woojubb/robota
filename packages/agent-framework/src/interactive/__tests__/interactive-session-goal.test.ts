/**
 * GOAL-001: InteractiveSession goal wiring. Verifies that setGoal seeds state, emits the
 * lifecycle event, and schedules the first goal-driven turn through the FLOW-002 wakeup
 * primitive, and that cancelGoal stops it. The loop-advancement decision logic is unit-tested
 * in goal/__tests__/goal-controller.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IGoalEvent } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_goal',
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
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  } as unknown as Session;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('InteractiveSession goal wiring (GOAL-001)', () => {
  it('setGoal seeds an active goal, emits goal_started, and schedules the first agent-wakeup turn', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    const submitSpy = vi.spyOn(session, 'submit').mockResolvedValue(undefined);
    const events: IGoalEvent[] = [];
    session.on('goal_event', (event) => events.push(event));

    const goal = await session.setGoal('write a file', { maxIterations: 5 });

    expect(goal.status).toBe('active');
    expect(goal.objective).toBe('write a file');
    expect(session.getGoalState()?.status).toBe('active');
    expect(events[0]?.type).toBe('goal_started');

    await tick(); // let the scheduled wakeup fire
    expect(submitSpy).toHaveBeenCalledTimes(1);
    const [prompt, , , options] = submitSpy.mock.calls[0]!;
    expect(prompt).toContain('write a file');
    expect(options).toMatchObject({ turnSource: 'agent-wakeup' });
  });

  it('cancelGoal stops an active goal and emits goal_stopped', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    vi.spyOn(session, 'submit').mockResolvedValue(undefined);
    const events: IGoalEvent[] = [];
    session.on('goal_event', (event) => events.push(event));

    await session.setGoal('do work');
    const stopped = session.cancelGoal();

    expect(stopped).toMatchObject({ status: 'stopped', stopReason: 'cancelled' });
    expect(session.getGoalState()?.status).toBe('stopped');
    expect(events.some((e) => e.type === 'goal_stopped')).toBe(true);
    expect(session.cancelGoal()).toBeNull();
  });

  it('setGoal rejects an empty objective', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    await expect(session.setGoal('   ')).rejects.toThrow(/non-empty/);
  });
});
