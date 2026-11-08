/**
 * Leaf formatting helpers for the auto-compact threshold line. Split out of `context-command.ts`
 * so `context-breakdown.ts` can use {@link formatAutoCompactLine} without importing back from
 * `context-command.ts`, which previously created an import cycle between the two.
 */
import type { TAutoCompactThreshold, TAutoCompactThresholdSource } from '@robota-sdk/agent-framework';

const PERCENT = 100;

export function formatThreshold(threshold: TAutoCompactThreshold): string {
  if (threshold === false) {
    return 'disabled';
  }
  return `${Math.round(threshold * PERCENT)}%`;
}

export function formatAutoCompactLine(
  threshold: TAutoCompactThreshold,
  source: TAutoCompactThresholdSource,
): string {
  if (threshold === false) {
    return `Auto compact: disabled (${source})`;
  }
  return `Auto compact: ${formatThreshold(threshold)} (${source})`;
}
