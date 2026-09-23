import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createScheduleCommandModule } from '../schedule-command-module.js';

let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('/loop command in a real interactive session', () => {
  it('creates, lists, and stops one scheduled wake without cancelling another schedule', async () => {
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
    });

    const other = await harness.command('schedule', 'cron "0 0 * * *" unrelated check');
    expect(other?.success).toBe(true);

    const created = await harness.command('loop', '1h check the build');
    expect(created?.success).toBe(true);
    const loopId = (created?.data as { taskId: string }).taskId;
    expect(created?.message).toContain(`Stop with /loop stop ${loopId}`);

    const listed = await harness.command('loop', 'list');
    expect(listed?.message).toContain(loopId);
    expect(listed?.message).not.toContain('unrelated check');

    const fired = await harness.wake('check the build', loopId);
    expect(fired).not.toBeNull();
    expect(harness.requests.length).toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const stopped = await harness.command('loop', `stop ${loopId}`);
    expect(stopped?.message).toContain('Loop stopped:');
    expect(await harness.wake('check the build', loopId)).toBeNull();
    expect((await harness.command('loop', 'list'))?.message).toBe('No active loops.');
    expect((await harness.command('schedule', 'list'))?.message).toContain('unrelated check');
  }, 20_000);
});
