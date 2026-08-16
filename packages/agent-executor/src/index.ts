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
  IScheduleEditPatch,
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
// ARCH-037: the parameter type of the function directly above. Exported so a caller can name what
// it passes.
export type { ISubagentExecutionEnvelope } from './subagents/index.js';
// ARCH-031: `ISubagentSpawnRequest` and `ISubagentJobResult` are NOT here. They are owned by
// `@robota-sdk/agent-interface-transport` now, and re-publishing another package's symbols from this
// barrel is the pass-through re-export the repo bans. Only the runtime SPI is this package's to export.
export type {
  IPreparedSubagentWorktree,
  ISubagentJobHandle,
  ISubagentJobStart,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentRunner,
  ISubagentWorktreeAdapter,
  ISubagentWorktreePrepareRequest,
  IWorktreeSubagentRunnerOptions,
} from './subagents/index.js';
