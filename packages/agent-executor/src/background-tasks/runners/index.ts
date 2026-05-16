import type { IBackgroundTaskRunner } from '../types.js';
import { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
import { createScheduledTaskRunner } from './scheduled-task-runner.js';

export { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
export type { IManagedShellProcessRunnerOptions } from './managed-shell-process-runner.js';

export { createScheduledTaskRunner } from './scheduled-task-runner.js';
export type { IScheduledTaskRunnerOptions } from './scheduled-task-runner.js';

export function createDefaultBackgroundTaskRunners(): IBackgroundTaskRunner[] {
  return [createManagedShellProcessRunner(), createScheduledTaskRunner()];
}
