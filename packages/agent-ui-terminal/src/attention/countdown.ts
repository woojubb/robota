import {
  MINUTES_PER_HOUR,
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from './time-units.js';

/**
 * SCREEN-1992: the time until a sleeping schedule fires, rendered against a given clock so the
 * row can tick once a second without the projection changing.
 */
export function formatCountdown(nextFireAt: string, now: Date): string | undefined {
  const target = Date.parse(nextFireAt);
  if (Number.isNaN(target)) return undefined;
  const remainingMs = target - now.getTime();
  if (remainingMs <= 0) return 'now';
  const totalSeconds = Math.floor(remainingMs / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds}s`;
  return `in ${seconds}s`;
}
