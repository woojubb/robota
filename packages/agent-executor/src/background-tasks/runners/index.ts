import { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
import { createScheduledTaskRunner } from './scheduled-task-runner.js';
import { createToolInvocationBackgroundTaskRunner } from '../tool-invocation-runner.js';

import type { IBackgroundTaskRunner } from '../types.js';

export { createManagedShellProcessRunner } from './managed-shell-process-runner.js';
export type { IManagedShellProcessRunnerOptions } from './managed-shell-process-runner.js';

export { createScheduledTaskRunner, nextScheduledFireOnOrAfter } from './scheduled-task-runner.js';
export type { IScheduledTaskRunnerOptions } from './scheduled-task-runner.js';
export { resolveBackgroundTaskShellCommand } from './shell-command-resolution.js';
export type {
  IBackgroundTaskShellCommand,
  IBackgroundTaskShellResolutionOptions,
  IResolvedBackgroundTaskShellCommand,
} from './shell-command-resolution.js';

// MCP-004 §S1: re-exported here too so a consumer of `runners/index.js` finds every runner factory
// in one place, alongside its registration in `createDefaultBackgroundTaskRunners()` below.
export { createToolInvocationBackgroundTaskRunner } from '../tool-invocation-runner.js';

export function createDefaultBackgroundTaskRunners(): IBackgroundTaskRunner[] {
  return [
    createManagedShellProcessRunner(),
    createScheduledTaskRunner(),
    createToolInvocationBackgroundTaskRunner(),
  ];
}
