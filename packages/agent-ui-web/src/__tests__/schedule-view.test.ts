/**
 * #3282 §4 part b-3 — plain-words schedule presentation: never an ISO string or a cron expression.
 */
import { describe, expect, it } from 'vitest';

import {
  describeScheduleInstruction,
  describeScheduleStatus,
  describeScheduleTiming,
  formatPlainLocalTime,
} from '../schedule-view.js';

import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

function schedule(
  overrides: Partial<IBackgroundTaskState<'scheduled'>> = {},
): IBackgroundTaskState<'scheduled'> {
  return {
    id: 'sched_1',
    kind: 'scheduled',
    label: 'Scheduled: check the build',
    status: 'sleeping',
    mode: 'background',
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/repo',
    updatedAt: '2026-05-01T00:00:00.000Z',
    unread: false,
    ...overrides,
  };
}

describe('formatPlainLocalTime', () => {
  // Built from LOCAL calendar-day arithmetic off a fixed "now", never a raw UTC offset — the
  // Today/Tomorrow boundary is a LOCAL day boundary, and a hardcoded UTC instant lands on a
  // different local day depending on the machine's timezone (this repo runs on both).
  const now = new Date(2026, 4, 1, 12, 0, 0); // 2026-05-01 noon, local time

  function localDaysFrom(base: Date, days: number, hour = 9): string {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  it('the same local day is "Today <time>"', () => {
    expect(formatPlainLocalTime(localDaysFrom(now, 0, 21), now)).toMatch(/^Today \d/);
  });

  it('the next local day is "Tomorrow <time>"', () => {
    expect(formatPlainLocalTime(localDaysFrom(now, 1), now)).toMatch(/^Tomorrow \d/);
  });

  it('within a week is a weekday name, not a date', () => {
    const result = formatPlainLocalTime(localDaysFrom(now, 3), now);
    expect(result).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d/);
  });

  it('further out is a short date, never an ISO string', () => {
    const result = formatPlainLocalTime(localDaysFrom(now, 45), now);
    expect(result).not.toMatch(/T\d\d:\d\d/);
    expect(result).not.toMatch(/^2026-/);
  });
});

describe('describeScheduleTiming', () => {
  const now = new Date(2026, 4, 1, 12, 0, 0); // 2026-05-01 noon, local time

  it('prefers the concrete next fire, in plain local time', () => {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const task = schedule({
      nextFireAt: tomorrow.toISOString(),
      schedule: { cronExpression: '0 9 * * *', agentInstruction: 'x' },
    });
    expect(describeScheduleTiming(task, now)).toMatch(/^Tomorrow \d/);
  });

  it('a daily cron with no pending fire reads "Every day at HH:MM"', () => {
    const task = schedule({ schedule: { cronExpression: '0 9 * * *', agentInstruction: 'x' } });
    expect(describeScheduleTiming(task, now)).toBe('Every day at 09:00');
  });

  it('a weekday cron with no pending fire reads "Every weekday at HH:MM"', () => {
    const task = schedule({ schedule: { cronExpression: '30 8 * * 1-5', agentInstruction: 'x' } });
    expect(describeScheduleTiming(task, now)).toBe('Every weekday at 08:30');
  });

  it('an unrecognized cron shape falls back to "Repeats", never the raw expression', () => {
    const task = schedule({ schedule: { cronExpression: '*/15 * * * *', agentInstruction: 'x' } });
    const result = describeScheduleTiming(task, now);
    expect(result).toBe('Repeats');
    expect(result).not.toContain('*');
  });

  it('a one-shot schedule with no schedule metadata and no pending fire is a plain dash', () => {
    expect(describeScheduleTiming(schedule(), now)).toBe('—');
  });
});

describe('describeScheduleInstruction / describeScheduleStatus', () => {
  it('prefers the instruction over the internal label', () => {
    const task = schedule({
      label: 'Scheduled: check the build',
      schedule: { cronExpression: '0 9 * * *', agentInstruction: 'check the build' },
    });
    expect(describeScheduleInstruction(task)).toBe('check the build');
  });

  it('falls back to the label when there is no instruction', () => {
    expect(describeScheduleInstruction(schedule({ label: 'raw label' }))).toBe('raw label');
  });

  it('states are plain words, never the raw status identifier', () => {
    expect(describeScheduleStatus(schedule({ status: 'sleeping' }))).toBe('Active');
    expect(describeScheduleStatus(schedule({ status: 'paused' }))).toBe('Paused');
    expect(describeScheduleStatus(schedule({ status: 'cancelled' }))).toBe('Deleted');
  });
});
