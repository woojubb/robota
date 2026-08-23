/**
 * FLOW-002 (Layer 2): a background wake event re-enters the agent loop as a non-user turn.
 * A scheduled task carrying an `agentInstruction` fires `background_task_waking`; the session
 * injects an `agent-wakeup` turn via the execution controller's pending queue, coalescing
 * duplicate wakes by task id.
 */

import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type { SessionExecutionController } from '../interactive-session-execution-controller.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { Session } from '@robota-sdk/agent-session';
import type { IScheduledBackgroundTaskRequest } from '@robota-sdk/agent-interface-execution';
import { createSessionStub as createSharedSessionStub } from './helpers/session-stub.js';

function createSessionStub(): Session {
  // Through the shared helper, with the two members this file's cases actually need: a session id
  // the wake requests name, and an event service the tracker subscribes to. The local copy differed
  // from the helper by exactly those two and by a `shutdown` stub that returned a TURN HANDLE, which
  // `Session.shutdown` does not — the disagreement the helper exists to stop. Review pointed out
  // that leaving this file behind made the helper a fourth copy rather than one fewer, which is the
  // sentence in its own docstring.
  return createSharedSessionStub({
    getSessionId: () => 'session_parent',
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  } as unknown as Partial<Session>);
}

interface IFakeScheduled {
  runner: IBackgroundTaskRunner;
  started: Array<{ taskId: string; emit?: IBackgroundTaskStart['emit'] }>;
}

function createFakeScheduledRunner(): IFakeScheduled {
  const started: IFakeScheduled['started'] = [];
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      started.push({ taskId: task.taskId, emit: task.emit });
      return {
        taskId: task.taskId,
        result: new Promise<never>(() => {}),
        cancel: () => Promise.resolve(),
      };
    },
  };
  return { runner, started };
}

function scheduledWakeRequest(agentInstruction: string): IScheduledBackgroundTaskRequest {
  return {
    kind: 'scheduled',
    cronExpression: '0 0 * * *',
    agentInstruction,
    label: 'wake',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
  };
}

function fire(
  emit: IBackgroundTaskStart['emit'],
  event: Parameters<NonNullable<IBackgroundTaskStart['emit']>>[0],
): void {
  emit?.({ type: 'background_task_sleeping', nextFireAt: '2030-01-01T00:00:00.000Z' });
  emit?.(event);
}

function getExecCtrl(session: InteractiveSession): SessionExecutionController {
  return (session as unknown as { execCtrl: SessionExecutionController }).execCtrl;
}

function holdExecution(execCtrl: SessionExecutionController): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void execCtrl.executeForegroundCommand(
    async () => {
      await held;
      return { success: true, message: 'released' };
    },
    () => Promise.resolve(),
  );
  return release;
}

async function setupSession(): Promise<{
  session: InteractiveSession;
  manager: BackgroundTaskManager;
  started: IFakeScheduled['started'];
}> {
  const { runner, started } = createFakeScheduledRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const sessionStub = createSessionStub();
  storeAgentToolDeps(sessionStub, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const session = new InteractiveSession({ session: sessionStub });
  // Touch a background API so the tracker subscribes to the manager.
  session.listBackgroundTasks();
  await Promise.resolve();
  return { session, manager, started };
}

describe('FLOW-002 session wake injection', () => {
  it('TC-01/TC-04: a wake injects one agent-wakeup turn carrying the instruction', async () => {
    const { session, manager, started } = await setupSession();
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);

    const created = await manager.spawn(scheduledWakeRequest('check the build'));
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'check the build' });
    await Promise.resolve();

    expect(execCtrl.pending.contents).toHaveLength(1);
    expect(execCtrl.pending.contents[0]).toMatchObject({
      input: 'check the build',
      turnId: expect.any(String),
      options: {
        turnSource: 'agent-wakeup',
        wakeTaskId: created.id,
      },
    });
  });

  it('TC-03: duplicate wakes for the same task id coalesce to a single turn', async () => {
    const { session, manager, started } = await setupSession();
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);

    await manager.spawn(scheduledWakeRequest('do X'));
    await Promise.resolve();
    // Two real fire cycles (sleeping → waking) for the same task while the first wake is
    // still in flight (the first wake is queued, so its task id remains claimed).
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'do X' });
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'do X' });
    await Promise.resolve();

    expect(execCtrl.pending.contents).toHaveLength(1);
    expect(execCtrl.pendingPrompt).toBe('do X');
  });

  it('TC-02: while a turn is executing, the wake queues (not interleaved)', async () => {
    const { session, manager, started } = await setupSession();
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl); // simulate an in-flight turn

    await manager.spawn(scheduledWakeRequest('queued instruction'));
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'queued instruction' });
    await Promise.resolve();

    expect(execCtrl.pendingPrompt).toBe('queued instruction');
    // REMOTE-014 E5: the queue entry preserves the wake's turn options (agent-wakeup source).
    expect(execCtrl.pending.contents[0]?.options.turnSource).toBe('agent-wakeup');
  });

  it('RUNTIME-19: aborting a queued wake evicts its id so a future wake is not locked out', async () => {
    const { session, manager, started } = await setupSession();
    const execCtrl = getExecCtrl(session);
    const releaseExecution = holdExecution(execCtrl); // a turn is in flight, so the wake queues instead of running

    const created = await manager.spawn(scheduledWakeRequest('follow up'));
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'follow up' });
    await Promise.resolve();

    // The wake is queued and its id tracked.
    expect(execCtrl.pendingPrompt).toBe('follow up');
    expect(execCtrl.wakeTaskIds.has(created.id)).toBe(true);

    // Abort drops the queued wake — its id MUST be evicted, or every future wake for this task
    // is silently rejected forever (RUNTIME-19).
    session.abort();
    expect(execCtrl.wakeTaskIds.has(created.id)).toBe(false);

    // A brand-new wake for the same task id is now accepted (not locked out).
    releaseExecution();
    await Promise.resolve();
    expect(session.requestWakeup('later', created.id)).toBe(true);
  });
});
