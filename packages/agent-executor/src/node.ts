/**
 * The Node-only surface of `agent-executor`.
 *
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"): it never reaches a Node
 * built-in or global. What spawns processes or reports through the process lives here, and a
 * composition root hands it to the neutral code: runners to `BackgroundTaskManager`'s `runners`,
 * the warning reporter to its `onObserverFailure`.
 */
export {
  createDefaultBackgroundTaskRunners,
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
  resolveBackgroundTaskShellCommand,
} from './background-tasks/runners/node-index.js';
export type {
  IBackgroundTaskShellCommand,
  IBackgroundTaskShellResolutionOptions,
  IManagedShellProcessRunnerOptions,
  IResolvedBackgroundTaskShellCommand,
  IScheduledTaskRunnerOptions,
} from './background-tasks/runners/node-index.js';
export { reportObserverFailureAsProcessWarning } from './background-tasks/process-warning-reporter.js';
