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
  listSchedules: ReturnType<typeof vi.fn>;
  pauseSchedule: ReturnType<typeof vi.fn>;
  resumeSchedule: ReturnType<typeof vi.fn>;
  editSchedule: ReturnType<typeof vi.fn>;
} {
  const scheduled = vi.fn().mockResolvedValue({ id: 'task_sched' });
  const monitor = vi.fn().mockResolvedValue({ id: 'task_mon' });
  const listSchedules = vi.fn().mockReturnValue([
    {
      id: 'sched_1',
      status: 'sleeping',
      label: 'daily',
      kind: 'scheduled',
      nextFireAt: '2030-01-01T00:00:00.000Z',
      schedule: { cronExpression: '0 0 * * *' },
    },
  ]);
  const pauseSchedule = vi.fn().mockResolvedValue(undefined);
  const resumeSchedule = vi.fn().mockResolvedValue(undefined);
  const editSchedule = vi.fn().mockResolvedValue(undefined);
  const host = {
    spawnScheduledWake: scheduled,
    spawnMonitorWake: monitor,
    listSchedules,
    pauseSchedule,
    resumeSchedule,
    editSchedule,
  } as unknown as IAgentJobHostContext;
  return { host, scheduled, monitor, listSchedules, pauseSchedule, resumeSchedule, editSchedule };
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

// SELFHOST-012 TC-05: /schedule list|pause|resume|edit dispatch (mirror /background); create stays default.
describe('executeScheduleCommand — management subcommands (SELFHOST-012)', () => {
  it('list returns the caller schedules with cadence + status, no create', async () => {
    const { host, listSchedules, scheduled } = mockHost();
    const result = await executeScheduleCommand(host, 'list', Date.now());
    expect(result.success).toBe(true);
    expect(listSchedules).toHaveBeenCalledOnce();
    expect(result.message).toContain('sched_1');
    expect(result.message).toContain('[sleeping]');
    expect(result.message).toContain('0 0 * * *');
    expect(scheduled).not.toHaveBeenCalled(); // list is not a create
  });

  it('pause <id> / resume <id> dispatch to the host lifecycle calls', async () => {
    const { host, pauseSchedule, resumeSchedule } = mockHost();
    const paused = await executeScheduleCommand(host, 'pause sched_1', Date.now());
    expect(paused.success).toBe(true);
    expect(pauseSchedule).toHaveBeenCalledWith('sched_1');

    const resumed = await executeScheduleCommand(host, 'resume sched_1', Date.now());
    expect(resumed.success).toBe(true);
    expect(resumeSchedule).toHaveBeenCalledWith('sched_1');
  });

  it('edit <id> <spec> parses the spec and patches the schedule', async () => {
    const { host, editSchedule } = mockHost();
    const result = await executeScheduleCommand(
      host,
      'edit sched_1 cron "*/5 * * * *" ping',
      Date.now(),
    );
    expect(result.success).toBe(true);
    expect(editSchedule).toHaveBeenCalledWith('sched_1', {
      cronExpression: '*/5 * * * *',
      agentInstruction: 'ping',
    });
  });

  it('pause/resume/edit without an id is a usage error (no host call)', async () => {
    const { host, pauseSchedule, editSchedule } = mockHost();
    const p = await executeScheduleCommand(host, 'pause', Date.now());
    expect(p.success).toBe(false);
    expect(p.message).toContain('Usage:');
    expect(pauseSchedule).not.toHaveBeenCalled();

    const e = await executeScheduleCommand(host, 'edit sched_1', Date.now());
    expect(e.success).toBe(false);
    expect(editSchedule).not.toHaveBeenCalled();
  });

  it('a create spec (in/cron) still creates — subcommand keywords do not collide', async () => {
    const { host, scheduled, pauseSchedule } = mockHost();
    const result = await executeScheduleCommand(host, 'in 5m summarize', 0);
    expect(result.success).toBe(true);
    expect(scheduled).toHaveBeenCalledOnce();
    expect(pauseSchedule).not.toHaveBeenCalled();
  });
});
