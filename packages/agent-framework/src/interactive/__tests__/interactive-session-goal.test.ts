/**
 * GOAL-001: InteractiveSession goal wiring. Verifies that setGoal seeds state, emits the
 * lifecycle event, and schedules the first goal-driven turn through the FLOW-002 wakeup
 * primitive, and that cancelGoal stops it. The loop-advancement decision logic is unit-tested
 * in goal/__tests__/goal-controller.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IGoalEvent } from '@robota-sdk/agent-interface-session';
import type { ICommandResult } from '../../commands/index.js';
import { createSessionStub as createSharedSessionStub } from './helpers/session-stub.js';

import type { SessionExecutionController } from '../interactive-session-execution-controller.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function getExecCtrl(session: InteractiveSession): SessionExecutionController {
  return (session as unknown as { execCtrl: SessionExecutionController }).execCtrl;
}

function holdExecution(execCtrl: SessionExecutionController): void {
  void execCtrl.executeForegroundCommand(
    () => new Promise<ICommandResult>(() => {}),
    () => Promise.resolve(),
  );
}

describe('InteractiveSession goal wiring (GOAL-001)', () => {
  it('setGoal seeds an active goal, emits goal_started, and schedules the first agent-wakeup turn', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);
    const events: IGoalEvent[] = [];
    session.on('goal_event', (event) => events.push(event));

    const goal = await session.setGoal('write a file', { maxIterations: 5 });

    expect(goal.status).toBe('active');
    expect(goal.objective).toBe('write a file');
    expect(session.getGoalState()?.status).toBe('active');
    expect(events[0]?.type).toBe('goal_started');

    await tick(); // let the scheduled wakeup fire
    expect(execCtrl.pending.contents).toHaveLength(1);
    expect(execCtrl.pending.contents[0]?.input).toContain('write a file');
    expect(execCtrl.pending.contents[0]?.options).toMatchObject({ turnSource: 'agent-wakeup' });
  });

  it('cancelGoal stops an active goal and emits goal_stopped', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    holdExecution(getExecCtrl(session));
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
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    await expect(session.setGoal('   ')).rejects.toThrow(/non-empty/);
  });
});
