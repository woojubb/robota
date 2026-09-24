import { describe, expect, it, vi } from 'vitest';

import { executeLoopCommand } from '../loop-command.js';

import { createTestAgentJobHost } from '@robota-sdk/agent-framework/testing';

describe('fixed in-session loop', () => {
  it('uses the host maintenance prompt for interval-only forms', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_default' });
    const host = createTestAgentJobHost({ spawnScheduledWake });
    const options = { defaultPrompt: 'Tend only the current task and its PR.' };

    expect((await executeLoopCommand(host, vi.fn(), '5m', options)).success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cronExpression: expect.any(String),
        agentInstruction: options.defaultPrompt,
      }),
    );
  });

  it('routes bare and prompt-only forms to the durable self-paced controller', async () => {
    const createSelfPacedLoop = vi.fn().mockImplementation(async (instruction: string) => ({
      loopId: 'loop_self', instruction, phase: 'pending', expiresAt: '2030-01-01T00:00:00.000Z',
    }));
    const spawnScheduledWake = vi.fn();
    const host = createTestAgentJobHost({ spawnScheduledWake, createSelfPacedLoop });
    const options = { defaultPrompt: 'Tend the current task.' };

    expect((await executeLoopCommand(host, vi.fn(), '', options)).success).toBe(true);
    expect((await executeLoopCommand(host, vi.fn(), 'check the build')).success).toBe(true);
    expect(createSelfPacedLoop.mock.calls.map(([prompt]) => prompt)).toEqual([
      options.defaultPrompt,
      'check the build',
    ]);
    expect(spawnScheduledWake).not.toHaveBeenCalled();
  });

  it('marks omitted prompts for live override resolution without changing explicit prompts', async () => {
    const createSelfPacedLoop = vi.fn().mockResolvedValue({
      loopId: 'loop_default', expiresAt: '2030-01-01T00:00:00.000Z',
    });
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'timer_default' });
    const host = createTestAgentJobHost({ createSelfPacedLoop, spawnScheduledWake });
    const resolveDefaultPrompt = vi.fn().mockReturnValue('current file prompt');
    const options = { defaultPrompt: 'built-in prompt', resolveDefaultPrompt };

    expect((await executeLoopCommand(host, vi.fn(), '', options)).success).toBe(true);
    expect(createSelfPacedLoop).toHaveBeenCalledWith('current file prompt', { useDefaultPrompt: true });
    expect((await executeLoopCommand(host, vi.fn(), '5m', options)).success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(expect.objectContaining({
      agentInstruction: 'current file prompt', sessionLoopDefaultPrompt: true,
    }));
    expect((await executeLoopCommand(host, vi.fn(), 'explicit check', options)).success).toBe(true);
    expect(createSelfPacedLoop).toHaveBeenLastCalledWith('explicit check');
    expect(resolveDefaultPrompt).toHaveBeenCalledTimes(2);
  });

  it('lists and stops a self-paced loop by stable identity without touching schedules', async () => {
    const stopSelfPacedLoop = vi.fn().mockResolvedValue(undefined);
    const host = createTestAgentJobHost({
      listSelfPacedLoops: () => [{
        loopId: 'loop_self', instruction: 'check', phase: 'waiting',
        createdAt: '2026-09-24T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z',
        revision: 1, generation: 1, fallbackUsed: false,
        nextAllowedAt: '2026-09-24T00:20:00.000Z',
      }],
      stopSelfPacedLoop,
    });
    expect((await executeLoopCommand(host, vi.fn(), 'list')).message).toContain('loop_self');
    expect((await executeLoopCommand(host, vi.fn(), 'stop loop_self')).success).toBe(true);
    expect(stopSelfPacedLoop).toHaveBeenCalledExactlyOnceWith('loop_self', 'Loop stopped by user');
  });

  it('does not describe a previous delay as the next check while a loop is running', async () => {
    const host = createTestAgentJobHost({
      listSelfPacedLoops: () => [{
        loopId: 'loop_running', instruction: 'check', phase: 'running',
        createdAt: '2026-09-24T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z',
        revision: 2, generation: 1, fallbackUsed: false,
        delaySeconds: 60, reason: 'previous check',
      }],
    });
    const listed = await executeLoopCommand(host, vi.fn(), 'list');
    expect(listed.message).toContain('loop_running [running]');
    expect(listed.message).not.toContain('next 60s');
  });

  it('assigns every new loop a seven-day expiry', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_expiring' });
    const host = createTestAgentJobHost({ spawnScheduledWake });
    const before = Date.now();
    const result = await executeLoopCommand(host, vi.fn(), '5m check');
    const after = Date.now();
    const expiresAt = spawnScheduledWake.mock.calls[0]?.[0].sessionLoopExpiresAt as string;

    expect(result.success).toBe(true);
    expect(Date.parse(expiresAt)).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60_000);
    expect(Date.parse(expiresAt)).toBeLessThanOrEqual(after + 7 * 24 * 60 * 60_000);
    expect(result.message).toContain(expiresAt);
  });

  it('does not promise a first fire before the requested interval elapses', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({
      id: 'loop_first',
      nextFireAt: '2026-09-24T00:10:00.000Z',
    });
    const host = createTestAgentJobHost({ spawnScheduledWake });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-24T00:09:00.000Z'));
    try {
      const result = await executeLoopCommand(host, vi.fn(), '7m check');
      const input = spawnScheduledWake.mock.calls[0]?.[0] as {
        sessionLoopFirstAllowedAt?: string;
      };
      expect(input.sessionLoopFirstAllowedAt).toBe('2026-09-24T00:16:00.000Z');
      expect(result.message).toContain('First eligible at or after 2026-09-24T00:16:00.000Z');
      expect(result.message).not.toContain('Next fire: 2026-09-24T00:10:00.000Z');
    } finally {
      clock.mockRestore();
    }
  });

  it('refuses loop creation when the host kill switch is on, but still permits list', async () => {
    const spawnScheduledWake = vi.fn();
    const host = createTestAgentJobHost({
      spawnScheduledWake,
      listSchedules: vi.fn().mockReturnValue([
        {
          id: 'loop_existing',
          kind: 'scheduled',
          status: 'sleeping',
          label: 'Loop: existing',
          metadata: { sessionLoop: true },
        },
      ]),
    });
    const options = { disabled: true, defaultPrompt: 'Tend current task.' };

    expect((await executeLoopCommand(host, vi.fn(), '5m check', options)).success).toBe(false);
    const listed = await executeLoopCommand(host, vi.fn(), 'list', options);
    expect(listed.success).toBe(true);
    expect(listed.message).toContain('loop_existing');
    expect(listed.message).toContain('disabled');
    expect(spawnScheduledWake).not.toHaveBeenCalled();
  });

  it('uses a stable loop id to find a re-armed task after its runtime id changes', async () => {
    const spawnScheduledWake = vi
      .fn()
      .mockImplementation(async (input: { sessionLoopId: string }) => ({
        id: 'runtime_before_resume',
        metadata: { sessionLoop: true, sessionLoopId: input.sessionLoopId },
      }));
    const listSchedules = vi.fn().mockImplementation(() => [
      {
        id: 'runtime_after_resume',
        kind: 'scheduled',
        status: 'sleeping',
        label: 'Loop: check',
        metadata: {
          sessionLoop: true,
          sessionLoopId: spawnScheduledWake.mock.calls[0]?.[0].sessionLoopId,
        },
      },
    ]);
    const host = createTestAgentJobHost({ spawnScheduledWake, listSchedules });
    const cancel = vi.fn().mockResolvedValue(undefined);

    const created = await executeLoopCommand(host, cancel, '5m check');
    const loopId = (created.data as { loopId?: string }).loopId;
    expect(loopId).toMatch(/^loop_[0-9a-f-]{36}$/);
    expect(loopId).not.toBe('runtime_before_resume');
    expect((await executeLoopCommand(host, cancel, 'list')).message).toContain(loopId);

    const stopped = await executeLoopCommand(host, cancel, `stop ${loopId}`);
    expect(stopped.success).toBe(true);
    expect(cancel).toHaveBeenCalledWith('runtime_after_resume', 'Loop stopped by user');
  });

  it('refuses a fourth active loop without spawning a timer', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'unexpected' });
    const listSchedules = vi.fn().mockReturnValue(
      Array.from({ length: 3 }, (_, index) => ({
        id: `runtime_${index}`,
        kind: 'scheduled',
        status: 'sleeping',
        label: 'Loop: check',
        metadata: { sessionLoop: true },
      })),
    );
    const host = createTestAgentJobHost({ spawnScheduledWake, listSchedules });
    const result = await executeLoopCommand(host, vi.fn(), '5m check');
    expect(result.success).toBe(false);
    expect(result.message).toContain('3 active loops');
    expect(spawnScheduledWake).not.toHaveBeenCalled();
  });

  it('reserves the final slot while a loop creation is still pending', async () => {
    const finishSpawns: Array<(task: { id: string }) => void> = [];
    const spawnScheduledWake = vi.fn().mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          finishSpawns.push(resolve);
        }),
    );
    const listSchedules = vi.fn().mockReturnValue(
      Array.from({ length: 2 }, (_, index) => ({
        id: `runtime_${index}`,
        kind: 'scheduled',
        status: 'sleeping',
        metadata: { sessionLoop: true },
      })),
    );
    const host = createTestAgentJobHost({ spawnScheduledWake, listSchedules });

    const first = executeLoopCommand(host, vi.fn(), '5m first');
    expect(spawnScheduledWake).toHaveBeenCalledTimes(1);
    const secondPending = executeLoopCommand(host, vi.fn(), '5m second');
    const spawnCount = spawnScheduledWake.mock.calls.length;
    finishSpawns.forEach((resolve, index) => resolve({ id: `runtime_${index + 2}` }));
    const second = await secondPending;
    expect(second.success).toBe(false);
    expect(second.message).toContain('3 active loops');
    expect(spawnCount).toBe(1);

    expect((await first).success).toBe(true);
  });

  it('creates a recurring scheduled wake with the requested prompt', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_1' });
    const host = createTestAgentJobHost({ spawnScheduledWake });

    const result = await executeLoopCommand(host, vi.fn(), '5m check the build');

    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Loop: check the build',
        cronExpression: expect.any(String),
        agentInstruction: 'check the build',
        sessionLoop: true,
        sessionLoopId: expect.stringMatching(/^loop_[0-9a-f-]{36}$/),
      }),
    );
    const loopId = (result.data as { loopId: string }).loopId;
    expect(result.message).toContain(`/loop stop ${loopId}`);
    expect(result.data).toMatchObject({ taskId: 'loop_task_1', cadenceLabel: '5m' });
    expect(result.data).toEqual(expect.objectContaining({ jitterSeconds: expect.any(Number) }));
    expect(result.message).toMatch(/stable offset \+\d+s/);
    expect((result.data as { jitterSeconds: number }).jitterSeconds).toBeLessThanOrEqual(150);
    expect(spawnScheduledWake.mock.calls[0]![0].cronExpression)
      .toBe((result.data as { cronExpression: string }).cronExpression);
  });

  it('accepts a trailing interval and reports the actual rounded cadence', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_2' });
    const host = createTestAgentJobHost({ spawnScheduledWake });

    const result = await executeLoopCommand(host, vi.fn(), 'check the deploy every 7 minutes');

    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: expect.any(String),
        agentInstruction: 'check the deploy',
      }),
    );
    expect(result.message).toContain('10m (rounded up) local-clock step');
    expect(result.message).toContain('daylight saving');
    expect(result.data).toMatchObject({ requestedMs: 420_000, cadenceLabel: '10m' });
  });

  it('parses a malformed trailing interval in bounded time even after a long whitespace run', async () => {
    const host = createTestAgentJobHost();
    const started = performance.now();
    const result = await executeLoopCommand(host, vi.fn(), `check${' '.repeat(50_000)}every nope`);

    expect(result.success).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('does not treat a prompt beginning with stop as a management command', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_3' });
    const host = createTestAgentJobHost({ spawnScheduledWake });
    const result = await executeLoopCommand(host, vi.fn(), 'stopwatch the build every 2 minutes');
    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(
      expect.objectContaining({ agentInstruction: 'stopwatch the build' }),
    );
  });

  it('accepts a leading interval when the prompt ends in non-time every-quantity text', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_4' });
    const host = createTestAgentJobHost({ spawnScheduledWake });
    const result = await executeLoopCommand(host, vi.fn(), '5m inspect every 2 files');
    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(
      expect.objectContaining({ agentInstruction: 'inspect every 2 files' }),
    );
  });

  it('lists only active loops and stops only the selected loop', async () => {
    const listSchedules = vi.fn().mockReturnValue([
      {
        id: 'loop_a',
        kind: 'scheduled',
        status: 'sleeping',
        label: 'Loop: check A',
        metadata: { sessionLoop: true },
      },
      {
        id: 'loop_b',
        kind: 'scheduled',
        status: 'sleeping',
        label: 'Scheduled: edited B',
        metadata: { sessionLoop: true },
      },
      { id: 'schedule_c', kind: 'scheduled', status: 'sleeping', label: 'Scheduled: check C' },
      {
        id: 'loop_old',
        kind: 'scheduled',
        status: 'cancelled',
        label: 'Loop: old',
        metadata: { sessionLoop: true },
      },
    ]);
    const createSelfPacedLoop = vi.fn();
    const spawnScheduledWake = vi.fn();
    const host = createTestAgentJobHost({ listSchedules, createSelfPacedLoop, spawnScheduledWake });
    const cancel = vi.fn().mockResolvedValue(undefined);

    const listed = await executeLoopCommand(host, cancel, 'list');
    expect(listed.message).toContain('loop_a');
    expect(listed.message).toContain('loop_b');
    expect(listed.message).not.toContain('schedule_c');
    expect(listed.message).not.toContain('loop_old');
    expect(createSelfPacedLoop).not.toHaveBeenCalled();
    expect(spawnScheduledWake).not.toHaveBeenCalled();

    const stopped = await executeLoopCommand(host, cancel, 'stop loop_a');
    expect(stopped.success).toBe(true);
    expect(cancel).toHaveBeenCalledExactlyOnceWith('loop_a', 'Loop stopped by user');
    expect(stopped.message).toContain('already-running turn may finish');

    const unrelated = await executeLoopCommand(host, cancel, 'stop schedule_c');
    expect(unrelated.success).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['', '0m check', '2d check', '5x check', '5m check every 2m'])(
    'rejects an unsupported or ambiguous loop form: %s',
    async (args) => {
      const spawnScheduledWake = vi.fn();
      const host = createTestAgentJobHost({ spawnScheduledWake });
      const result = await executeLoopCommand(host, vi.fn(), args);
      expect(result.success).toBe(false);
      expect(spawnScheduledWake).not.toHaveBeenCalled();
    },
  );
});
