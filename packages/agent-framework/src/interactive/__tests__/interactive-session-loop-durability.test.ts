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
  save: (record: { backgroundTasks?: Array<{ status?: string; metadata?: Record<string, unknown> }> }) => void,
  maxConcurrent?: number,
) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const runner: IBackgroundTaskRunner = {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      task.emit?.({ type: 'background_task_sleeping', nextFireAt: '2999-01-01T00:00:00.000Z' });
      return { taskId: task.taskId, result: new Promise<never>(() => {}), cancel };
    },
  };
  const manager = new BackgroundTaskManager({ runners: [runner], maxConcurrent });
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

  it('does not leave a previously saved loop active after a later write fails', async () => {
    const durable: Array<{
      backgroundTasks?: Array<{ status?: string; metadata?: Record<string, unknown> }>;
    }> = [];
    let writes = 0;
    const { interactive } = setup((record) => {
      writes += 1;
      if (writes >= 4) throw new Error('store disconnected');
      durable.push(record);
    });
    writes = 0; // Ignore the session's initial empty snapshot.

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('store disconnected');
    expect(
      durable.at(-1)?.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_stable'),
    ).not.toBe(true);
  });

  it('does not publish a concurrent loop that has not passed its own strict write', async () => {
    const durable: Array<{
      backgroundTasks?: Array<{ metadata?: Record<string, unknown> }>;
    }> = [];
    let unavailable = false;
    const { interactive } = setup((record) => {
      if (unavailable || record.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_b')) {
        unavailable = true;
        throw new Error('store disconnected');
      }
      durable.push(record);
    });

    const first = interactive.spawnScheduledWake({ ...loop, sessionLoopId: 'loop_a' });
    const second = interactive.spawnScheduledWake({ ...loop, sessionLoopId: 'loop_b' });
    await expect(first).resolves.toMatchObject({ metadata: { sessionLoopId: 'loop_a' } });
    await expect(second).rejects.toThrow('store disconnected');
    expect(durable.at(-1)?.backgroundTasks?.map((task) => task.metadata?.['sessionLoopId'])).toContain('loop_a');
    expect(durable.at(-1)?.backgroundTasks?.some((task) => task.metadata?.['sessionLoopId'] === 'loop_b')).not.toBe(true);
  });

  it('refuses a queued loop that could not be re-armed after restart', async () => {
    const { interactive, manager } = setup(() => undefined, 0);

    await expect(interactive.spawnScheduledWake(loop)).rejects.toThrow('resumable timer');
    expect(manager.list()).toMatchObject([{ status: 'cancelled' }]);
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
