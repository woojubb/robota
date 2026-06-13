/**
 * FLOW-002 (Layer 2): a background wake event re-enters the agent loop as a non-user turn.
 * A scheduled task carrying an `agentInstruction` fires `background_task_waking`; the session
 * injects an `agent-wakeup` turn via the execution controller's pending queue, coalescing
 * duplicate wakes by task id.
 */

import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IScheduledBackgroundTaskRequest,
} from '@robota-sdk/agent-executor';
import type { SessionExecutionController } from '../interactive-session-execution-controller.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { Session } from '@robota-sdk/agent-session';

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_parent',
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
    const submitSpy = vi.spyOn(session, 'submit').mockResolvedValue(undefined);

    const created = await manager.spawn(scheduledWakeRequest('check the build'));
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'check the build' });

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith('check the build', undefined, undefined, {
      turnSource: 'agent-wakeup',
      wakeTaskId: created.id,
    });
  });

  it('TC-03: duplicate wakes for the same task id coalesce to a single turn', async () => {
    const { session, manager, started } = await setupSession();
    const submitSpy = vi.spyOn(session, 'submit').mockResolvedValue(undefined);

    await manager.spawn(scheduledWakeRequest('do X'));
    await Promise.resolve();
    // Two real fire cycles (sleeping → waking) for the same task while the first wake is
    // still in flight (submit is mocked, so the turn never completes to clear the wake id).
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'do X' });
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'do X' });

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('TC-02: while a turn is executing, the wake queues (not interleaved)', async () => {
    const { session, manager, started } = await setupSession();
    const execCtrl = getExecCtrl(session);
    execCtrl.executing = true; // simulate an in-flight turn

    await manager.spawn(scheduledWakeRequest('queued instruction'));
    await Promise.resolve();
    fire(started[0]?.emit, { type: 'background_task_waking', instruction: 'queued instruction' });
    await Promise.resolve();

    expect(execCtrl.pendingPrompt).toBe('queued instruction');
    expect(execCtrl.pendingTurnOptions.turnSource).toBe('agent-wakeup');
  });
});
