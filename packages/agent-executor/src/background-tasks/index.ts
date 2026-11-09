export { BackgroundTaskManager, isBuiltInRestoreManager } from './background-task-manager.js';
export {
  nextScheduledFireOnOrAfter,
  createToolInvocationBackgroundTaskRunner,
} from './runners/index.js';
export type { IScheduledFireTimeOptions } from './runners/index.js';
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
  deliverToObservers,
  OBSERVER_FAILURE_WARNING_CODE,
  reportObserverFailureAsConsoleWarning,
} from './observer-delivery.js';
export type { IObserverFailure, TObserverFailureReporter } from './observer-delivery.js';
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
  type IBackgroundTaskIdReservation,
  type IPreparedRestoredSchedules,
  type IBackgroundTaskManagerOptions,
  type TBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IBackgroundTaskState,
  type IProcessBackgroundTaskRequest,
  type IScheduleEditPatch,
  type IScheduledBackgroundTaskRequest,
  type ISerializableProviderProfile,
  type IToolInvocationAdopter,
  type IToolInvocationBackgroundTaskRequest,
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
