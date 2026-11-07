import { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
import { createScheduledTaskRunner } from './scheduled-task-runner.js';
import { createToolInvocationBackgroundTaskRunner } from '../tool-invocation-runner.js';

import type { IBackgroundTaskRunner } from '../types.js';

export { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
export type { IManagedShellProcessRunnerOptions } from './managed-shell-process-runner.js';

export { createScheduledTaskRunner } from './scheduled-task-runner.js';
export type { IScheduledTaskRunnerOptions } from './scheduled-task-runner.js';
export { resolveBackgroundTaskShellCommand } from './shell-command-resolution.js';
export type {
  IBackgroundTaskShellCommand,
  IBackgroundTaskShellResolutionOptions,
  IResolvedBackgroundTaskShellCommand,
} from './shell-command-resolution.js';

/**
 * The runners a Node host registers: the shell-process and scheduled runners spawn child processes,
 * so they live behind `./node`; the tool-invocation runner is the platform-neutral one beside them.
 */
export function createDefaultBackgroundTaskRunners(
  shellExecutable?: string,
): IBackgroundTaskRunner[] {
  return [
    createManagedShellProcessRunner({ shellExecutable }),
    createScheduledTaskRunner({ shellExecutable }),
    createToolInvocationBackgroundTaskRunner(),
  ];
}
