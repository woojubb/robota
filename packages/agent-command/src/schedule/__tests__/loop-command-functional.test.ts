import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createScheduleCommandModule } from '../schedule-command-module.js';

let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('/loop command in a real interactive session', () => {
  it('uses the host maintenance prompt, persists expiry, and refuses a wake after expiry', async () => {
    const maintenancePrompt = 'Check the current work only.';
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [createScheduleCommandModule({ defaultPrompt: maintenancePrompt })],
      backgroundTasks: true,
      persistence: true,
    });

    const created = await harness.command('loop', '');
    expect(created?.success).toBe(true);
    const { taskId, expiresAt, firstAllowedAt } = created?.data as {
      taskId: string;
      expiresAt: string;
      firstAllowedAt: string;
    };
    const scheduled = harness.session.listSchedules().find((task) => task.id === taskId);
    expect(scheduled?.schedule?.agentInstruction).toBe(maintenancePrompt);
    expect(scheduled?.metadata?.['sessionLoopExpiresAt']).toBe(expiresAt);
    expect(scheduled?.metadata?.['sessionLoopFirstAllowedAt']).toBe(firstAllowedAt);

    const earlyClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(firstAllowedAt) - 1);
    try {
      expect(await harness.wake(maintenancePrompt, taskId)).toBeNull();
      expect(harness.requests).toHaveLength(0);
    } finally {
      earlyClock.mockRestore();
    }

    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt) + 1);
    try {
      expect(await harness.wake(maintenancePrompt, taskId)).toBeNull();
      await vi.waitFor(() =>
        expect(harness?.session.listSchedules().find((task) => task.id === taskId)?.status).toBe(
          'cancelled',
        ),
      );
      expect(harness.requests).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('creates, lists, and stops one scheduled wake without cancelling another schedule', async () => {
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
    });

    const other = await harness.command('schedule', 'cron "0 0 * * *" unrelated check');
    expect(other?.success).toBe(true);

    const created = await harness.command('loop', '1h check the build');
    expect(created?.success).toBe(true);
    const { loopId, taskId, firstAllowedAt } = created?.data as {
      loopId: string;
      taskId: string;
      firstAllowedAt: string;
    };
    expect(loopId).not.toBe(taskId);
    expect(created?.message).toContain(`Stop with /loop stop ${loopId}`);

    const listed = await harness.command('loop', 'list');
    expect(listed?.message).toContain(loopId);
    expect(listed?.message).not.toContain('unrelated check');

    const eligibleClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(firstAllowedAt) + 1);
    const fired = await harness
      .wake('check the build', taskId)
      .finally(() => eligibleClock.mockRestore());
    expect(fired).not.toBeNull();
    expect(harness.requests.length).toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const edited = await harness.command(
      'schedule',
      `edit ${taskId} cron "0 0 * * *" renamed check`,
    );
    expect(edited?.success).toBe(true);
    expect((await harness.command('loop', 'list'))?.message).toContain(loopId);

    const stopped = await harness.command('loop', `stop ${loopId}`);
    expect(stopped?.message).toContain('Loop stopped:');
    expect(await harness.wake('check the build', taskId)).toBeNull();
    expect((await harness.command('loop', 'list'))?.message).toBe('No active loops.');
    expect((await harness.command('schedule', 'list'))?.message).toContain('unrelated check');
  }, 20_000);
});
