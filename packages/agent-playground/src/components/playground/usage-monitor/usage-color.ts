import {
  PERCENTAGE_MULTIPLIER,
  USAGE_CAUTION_THRESHOLD,
  USAGE_WARNING_THRESHOLD,
} from './constants';

export function getUsagePercentage(current: number, max: number): number {
  return (current / max) * PERCENTAGE_MULTIPLIER;
}

export function getUsageColor(current: number, max: number): string {
  const percentage = getUsagePercentage(current, max);

  if (percentage >= USAGE_WARNING_THRESHOLD) return 'text-red-500';
  if (percentage >= USAGE_CAUTION_THRESHOLD) return 'text-yellow-500';
  return 'text-green-500';
}
