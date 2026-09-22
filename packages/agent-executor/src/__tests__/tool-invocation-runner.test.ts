/**
 * MCP-004 §S1 — the `tool-invocation` runner, exercised through the real `BackgroundTaskManager`
 * (not a mock of it): TC-03 through TC-07, TC-20, and the unknown-token validation refusal.
 *
 * The wrapper that COMMITS to a handoff (`agent-framework`, a later seam) is not present here — each
 * test plays its role by calling `runner.adopt(token, work)` directly before `manager.spawn(...)`,
 * exactly the contract the runner declares.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackgroundTaskManager } from '../background-tasks/background-task-manager.js';
import { createToolInvocationBackgroundTaskRunner } from '../background-tasks/tool-invocation-runner.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IProcessBackgroundTaskRequest,
  IToolInvocationBackgroundTaskRequest,
  TBackgroundTaskEvent,
} from '../background-tasks/types.js';
import type { IToolResult } from '@robota-sdk/agent-core';

function createToolInvocationRequest(
  overrides: Partial<IToolInvocationBackgroundTaskRequest> = {},
): IToolInvocationBackgroundTaskRequest {
  return {
    kind: 'tool-invocation',
    label: 'crawl-site',
    mode: 'background',
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/work',
    toolName: 'crawl-site',
    adoptionToken: 'token-1',
    provenanceOwner: 'mcp',
    serverId: 'server-1',
    sourceName: 'crawl_site',
    permissionMode: 'inherit-allowlist',
    ...overrides,
  };
}

function createProcessRequest(): IProcessBackgroundTaskRequest {
  return {
    kind: 'process',
    label: 'a long-running process',
    mode: 'background',
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/work',
    command: 'sleep 999',
  };
}

/** A `process` runner that starts and never settles — used only to occupy a concurrency slot. */
function createNeverSettlingProcessRunner(): IBackgroundTaskRunner {
  return {
    kind: 'process',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      return {
        taskId: task.taskId,
        result: new Promise(() => undefined),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

interface ITestAdoptedWork {
  settled: Promise<IToolResult>;
  abort: ReturnType<typeof vi.fn>;
  resolve: (result: IToolResult) => void;
  reject: (error: unknown) => void;
}

function createTestAdoptedWork(): ITestAdoptedWork {
  let resolveFn: (result: IToolResult) => void = () => undefined;
  let rejectFn: (error: unknown) => void = () => undefined;
  const settled = new Promise<IToolResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { settled, abort: vi.fn(() => Promise.resolve()), resolve: resolveFn, reject: rejectFn };
}

/** Collects every emitted event into a plain array — simpler to type-narrow than `vi.fn().mock.calls`. */
function createEventCollector(): {
  sink: (event: TBackgroundTaskEvent) => void;
  events: TBackgroundTaskEvent[];
} {
  const events: TBackgroundTaskEvent[] = [];
  return { sink: (event) => events.push(event), events };
}

function eventsOfType(
  events: TBackgroundTaskEvent[],
  type: TBackgroundTaskEvent['type'],
): TBackgroundTaskEvent[] {
  return events.filter((event) => event.type === type);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createToolInvocationBackgroundTaskRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-03: emits exactly one background_task_completed whose output is the tool text', async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const { sink: eventSink, events } = createEventCollector();
    const manager = new BackgroundTaskManager({ runners: [runner], eventSink });
    const work = createTestAdoptedWork();
    runner.adopt('token-1', work);

    const created = await manager.spawn(createToolInvocationRequest({ adoptionToken: 'token-1' }));
    expect(created.status).toBe('running');

    work.resolve({ success: true, data: 'crawled 42 pages' });
    const result = await manager.wait(created.id);

    expect(result.output).toBe('crawled 42 pages');
    expect(manager.get(created.id)?.status).toBe('completed');
    const completed = eventsOfType(events, 'background_task_completed');
    expect(completed).toHaveLength(1);
    if (completed[0]?.type === 'background_task_completed') {
      expect(completed[0].task.result?.output).toBe('crawled 42 pages');
    }
  });

  it('derives output text like discovered-tool.ts: string as-is, else JSON', async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const work = createTestAdoptedWork();
    runner.adopt('token-json', work);
    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-json' }),
    );
    work.resolve({ success: true, data: { pages: 42 } });
    const result = await manager.wait(created.id);
    expect(result.output).toBe(JSON.stringify({ pages: 42 }));
  });

  it('TC-04: exactly one delivery regardless of when the adopted promise settles', async () => {
    const timings = [
      'before-spawn',
      'same-tick-as-spawn',
      'one-microtask-later',
      'two-microtasks-later',
    ] as const;

    for (const timing of timings) {
      const runner = createToolInvocationBackgroundTaskRunner();
      const { sink: eventSink, events } = createEventCollector();
      const manager = new BackgroundTaskManager({ runners: [runner], eventSink });
      const work = createTestAdoptedWork();
      const token = `token-${timing}`;
      runner.adopt(token, work);

      if (timing === 'before-spawn') work.resolve({ success: true, data: 'done' });
      const spawnPromise = manager.spawn(createToolInvocationRequest({ adoptionToken: token }));
      if (timing === 'same-tick-as-spawn') work.resolve({ success: true, data: 'done' });
      const created = await spawnPromise;
      if (timing === 'one-microtask-later') {
        await Promise.resolve();
        work.resolve({ success: true, data: 'done' });
      }
      if (timing === 'two-microtasks-later') {
        await Promise.resolve();
        await Promise.resolve();
        work.resolve({ success: true, data: 'done' });
      }

      const result = await manager.wait(created.id);
      expect(result.output).toBe('done');
      const completed = eventsOfType(events, 'background_task_completed');
      const failed = eventsOfType(events, 'background_task_failed');
      expect(completed).toHaveLength(1);
      expect(failed).toHaveLength(0);
    }
  });

  it('TC-05: cancel invokes abort and emits exactly one cancelled event; a late settle emits nothing', async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const { sink: eventSink, events } = createEventCollector();
    const manager = new BackgroundTaskManager({ runners: [runner], eventSink });
    const work = createTestAdoptedWork();
    runner.adopt('token-cancel', work);

    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-cancel' }),
    );
    await manager.cancel(created.id, 'user');

    expect(work.abort).toHaveBeenCalledWith('user');
    expect(manager.get(created.id)?.status).toBe('cancelled');
    const cancelled = eventsOfType(events, 'background_task_cancelled');
    expect(cancelled).toHaveLength(1);
    if (cancelled[0]?.type === 'background_task_cancelled') {
      expect(cancelled[0].task.error?.message).toContain('user');
    }

    // A settle arriving after the cancel must change no event count.
    work.resolve({ success: true, data: 'too late' });
    await flushMicrotasks();
    expect(eventsOfType(events, 'background_task_completed')).toHaveLength(0);
    expect(eventsOfType(events, 'background_task_cancelled')).toHaveLength(1);
  });

  it('TC-06: an adopted promise that rejects emits exactly one background_task_failed, never a completion', async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const { sink: eventSink, events } = createEventCollector();
    const manager = new BackgroundTaskManager({ runners: [runner], eventSink });
    const work = createTestAdoptedWork();
    runner.adopt('token-fail', work);

    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-fail' }),
    );
    work.reject(new Error('tool exploded'));

    await expect(manager.wait(created.id)).rejects.toThrow();
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.error?.category).toBe('runner');
    expect(manager.get(created.id)?.error?.message).toBe('tool exploded');
    expect(manager.get(created.id)?.error?.recoverable).toBe(false);
    expect(eventsOfType(events, 'background_task_failed')).toHaveLength(1);
    expect(eventsOfType(events, 'background_task_completed')).toHaveLength(0);
  });

  it('TC-07: manager.shutdown() invokes abort, leaves the task cancelled with the shutdown message, and arms no timer', async () => {
    vi.useFakeTimers();
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const work = createTestAdoptedWork();
    runner.adopt('token-shutdown', work);

    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-shutdown' }),
    );
    await manager.shutdown();

    expect(work.abort).toHaveBeenCalledTimes(1);
    expect(work.abort.mock.calls[0]?.[0]).toContain('Background task manager shutdown');
    expect(manager.get(created.id)?.status).toBe('cancelled');
    expect(manager.get(created.id)?.error?.message).toContain('Background task manager shutdown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TC-20: with maxConcurrent 1 and a process task holding the slot, an admitted tool-invocation task still runs immediately and holds no slot', async () => {
    const processRunner = createNeverSettlingProcessRunner();
    const toolRunner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({
      runners: [processRunner, toolRunner],
      maxConcurrent: 1,
    });

    const processTask = await manager.spawn(createProcessRequest());
    expect(processTask.status).toBe('running'); // holds the one slot

    const work = createTestAdoptedWork();
    toolRunner.adopt('token-slot', work);
    const toolTask = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-slot' }),
    );

    // Never queued, despite the slot already being held.
    expect(toolTask.status).toBe('running');

    // cancel() reaches the handle at once — no queue draining required first.
    await manager.cancel(toolTask.id, 'immediate');
    expect(work.abort).toHaveBeenCalledWith('immediate');
    expect(manager.get(toolTask.id)?.status).toBe('cancelled');
    // The process task is unaffected — it never lost its slot to the admitted task.
    expect(manager.get(processTask.id)?.status).toBe('running');
  });

  it('fails immediately with category "validation" naming the token when it was never adopted', async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });

    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'never-adopted' }),
    );

    await expect(manager.wait(created.id)).rejects.toThrow();
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.error?.category).toBe('validation');
    expect(manager.get(created.id)?.error?.message).toContain('never-adopted');
  });

  it("adopt()'s release function withdraws the token (the wrapper's fallback path)", async () => {
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const work = createTestAdoptedWork();
    const release = runner.adopt('token-withdrawn', work);
    release();

    const created = await manager.spawn(
      createToolInvocationRequest({ adoptionToken: 'token-withdrawn' }),
    );
    expect(manager.get(created.id)?.status).toBe('failed');
    expect(manager.get(created.id)?.error?.category).toBe('validation');
  });
});
