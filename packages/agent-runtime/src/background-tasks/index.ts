export { BackgroundTaskManager } from './background-task-manager.js';
export {
  createDefaultBackgroundTaskRunners,
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
} from './runners/index.js';
export type {
  IManagedShellProcessRunnerOptions,
  IScheduledTaskRunnerOptions,
} from './runners/index.js';
export {
  getBackgroundTaskTransitions,
  isTerminalBackgroundTaskStatus,
  transitionBackgroundTaskStatus,
} from './state-machine.js';
export {
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
  DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE,
} from './log-pages.js';
export type { ICreateLimitedOutputCaptureOptions, ILimitedOutputCapture } from './log-pages.js';
export type { TBackgroundTaskTransitionEvent } from './state-machine.js';
export {
  BackgroundTaskError,
  type IAgentBackgroundTaskRequest,
  type IBaseBackgroundTaskRequest,
  type IBackgroundTaskError,
  type IBackgroundTaskHandle,
  type IBackgroundTaskInput,
  type IBackgroundTaskListFilter,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskManager,
  type IBackgroundTaskManagerOptions,
  type IBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IBackgroundTaskState,
  type IProcessBackgroundTaskRequest,
  type IScheduledBackgroundTaskRequest,
  type ISerializableProviderProfile,
  type TBackgroundPermissionPolicy,
  type TBackgroundPrimitive,
  type TBackgroundTaskErrorCategory,
  type TBackgroundTaskEvent,
  type TBackgroundTaskEventListener,
  type TBackgroundTaskIdFactory,
  type TBackgroundTaskIsolation,
  type TBackgroundTaskKind,
  type TBackgroundTaskMode,
  type TBackgroundTaskRunnerEvent,
  type TBackgroundTaskStatus,
  type TBackgroundTaskTimeoutReason,
} from './types.js';
