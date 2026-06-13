import { describe, expect, it, vi } from 'vitest';
import { createScheduledTaskRunner } from '../scheduled-task-runner.js';
import type { IBackgroundTaskStart, TBackgroundTaskRunnerEvent } from '../../types.js';

const TEST_TIMEOUT_MS = 15_000;

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function makeScheduledTask(
  cronExpression: string,
  command: string,
  emit?: (event: TBackgroundTaskRunnerEvent) => void,
): IBackgroundTaskStart {
  return {
    taskId: 'sched_1',
    request: {
      kind: 'scheduled',
      cronExpression,
      command,
      label: `scheduled: ${command}`,
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
    },
    emit,
  };
}

describe('createScheduledTaskRunner', () => {
  it('has kind "scheduled"', () => {
    const runner = createScheduledTaskRunner();
    expect(runner.kind).toBe('scheduled');
  });

  it('throws when started with wrong task kind', () => {
    const runner = createScheduledTaskRunner();
    const task: IBackgroundTaskStart = {
      taskId: 'bad_1',
      request: {
        kind: 'process',
        command: 'echo hello',
        label: 'process',
        mode: 'background',
        parentSessionId: 'session_1',
        depth: 0,
        cwd: process.cwd(),
      },
    };
    expect(() => runner.start(task)).toThrow('Invalid scheduled task kind');
  });

  it(
    'emits background_task_sleeping synchronously on start with a strictly-future nextFireAt',
    async () => {
      // BEHAVIOR-003: the initial sleeping event is emitted synchronously inside start(),
      // so the previous "wait 200ms then compare to Date.now()" was a flake — if start ran just
      // before a cron boundary, the 200ms wait crossed it and the (correct-at-emit) nextFireAt
      // fell behind the moved wall clock. Pin the clock so nextFireAt is computed against a known
      // instant and the next-minute invariant is deterministic.
      vi.useFakeTimers();
      try {
        const fixedNow = new Date('2026-01-01T00:00:30.000Z');
        vi.setSystemTime(fixedNow);

        const runner = createScheduledTaskRunner();
        const emittedEvents: TBackgroundTaskRunnerEvent[] = [];
        const task = makeScheduledTask('* * * * *', 'echo hello', (e) => emittedEvents.push(e));
        const handle = runner.start(task);

        // No wait: emitSleeping() runs synchronously during start().
        const sleepingEvent = emittedEvents.find((e) => e.type === 'background_task_sleeping');
        expect(sleepingEvent).toBeDefined();
        if (sleepingEvent?.type === 'background_task_sleeping') {
          // From 00:00:30, the next `* * * * *` fire is the next minute boundary 00:01:00 —
          // deterministic and strictly after the pinned instant.
          expect(sleepingEvent.nextFireAt).toBe('2026-01-01T00:01:00.000Z');
          expect(new Date(sleepingEvent.nextFireAt).getTime()).toBeGreaterThan(fixedNow.getTime());
        }

        await handle.cancel();
      } finally {
        vi.useRealTimers();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fires the command on cron schedule and emits waking → sleeping cycle',
    async () => {
      const runner = createScheduledTaskRunner();
      const emittedEvents: TBackgroundTaskRunnerEvent[] = [];

      // Use a cron that fires every second for testing
      const command = nodeCommand("process.stdout.write('scheduled-run\\n'); process.exit(0);");
      const task = makeScheduledTask('* * * * * *', command, (e) => emittedEvents.push(e));

      const handle = runner.start(task);

      // Wait for at least one fire cycle (give enough time for: sleep → wake → run → sleep)
      await new Promise((r) => setTimeout(r, 3000));

      await handle.cancel();

      const wakingEvents = emittedEvents.filter((e) => e.type === 'background_task_waking');
      const sleepingEvents = emittedEvents.filter((e) => e.type === 'background_task_sleeping');

      expect(wakingEvents.length).toBeGreaterThanOrEqual(1);
      // Initial sleeping + at least one post-run sleeping
      expect(sleepingEvents.length).toBeGreaterThanOrEqual(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resolves result promise when cancelled',
    async () => {
      const runner = createScheduledTaskRunner();
      const task = makeScheduledTask('* * * * *', 'echo hello');
      const handle = runner.start(task);

      // Small delay, then cancel
      setTimeout(() => void handle.cancel(), 100);

      // result should settle (resolve or reject) after cancel
      await expect(handle.result).resolves.toMatchObject({
        taskId: 'sched_1',
        kind: 'scheduled',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'supports readLog across multiple runs',
    async () => {
      const runner = createScheduledTaskRunner();
      const command = nodeCommand("process.stdout.write('run-output\\n'); process.exit(0);");
      const task = makeScheduledTask('* * * * * *', command);
      const handle = runner.start(task);

      // Wait for at least one run
      await new Promise((r) => setTimeout(r, 3000));
      await handle.cancel();

      if (!handle.readLog) throw new Error('readLog should be supported');
      const page = await handle.readLog({ offset: 0 });
      const logText = page.lines.join('\n');
      expect(logText).toContain('run-output');
    },
    TEST_TIMEOUT_MS,
  );
});
