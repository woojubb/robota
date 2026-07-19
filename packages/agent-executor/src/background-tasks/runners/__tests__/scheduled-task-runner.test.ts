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
  extra?: { timeoutMs?: number },
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
      ...(extra?.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
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
    'kills a hung fire after timeoutMs so subsequent fires still run (CORE-024 RUNTIME-18)',
    async () => {
      const runner = createScheduledTaskRunner();
      const emittedEvents: TBackgroundTaskRunnerEvent[] = [];
      // A fire that hangs forever (sleeps 60s). With protect:true a hung fire would starve every
      // future fire; the per-fire timeout must kill it so the schedule resumes.
      const command = nodeCommand('setTimeout(() => {}, 60000);');
      const task = makeScheduledTask('* * * * * *', command, (e) => emittedEvents.push(e), {
        timeoutMs: 700,
      });

      const handle = runner.start(task);
      // Enough wall-clock for: fire #1 (hangs) → timeout-kill → sleep → fire #2 → timeout-kill → sleep.
      await new Promise((r) => setTimeout(r, 4000));
      await handle.cancel();

      const waking = emittedEvents.filter((e) => e.type === 'background_task_waking');
      const sleeping = emittedEvents.filter((e) => e.type === 'background_task_sleeping');
      // A hung fire that was killed still lets the NEXT fire happen → at least two wakes.
      expect(waking.length).toBeGreaterThanOrEqual(2);
      // Initial sleep + a post-kill sleep after each timed-out fire.
      expect(sleeping.length).toBeGreaterThanOrEqual(2);
    },
    TEST_TIMEOUT_MS,
  );

  // SELFHOST-012 TC-02: a paused schedule does not fire, and resumes correctly with the same task id.
  it(
    'does not fire while paused (croner .pause(), not .stop()) and fires again after resume',
    async () => {
      const runner = createScheduledTaskRunner();
      const emitted: TBackgroundTaskRunnerEvent[] = [];
      // Agent-wake-only every-second schedule: each fire emits a `waking` event (no child process).
      const task: IBackgroundTaskStart = {
        taskId: 'sched_pause_1',
        request: {
          kind: 'scheduled',
          cronExpression: '* * * * * *',
          agentInstruction: 'wake',
          label: 'paused-schedule',
          mode: 'background',
          parentSessionId: 'session_1',
          depth: 0,
          cwd: process.cwd(),
        },
        emit: (e) => emitted.push(e),
      };
      const handle = runner.start(task);
      if (!handle.pause || !handle.resume) throw new Error('pause/resume should be supported');

      // Pause immediately, before any tick, then let 2+ scheduled ticks pass.
      await handle.pause();
      await new Promise((r) => setTimeout(r, 2200));
      const wakesWhilePaused = emitted.filter((e) => e.type === 'background_task_waking').length;
      expect(wakesWhilePaused).toBe(0); // zero fires while paused — asserted by absence of wakes, not a flag

      // Resume and observe it fire again — same task identity.
      await handle.resume();
      await new Promise((r) => setTimeout(r, 2200));
      const wakesAfterResume = emitted.filter((e) => e.type === 'background_task_waking').length;
      expect(wakesAfterResume).toBeGreaterThanOrEqual(1);
      expect(handle.taskId).toBe('sched_pause_1');

      await handle.cancel();
    },
    TEST_TIMEOUT_MS,
  );

  // SELFHOST-012 TC-03: edit re-arms the schedule in place (same task id) with the new cadence.
  it('edits a schedule in place — new cadence applies, same task id', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
      const runner = createScheduledTaskRunner();
      const emitted: TBackgroundTaskRunnerEvent[] = [];
      const task = makeScheduledTask('0 * * * *', 'echo hi', (e) => emitted.push(e)); // hourly
      const handle = runner.start(task);
      if (!handle.editSchedule) throw new Error('editSchedule should be supported');

      // Initial hourly cadence → next fire at the top of the next hour.
      const firstSleeping = emitted.find((e) => e.type === 'background_task_sleeping');
      expect(firstSleeping?.type === 'background_task_sleeping' && firstSleeping.nextFireAt).toBe(
        '2026-01-01T01:00:00.000Z',
      );

      // Re-arm to every-minute: the new cadence takes effect and the task id is unchanged.
      await handle.editSchedule({ cronExpression: '* * * * *' });
      const lastSleeping = [...emitted]
        .reverse()
        .find((e) => e.type === 'background_task_sleeping');
      expect(lastSleeping?.type === 'background_task_sleeping' && lastSleeping.nextFireAt).toBe(
        '2026-01-01T00:01:00.000Z',
      );
      expect(handle.taskId).toBe('sched_1');

      await handle.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  // SELFHOST-012 (review CONSIDER): editing while paused re-pauses the rebuilt job and emits no sleeping while
  // paused; resuming then announces the NEW cadence. Locks in the `if (state.paused)` re-pause + no-emit guards.
  it('edit while paused stays paused (no sleeping emit) and resumes with the new cadence', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
      const runner = createScheduledTaskRunner();
      const emitted: TBackgroundTaskRunnerEvent[] = [];
      const handle = runner.start(
        makeScheduledTask('0 * * * *', 'echo hi', (e) => emitted.push(e)),
      );
      if (!handle.pause || !handle.resume || !handle.editSchedule) {
        throw new Error('lifecycle methods should be supported');
      }

      await handle.pause();
      const beforeEdit = emitted.filter((e) => e.type === 'background_task_sleeping').length;
      await handle.editSchedule({ cronExpression: '* * * * *' }); // every-minute
      const afterEdit = emitted.filter((e) => e.type === 'background_task_sleeping').length;
      expect(afterEdit).toBe(beforeEdit); // no sleeping emitted while paused

      await handle.resume();
      const lastSleeping = [...emitted]
        .reverse()
        .find((e) => e.type === 'background_task_sleeping');
      // resumed → the NEW every-minute cadence's next fire, not the original hourly one
      expect(lastSleeping?.type === 'background_task_sleeping' && lastSleeping.nextFireAt).toBe(
        '2026-01-01T00:01:00.000Z',
      );

      await handle.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

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
