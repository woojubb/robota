import { Cron } from 'croner';

/** What the next-fire calculation depends on. */
export interface IScheduledFireTimeOptions {
  timezone?: string;
}

/** Resolve an eligible slot with the same Croner semantics as the scheduled runner. */
export function nextScheduledFireOnOrAfter(
  cronExpression: string,
  firstAllowedAt: Date,
  options: IScheduledFireTimeOptions = {},
): Date | null {
  const job = new Cron(cronExpression, {
    paused: true,
    ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
  });
  try {
    return job.nextRun(new Date(firstAllowedAt.getTime() - 1));
  } finally {
    job.stop();
  }
}
