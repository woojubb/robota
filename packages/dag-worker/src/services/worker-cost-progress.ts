import type { ITaskRun } from '@robota-sdk/dag-core';

/** Finds the maximum totalCredits across all task runs. */
export function resolveCurrentTotalCredits(taskRuns: ITaskRun[]): number {
  let currentTotalCredits = 0;
  for (const taskRun of taskRuns) {
    if (typeof taskRun.totalCredits !== 'number') {
      continue;
    }
    if (taskRun.totalCredits > currentTotalCredits) {
      currentTotalCredits = taskRun.totalCredits;
    }
  }
  return currentTotalCredits;
}
