import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { InteractiveSession } from '../interactive-session.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import { createSessionStub } from './helpers/session-stub.js';

function setup(
  save: (record: { backgroundTasks?: Array<{ metadata?: Record<string, unknown> }> }) => void,
) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      task.emit?.({ type: 'background_task_sleeping', nextFireAt: '2999-01-01T00:00:00.000Z' });
      return { taskId: task.taskId, result: new Promise<never>(() => {}), cancel };
    },
  };
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const session = createSessionStub({ getSessionId: () => 'loop_durable' });
  storeAgentToolDeps(session, { backgroundTaskManager: manager } as unknown as IAgentToolDeps);
  const store = {
    load: vi.fn(() => ({ status: 'missing' as const })),
    save: vi.fn(save),
    list: vi.fn(() => []),
    delete: vi.fn(),
  };
  const interactive = new InteractiveSession({
    session,
    sessionStore: store as never,
    cwd: '/workspace',
  });
  return { interactive, manager, store, cancel };
}

const loop = {
  label: 'Loop: check',
  cronExpression: '0 0 * * *',
  agentInstruction: 'check',
  sessionLoop: true,
  sessionLoopId: 'loop_stable',
};

describe('session-loop creation durability', () => {
  it('does not acknowledge a loop when its session record cannot be saved', async () => {
    const { interactive, manager, cancel } = setup(() => {
      throw new Error('disk full');
    });

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('disk full');
    expect(manager.list().filter((task) => task.status === 'sleeping')).toHaveLength(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a loop when the existing record is unreadable instead of overwriting it', async () => {
    const { interactive, manager, store, cancel } = setup(() => undefined);
    store.save.mockClear();
    store.load.mockImplementation(() => ({ status: 'corrupt' }) as never);

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('corrupt');
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.list().filter((task) => task.status === 'sleeping')).toHaveLength(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a loop only after a record containing its stable identity is saved', async () => {
    const saved: Array<{ backgroundTasks?: Array<{ metadata?: Record<string, unknown> }> }> = [];
    const { interactive } = setup((record) => saved.push(record));

    const task = await interactive.spawnScheduledWake(loop);
    expect(task.metadata?.['sessionLoopId']).toBe('loop_stable');
    expect(
      saved
        .at(-1)
        ?.backgroundTasks?.some((item) => item.metadata?.['sessionLoopId'] === 'loop_stable'),
    ).toBe(true);
  });
});
