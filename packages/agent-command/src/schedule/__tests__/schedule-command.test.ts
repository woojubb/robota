/**
 * FLOW-005: `/schedule` + `/monitor` command surface.
 * - parseScheduleSpec: relative delay → one-shot ISO; cron form; invalid input rejected.
 * - executeScheduleCommand / executeMonitorCommand: build the wake request and spawn it.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeMonitorCommand, executeScheduleCommand } from '../schedule-command.js';
import { parseScheduleSpec } from '../schedule-spec-parser.js';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';

function mockHost(): {
  host: IAgentJobHostContext;
  scheduled: ReturnType<typeof vi.fn>;
  monitor: ReturnType<typeof vi.fn>;
} {
  const scheduled = vi.fn().mockResolvedValue({ id: 'task_sched' });
  const monitor = vi.fn().mockResolvedValue({ id: 'task_mon' });
  const host = {
    spawnScheduledWake: scheduled,
    spawnMonitorWake: monitor,
  } as unknown as IAgentJobHostContext;
  return { host, scheduled, monitor };
}

describe('parseScheduleSpec (FLOW-005)', () => {
  it('parses a relative delay into a one-shot ISO timestamp', () => {
    const result = parseScheduleSpec('in 5m summarize the logs', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.recurring).toBe(false);
    expect(result.spec.cronExpression).toBe(new Date(5 * 60_000).toISOString());
    expect(result.spec.instruction).toBe('summarize the logs');
  });

  it('parses a quoted cron expression as recurring', () => {
    const result = parseScheduleSpec('cron "0 9 * * *" run standup', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.recurring).toBe(true);
    expect(result.spec.cronExpression).toBe('0 9 * * *');
    expect(result.spec.instruction).toBe('run standup');
  });

  it('rejects an invalid duration', () => {
    expect(parseScheduleSpec('in 5x do X', 0).ok).toBe(false);
  });

  it('rejects a missing instruction', () => {
    expect(parseScheduleSpec('in 5m', 0).ok).toBe(false);
  });

  it('rejects unrecognized input', () => {
    expect(parseScheduleSpec('whenever you feel like it', 0).ok).toBe(false);
  });
});

describe('executeScheduleCommand (FLOW-005)', () => {
  it('TC-01: relative delay spawns a one-shot scheduled wake', async () => {
    const { host, scheduled } = mockHost();
    const now = 1_000_000;
    const result = await executeScheduleCommand(host, 'in 1m summarize', now);

    expect(result.success).toBe(true);
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: new Date(now + 60_000).toISOString(),
        agentInstruction: 'summarize',
      }),
    );
  });

  it('TC-02: cron form spawns a recurring scheduled wake', async () => {
    const { host, scheduled } = mockHost();
    const result = await executeScheduleCommand(host, 'cron "0 9 * * *" standup', Date.now());

    expect(result.success).toBe(true);
    expect(scheduled).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: '0 9 * * *', agentInstruction: 'standup' }),
    );
  });

  it('TC-03: invalid input is rejected without spawning', async () => {
    const { host, scheduled } = mockHost();
    const result = await executeScheduleCommand(host, 'garbage', Date.now());

    expect(result.success).toBe(false);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it('TC-04: monitor command spawns a process+match wake task', async () => {
    const { host, monitor } = mockHost();
    const result = await executeMonitorCommand(host, '"npm run dev" "ERROR" fix the failure');

    expect(result.success).toBe(true);
    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npm run dev',
        matchPattern: 'ERROR',
        agentInstruction: 'fix the failure',
      }),
    );
  });
});
