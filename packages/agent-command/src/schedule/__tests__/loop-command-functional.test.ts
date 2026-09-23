import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createScheduleCommandModule } from '../schedule-command-module.js';

let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('/loop command in a real interactive session', () => {
  it('re-reads an omitted self-paced prompt before each iteration without changing explicit prompts', async () => {
    let prompt = 'project first';
    const resolveDefaultPrompt = () => prompt;
    harness = scriptedSession({
      turns: [{ text: 'first' }, { text: 'second' }],
      commandModules: [createScheduleCommandModule({ defaultPrompt: 'fallback', resolveDefaultPrompt })],
      resolveDefaultLoopPrompt: resolveDefaultPrompt,
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', '');
    expect(created?.success).toBe(true);
    const loopId = (created?.data as { loopId: string }).loopId;
    await vi.waitFor(() => expect(harness?.session.listSelfPacedLoops()[0]?.phase).toBe('waiting'));
    expect(JSON.stringify(harness.requests[0])).toContain('project first');

    prompt = 'project second';
    const timer = harness.session.listSchedules().find((task) => task.metadata?.['sessionLoopId'] === loopId)!;
    const nextAllowedAt = harness.session.listSelfPacedLoops()[0]!.nextAllowedAt!;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(nextAllowedAt) + 1);
    try {
      expect(await harness.wake('project first', timer.id)).not.toBeNull();
    } finally {
      clock.mockRestore();
    }
    expect(harness.requests[1]?.filter((message) => message.role === 'user').at(-1)?.content)
      .toBe('project second');
    expect(harness.session.getFullHistory().filter((entry) => entry.type === 'user').at(-1))
      .toMatchObject({ data: { content: 'project second' } });
    expect(harness.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId)?.phase)
      .toBe('stopped');
  });

  it('re-reads an interval-only fixed-loop prompt before each wake', async () => {
    let prompt = 'user first';
    const resolveDefaultPrompt = () => prompt;
    harness = scriptedSession({
      turns: [{ text: 'first' }, { text: 'second' }],
      commandModules: [createScheduleCommandModule({ defaultPrompt: 'fallback', resolveDefaultPrompt })],
      resolveDefaultLoopPrompt: resolveDefaultPrompt,
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', '5m');
    expect(created?.success).toBe(true);
    const { loopId, taskId, firstAllowedAt } = created?.data as {
      loopId: string; taskId: string; firstAllowedAt: string;
    };
    const eligibleClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(firstAllowedAt) + 1);
    try {
      expect(await harness.wake('user first', taskId)).not.toBeNull();
      prompt = 'user second';
      expect(await harness.wake('user first', taskId)).not.toBeNull();
    } finally {
      eligibleClock.mockRestore();
    }
    expect(JSON.stringify(harness.requests[0])).toContain('user first');
    expect(harness.requests[1]?.filter((message) => message.role === 'user').at(-1)?.content)
      .toBe('user second');
    expect(harness.session.getFullHistory().filter((entry) => entry.type === 'user').at(-1))
      .toMatchObject({ data: { content: 'user second' } });
    expect((await harness.command('loop', `stop ${loopId}`))?.success).toBe(true);
  });

  it('does not consult the default resolver for an explicit fixed-loop prompt', async () => {
    harness = scriptedSession({
      turns: [{ text: 'done' }],
      commandModules: [createScheduleCommandModule({
        defaultPrompt: 'fallback',
        resolveDefaultPrompt: () => { throw new Error('must not read default'); },
      })],
      resolveDefaultLoopPrompt: () => { throw new Error('must not read default'); },
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', '5m explicit check');
    expect(created?.success).toBe(true);
    const { loopId, taskId, firstAllowedAt } = created?.data as {
      loopId: string; taskId: string; firstAllowedAt: string;
    };
    const eligibleClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(firstAllowedAt) + 1);
    try {
      expect(await harness.wake('explicit check', taskId)).not.toBeNull();
    } finally {
      eligibleClock.mockRestore();
    }
    expect(harness.requests[0]?.filter((message) => message.role === 'user').at(-1)?.content)
      .toBe('explicit check');
    expect((await harness.command('loop', `stop ${loopId}`))?.success).toBe(true);
  });

  it('honors an explicit schedule edit to a fixed loop that originally used the default', async () => {
    let prompt = 'default first';
    const resolveDefaultPrompt = () => prompt;
    harness = scriptedSession({
      turns: [{ text: 'done' }],
      commandModules: [createScheduleCommandModule({ defaultPrompt: 'fallback', resolveDefaultPrompt })],
      resolveDefaultLoopPrompt: resolveDefaultPrompt,
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', '5m');
    expect(created?.success).toBe(true);
    const { loopId, taskId, firstAllowedAt } = created?.data as {
      loopId: string; taskId: string; firstAllowedAt: string;
    };
    expect((await harness.command('schedule', `edit ${taskId} cron "*/5 * * * *" explicit edit`))?.success)
      .toBe(true);
    prompt = 'default changed';
    const eligibleClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(firstAllowedAt) + 1);
    try {
      expect(await harness.wake('explicit edit', taskId)).not.toBeNull();
    } finally {
      eligibleClock.mockRestore();
    }
    expect(harness.requests[0]?.filter((message) => message.role === 'user').at(-1)?.content)
      .toBe('explicit edit');
    expect((await harness.command('loop', `stop ${loopId}`))?.success).toBe(true);
  });

  it('runs a prompt-only iteration, records the model delay, and stops its one-shot timer', async () => {
    harness = scriptedSession({
      turns: [
        { toolCalls: [{ name: 'report_loop_decision', args: {
          action: 'continue', delaySeconds: 60, reason: 'Recheck after the build settles',
        } }] },
        { text: 'Build still running.' },
      ],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
    });
    let phaseAtComplete: string | undefined;
    let historyAtComplete = '';
    harness.session.on('complete', () => {
      phaseAtComplete = harness?.session.listSelfPacedLoops()[0]?.phase;
      historyAtComplete = JSON.stringify(harness?.session.getFullHistory());
    });
    const created = await harness.command('loop', 'check the build');
    expect(created?.success).toBe(true);
    const loopId = (created?.data as { loopId: string }).loopId;
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId))
        .toMatchObject({ phase: 'waiting', generation: 1, delaySeconds: 60, fallbackUsed: false }),
    );
    const timer = harness.session.listSchedules().find(
      (task) => task.metadata?.['sessionLoopId'] === loopId && task.metadata?.['sessionLoopSelfPaced'],
    );
    expect(timer?.schedule?.cronExpression).toBe(
      harness.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId)?.nextAllowedAt,
    );
    const listed = await harness.command('loop', 'list');
    expect(listed?.message).toContain(loopId);
    expect(listed?.message).toContain('60s');
    expect(listed?.message).toContain('Recheck after the build settles');
    expect(JSON.stringify(harness.session.getFullHistory()))
      .toContain('Recheck after the build settles');
    expect(phaseAtComplete).toBe('waiting');
    expect(historyAtComplete).toContain('Recheck after the build settles');
    expect((await harness.command('loop', `stop ${loopId}`))?.success).toBe(true);
    expect(harness.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId)?.phase).toBe('stopped');
    expect((await harness.command('loop', 'list'))?.message).toBe('No active loops.');
  });

  it('restores one future self-paced wake with a new timer id, without replaying the turn', async () => {
    harness = scriptedSession({
      turns: [{ text: 'Still waiting.' }],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', 'check the build');
    const loopId = (created?.data as { loopId: string }).loopId;
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId)?.phase)
        .toBe('waiting'),
    );
    const firstTimer = harness.session.listSchedules().find(
      (task) => task.metadata?.['sessionLoopId'] === loopId,
    )!;
    const sessionId = harness.session.getSession().getSessionId();
    await harness.session.shutdown({ reason: 'other' });

    const resumed = scriptedSession({
      turns: [],
      cwd: harness.cwd,
      resumeSessionId: sessionId,
      backgroundTasks: true,
      persistence: true,
    });
    try {
      await vi.waitFor(() =>
        expect(resumed.session.listSchedules().some(
          (task) => task.metadata?.['sessionLoopId'] === loopId && task.id !== firstTimer.id,
        )).toBe(true),
      );
      expect(resumed.requests).toHaveLength(0);
      expect(resumed.session.listSelfPacedLoops().find((loop) => loop.loopId === loopId)?.phase)
        .toBe('waiting');
    } finally {
      await resumed.dispose();
    }
  });

  it('does not honor a denied model reschedule call', async () => {
    harness = scriptedSession({
      turns: [
        { toolCalls: [{ name: 'report_loop_decision', args: {
          action: 'continue', delaySeconds: 60, reason: 'Model asked, host denied',
        } }] },
        { text: 'done' },
      ],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
      deniedTools: ['report_loop_decision'],
      permissionMode: 'default',
    });
    const created = await harness.command('loop', 'check');
    expect(created?.success).toBe(true);
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops()[0]?.phase).toBe('waiting'),
    );
    expect(harness.session.listSelfPacedLoops()[0]).toMatchObject({
      delaySeconds: 1200,
      fallbackUsed: true,
    });
  });

  it('runs only one fallback wake after omitted decisions, then stops', async () => {
    harness = scriptedSession({
      turns: [{ text: 'First check.' }, { text: 'Second check.' }],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
    });
    const created = await harness.command('loop', 'check');
    const loopId = (created?.data as { loopId: string }).loopId;
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops()[0]).toMatchObject({
        phase: 'waiting', generation: 1, fallbackUsed: true,
      }),
    );
    const timer = harness.session.listSchedules().find(
      (task) => task.metadata?.['sessionLoopId'] === loopId,
    )!;
    const nextAllowedAt = harness.session.listSelfPacedLoops()[0]!.nextAllowedAt!;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(nextAllowedAt) + 1);
    try {
      expect(await harness.wake('check', timer.id)).not.toBeNull();
    } finally {
      clock.mockRestore();
    }
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops()[0]).toMatchObject({
        phase: 'stopped', terminalReason: 'missing-reschedule-decision',
      }),
    );
    expect(harness.requests).toHaveLength(2);
  });

  it('allows the model to stop its own loop without arming a timer', async () => {
    harness = scriptedSession({
      turns: [
        { toolCalls: [{ name: 'report_loop_decision', args: { action: 'stop' } }] },
        { text: 'Done checking.' },
      ],
      commandModules: [createScheduleCommandModule()],
      backgroundTasks: true,
      persistence: true,
    });
    await harness.command('loop', 'check');
    await vi.waitFor(() =>
      expect(harness?.session.listSelfPacedLoops()[0]).toMatchObject({
        phase: 'stopped', terminalReason: 'model-stopped',
      }),
    );
    expect(harness.session.listSchedules().filter((task) => task.metadata?.['sessionLoopSelfPaced']))
      .toHaveLength(0);
  });

  it('uses the host maintenance prompt, persists expiry, and refuses a wake after expiry', async () => {
    const maintenancePrompt = 'Check the current work only.';
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [createScheduleCommandModule({ defaultPrompt: maintenancePrompt })],
      backgroundTasks: true,
      persistence: true,
    });

    const created = await harness.command('loop', '5m');
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
