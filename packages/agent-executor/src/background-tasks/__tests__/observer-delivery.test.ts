import { setGlobalLoggerSink, type ILogger } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-task-manager.js';
import {
  OBSERVER_FAILURE_WARNING_CODE,
  deliverToObservers,
  reportObserverFailureAsLogWarning,
  type IObserverFailure,
} from '../observer-delivery.js';
import { reportObserverFailureAsProcessWarning } from '../process-warning-reporter.js';

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

/** Installs a process-wide sink that records every `warn` call, and returns what it recorded. */
function captureLoggedWarnings(): Array<{ message: string; context: { code?: string } }> {
  const warnings: Array<{ message: string; context: { code?: string } }> = [];
  const sink: ILogger = {
    debug: () => undefined,
    info: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: (message, context) =>
      warnings.push({ message: String(message), context: (context ?? {}) as { code?: string } }),
  };
  setGlobalLoggerSink(sink);
  return warnings;
}

afterEach(() => setGlobalLoggerSink(undefined));

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

  it('default reporter logs a coded warning through the logger instead of throwing', () => {
    const warnings = captureLoggedWarnings();
    reportObserverFailureAsLogWarning({
      event: { type: 'background_task_created' },
      error: new Error('boom'),
      observerIndex: 0,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('background_task_created');
    expect(warnings[0]?.message).toContain('boom');
    expect(OBSERVER_FAILURE_WARNING_CODE).toBe('BACKGROUND_OBSERVER_FAILURE');
    expect(warnings[0]?.context).toEqual({ code: 'BACKGROUND_OBSERVER_FAILURE' });
  });

  it('the Node reporter emits a coded process warning instead of throwing', () => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      reportObserverFailureAsProcessWarning({
        event: { type: 'background_task_created' },
        error: new Error('boom'),
        observerIndex: 0,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain('background_task_created');
      expect(spy.mock.calls[0]?.[1]).toEqual({ code: 'BACKGROUND_OBSERVER_FAILURE' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('BackgroundTaskManager observer isolation (ARCH-053)', () => {
  it('logs with the host warning code when no custom failure reporter is supplied', async () => {
    const warnings = captureLoggedWarnings();
    const manager = new BackgroundTaskManager({
      runners: [createResolvedRunner()],
      observerFailureWarningCode: 'ACME_BACKGROUND_OBSERVER_FAILURE',
    });
    manager.subscribe(() => {
      throw new Error('broken');
    });
    const state = await manager.spawn(request);
    await manager.wait(state.id);
    expect(warnings.length).toBeGreaterThan(0);
    expect(
      warnings.every((warning) => warning.context.code === 'ACME_BACKGROUND_OBSERVER_FAILURE'),
    ).toBe(true);
  });

  it('reaches the process when the host injects the Node reporter', async () => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const manager = new BackgroundTaskManager({
        runners: [createResolvedRunner()],
        onObserverFailure: (failure) =>
          reportObserverFailureAsProcessWarning(failure, 'ACME_BACKGROUND_OBSERVER_FAILURE'),
      });
      manager.subscribe(() => {
        throw new Error('broken');
      });
      const state = await manager.spawn(request);
      await manager.wait(state.id);
      expect(spy).toHaveBeenCalled();
      expect(
        spy.mock.calls.every(
          (call) => (call[1] as { code?: string }).code === 'ACME_BACKGROUND_OBSERVER_FAILURE',
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps an explicit reporter ahead of the host warning code', async () => {
    const warnings = captureLoggedWarnings();
    const failures: IObserverFailure<TBackgroundTaskEvent>[] = [];
    const manager = new BackgroundTaskManager({
      runners: [createResolvedRunner()],
      observerFailureWarningCode: 'ACME_BACKGROUND_OBSERVER_FAILURE',
      onObserverFailure: (failure) => failures.push(failure),
    });
    manager.subscribe(() => {
      throw new Error('broken');
    });
    const state = await manager.spawn(request);
    await manager.wait(state.id);
    expect(failures).toHaveLength(3);
    expect(warnings).toHaveLength(0);
  });

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
