export {
  BackgroundTaskError,
  BackgroundTaskManager,
  createDefaultBackgroundTaskRunners,
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
  resolveBackgroundTaskShellCommand,
  getBackgroundTaskTransitions,
  isTerminalBackgroundTaskStatus,
  transitionBackgroundTaskStatus,
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
  DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE,
} from './background-tasks/index.js';
export type {
  IBackgroundTaskHandle,
  IBackgroundTaskShellCommand,
  IBackgroundTaskShellResolutionOptions,
  IBackgroundTaskManager,
  IBackgroundTaskManagerOptions,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IManagedShellProcessRunnerOptions,
  IResolvedBackgroundTaskShellCommand,
  IScheduledTaskRunnerOptions,
  TBackgroundTaskIdFactory,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskTransitionEvent,
  ICreateLimitedOutputCaptureOptions,
  ILimitedOutputCapture,
} from './background-tasks/index.js';
export {
  createProviderFromConfig,
  createProviderFromProfile,
  normalizeProviderConfig,
  resolveProfileApiKey,
} from './providers/index.js';
export {
  SubagentManager,
  WorktreeSubagentRunner,
  createWorktreeSubagentRunner,
  // ARCH-010: the single answer to "which directory does this subagent run in".
  subagentExecutionRoot,
} from './subagents/index.js';
export type {
  IPreparedSubagentWorktree,
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentRunner,
  ISubagentSpawnRequest,
  ISubagentWorktreeAdapter,
  ISubagentWorktreePrepareRequest,
  IWorktreeSubagentRunnerOptions,
} from './subagents/index.js';
