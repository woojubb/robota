import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';
import { PERCENTAGE_MULTIPLIER } from './constants';

export function calculateAverageExecutionTime(
  executionHistory: IPlaygroundExecutorResult[],
): number {
  if (executionHistory.length === 0) {
    return 0;
  }

  return (
    executionHistory.reduce((sum, result) => sum + result.duration, 0) / executionHistory.length
  );
}

export function calculateSuccessRate(executionHistory: IPlaygroundExecutorResult[]): number {
  if (executionHistory.length === 0) {
    return 0;
  }

  return (
    (executionHistory.filter((result) => result.success).length / executionHistory.length) *
    PERCENTAGE_MULTIPLIER
  );
}
