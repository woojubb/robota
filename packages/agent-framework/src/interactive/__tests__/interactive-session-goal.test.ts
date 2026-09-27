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

  it('#3201: a goal turn shows the objective and iteration, not the instruction to the model', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);

    await session.setGoal('write a file', { maxIterations: 5 });
    await tick();

    const turn = execCtrl.pending.contents[0];
    // The model still gets the full instruction …
    expect(turn?.input).toContain('report_goal_status');
    // … while every surface shows one short line.
    expect(turn?.displayInput).toBe('Goal: write a file (iteration 1 of 5)');
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

/**
 * #3280 §2: `/goal cancel` (or `stop`) is a CONTROL action — like abort or cancel-queue — so it must
 * work while a turn is running, exactly when a runaway goal needs stopping. Every other command keeps
 * the unchanged mid-turn refusal ("Another prompt or command is already running...").
 */
describe('InteractiveSession goal cancel as a mid-turn control action (#3280 §2)', () => {
  it('cancels the goal, aborts the turn, and drops the already-queued next iteration', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    const execCtrl = getExecCtrl(session);
    // Stands in for the goal's own turn currently running: the executeCommand gate below only ever
    // sees `execCtrl.executing`, not WHICH claim holds it.
    holdExecution(execCtrl);
    expect(execCtrl.executing).toBe(true);

    await session.setGoal('write a file', { maxIterations: 5 });
    await tick(); // the next iteration cannot run yet (the claim above holds it) — it queues instead
    expect(execCtrl.pending.contents).toHaveLength(1);

    const result = await session.executeCommand('goal', 'cancel');

    expect(result).toMatchObject({ success: true, message: 'Goal cancelled: write a file' });
    expect(session.getGoalState()?.status).toBe('stopped');
    expect(session.getGoalState()?.stopReason).toBe('cancelled');
    // No further iteration starts: the queued one was flushed by abort()'s whole-queue clear.
    expect(execCtrl.pending.contents).toHaveLength(0);
  });

  it('cancels via the "stop" spelling too', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);
    await session.setGoal('write a file');

    const result = await session.executeCommand('goal', 'stop');

    expect(result).toMatchObject({ success: true });
    expect(session.getGoalState()?.status).toBe('stopped');
  });

  it('a goal cancel with no active goal keeps the ordinary mid-turn refusal', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    holdExecution(getExecCtrl(session));

    const result = await session.executeCommand('goal', 'cancel');

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('Another prompt or command is already running'),
    });
  });

  it('an ordinary command is still refused while a turn runs', async () => {
    const session = new InteractiveSession({
      session: createSharedSessionStub({ getSessionId: () => 'session_goal' }),
    });
    const execCtrl = getExecCtrl(session);
    await session.setGoal('write a file');
    holdExecution(execCtrl);

    const result = await session.executeCommand('help', '');

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('Another prompt or command is already running'),
    });
  });
});
