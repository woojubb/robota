import { describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-task-manager.js';
import {
  OBSERVER_FAILURE_WARNING_CODE,
  deliverToObservers,
  reportObserverFailureAsWarning,
  type IObserverFailure,
} from '../observer-delivery.js';

import type { IBackgroundTaskRunner, TBackgroundTaskEvent } from '../types.js';

function createResolvedRunner(): IBackgroundTaskRunner {
  return {
    kind: 'agent',
    start: (task) => ({
      taskId: task.taskId,
      result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'ok' }),
      cancel: () => Promise.resolve(),
    }),
  };
}

const request = {
  kind: 'agent' as const,
  label: 'General purpose',
  parentSessionId: 'session_parent',
  mode: 'foreground' as const,
  depth: 1,
  cwd: '/workspace',
  agentType: 'general-purpose',
  prompt: 'hello',
  permissionPolicy: 'inherit-allowlist' as const,
};

describe('deliverToObservers (ARCH-053)', () => {
  it('isolates a throwing observer, keeps delivering, and reports each failure', () => {
    const seen: string[] = [];
    const failures: IObserverFailure<string>[] = [];
    const count = deliverToObservers(
      'evt',
      [
        () => seen.push('a'),
        () => {
          throw new Error('boom');
        },
        () => seen.push('c'),
      ],
      (failure) => failures.push(failure),
    );
    expect(count).toBe(1);
    expect(seen).toEqual(['a', 'c']);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.observerIndex).toBe(1);
    expect(failures[0]?.event).toBe('evt');
    expect((failures[0]?.error as Error).message).toBe('boom');
  });

  it('default reporter emits a coded process warning instead of throwing', () => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      reportObserverFailureAsWarning({
        event: { type: 'background_task_created' },
        error: new Error('boom'),
        observerIndex: 0,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain('background_task_created');
      expect(spy.mock.calls[0]?.[1]).toEqual({ code: OBSERVER_FAILURE_WARNING_CODE });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('BackgroundTaskManager observer isolation (ARCH-053)', () => {
  it('a throwing eventSink neither rejects admission nor stops listener delivery', async () => {
    const failures: IObserverFailure<TBackgroundTaskEvent>[] = [];
    const listenerEvents: string[] = [];
    const manager = new BackgroundTaskManager({
      runners: [createResolvedRunner()],
      eventSink: () => {
        throw new Error('sink is broken');
      },
      onObserverFailure: (failure) => failures.push(failure),
    });
    manager.subscribe((event) => listenerEvents.push(event.type));

    const state = await manager.spawn(request);
    await manager.wait(state.id);

    expect(manager.get(state.id)?.status).toBe('completed');
    expect(listenerEvents).toEqual([
      'background_task_created',
      'background_task_started',
      'background_task_completed',
    ]);
    expect(failures.map((failure) => failure.event.type)).toEqual(listenerEvents);
    expect(failures.every((failure) => failure.observerIndex === 0)).toBe(true);
  });

  it('a throwing listener does not hold the concurrency slot of a completed task', async () => {
    const manager = new BackgroundTaskManager({
      runners: [createResolvedRunner()],
      maxConcurrent: 1,
      onObserverFailure: () => undefined,
    });
    manager.subscribe((event) => {
      if (event.type === 'background_task_completed') throw new Error('listener is broken');
    });

    const first = await manager.spawn(request);
    await manager.wait(first.id);
    const second = await manager.spawn(request);
    await manager.wait(second.id);

    expect(manager.get(second.id)?.status).toBe('completed');
  });
});
