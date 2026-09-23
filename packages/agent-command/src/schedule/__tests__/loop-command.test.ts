import { describe, expect, it, vi } from 'vitest';

import { executeLoopCommand } from '../loop-command.js';

import { createTestAgentJobHost } from '@robota-sdk/agent-framework/testing';

describe('fixed in-session loop', () => {
  it('creates a recurring scheduled wake with the requested prompt', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_1' });
    const host = createTestAgentJobHost({ spawnScheduledWake });

    const result = await executeLoopCommand(host, vi.fn(), '5m check the build');

    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith({
      label: 'Loop: check the build',
      cronExpression: '0 */5 * * * *',
      agentInstruction: 'check the build',
      sessionLoop: true,
    });
    expect(result.message).toContain('/loop stop loop_task_1');
    expect(result.data).toMatchObject({ taskId: 'loop_task_1', cadenceLabel: '5m' });
  });

  it('accepts a trailing interval and reports the actual rounded cadence', async () => {
    const spawnScheduledWake = vi.fn().mockResolvedValue({ id: 'loop_task_2' });
    const host = createTestAgentJobHost({ spawnScheduledWake });

    const result = await executeLoopCommand(host, vi.fn(), 'check the deploy every 7 minutes');

    expect(result.success).toBe(true);
    expect(spawnScheduledWake).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: '0 */10 * * * *',
        agentInstruction: 'check the deploy',
      }),
    );
    expect(result.message).toContain('10m (rounded up) local-clock step');
    expect(result.message).toContain('daylight saving');
    expect(result.data).toMatchObject({ requestedMs: 420_000, cadenceLabel: '10m' });
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
    const host = createTestAgentJobHost({ listSchedules });
    const cancel = vi.fn().mockResolvedValue(undefined);

    const listed = await executeLoopCommand(host, cancel, 'list');
    expect(listed.message).toContain('loop_a');
    expect(listed.message).toContain('loop_b');
    expect(listed.message).not.toContain('schedule_c');
    expect(listed.message).not.toContain('loop_old');

    const stopped = await executeLoopCommand(host, cancel, 'stop loop_a');
    expect(stopped.success).toBe(true);
    expect(cancel).toHaveBeenCalledExactlyOnceWith('loop_a', 'Loop stopped by user');
    expect(stopped.message).toContain('already-running turn may finish');

    const unrelated = await executeLoopCommand(host, cancel, 'stop schedule_c');
    expect(unrelated.success).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'check the build', '0m check', '2d check', '5x check', '5m check every 2m'])(
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
