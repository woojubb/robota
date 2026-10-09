/**
 * #3282 §4 part b-3 — plain-words presentation for the Agents panel's "Scheduled" group. Never an
 * ISO string or a cron expression: a concrete `nextFireAt` is shown in local time as "Today 9:00" /
 * "Tomorrow 9:00" / a weekday / a date; a handful of common cron shapes are phrased ("Every weekday
 * at 9:00"); anything else falls back to "Repeats".
 */

import type {
  IBackgroundTaskState,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface-execution';

type TScheduleTask = IBackgroundTaskState<'scheduled'>;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A concrete fire time, in plain local words — never the raw ISO string. */
export function formatPlainLocalTime(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'Unknown';
  const clock = formatClock(when);
  if (isSameLocalDay(when, now)) return `Today ${clock}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameLocalDay(when, tomorrow)) return `Tomorrow ${clock}`;
  const sixDaysOut = new Date(now);
  sixDaysOut.setDate(now.getDate() + 6);
  if (when.getTime() > now.getTime() && when.getTime() <= sixDaysOut.getTime()) {
    return `${WEEKDAY_NAMES[when.getDay()]} ${clock}`;
  }
  const date = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} ${clock}`;
}

/** A handful of common 5-field cron shapes phrased plainly; anything else is `undefined`. */
function describeCronPlainly(cronExpression: string): string | undefined {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*') return undefined;
  if (!/^\d{1,2}$/.test(minute!) || !/^\d{1,2}$/.test(hour!)) return undefined;
  const clock = `${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')}`;
  if (dayOfWeek === '*') return `Every day at ${clock}`;
  if (dayOfWeek === '1-5') return `Every weekday at ${clock}`;
  if (dayOfWeek === '0,6' || dayOfWeek === '6,0') return `Every weekend at ${clock}`;
  if (/^\d$/.test(dayOfWeek!)) {
    const name = WEEKDAY_NAMES[Number(dayOfWeek)];
    return name ? `Every ${name} at ${clock}` : undefined;
  }
  return undefined;
}

/** "When it runs next" — the Scheduled row's own line, in plain local time (never raw wire data). */
export function describeScheduleTiming(task: TScheduleTask, now: Date = new Date()): string {
  if (task.nextFireAt) return formatPlainLocalTime(task.nextFireAt, now);
  const cronExpression = task.schedule?.cronExpression;
  if (!cronExpression) return '—';
  return describeCronPlainly(cronExpression) ?? 'Repeats';
}

/** What a schedule runs — its one-line instruction, never the raw label/id. */
export function describeScheduleInstruction(task: TScheduleTask): string {
  return task.schedule?.agentInstruction ?? task.label;
}

const STATUS_LABELS: Partial<Record<TBackgroundTaskStatus, string>> = {
  sleeping: 'Active',
  paused: 'Paused',
  running: 'Running',
  queued: 'Queued',
  cancelled: 'Deleted',
  failed: 'Failed',
  completed: 'Done',
  waiting_permission: 'Needs you',
};

/** The schedule's status in plain words. */
export function describeScheduleStatus(task: TScheduleTask): string {
  return STATUS_LABELS[task.status] ?? task.status;
}
