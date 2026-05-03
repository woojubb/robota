// @robota-sdk/agent-sdk — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

// ── InteractiveSession (primary API) ────────────────────────
export { InteractiveSession } from './interactive/index.js';
export type {
  IInteractiveSessionOptions,
  IInteractiveSessionShutdownOptions,
  IToolState,
  IDiffLine,
  IExecutionResult,
  IToolSummary,
  IUsageSnapshot,
  TPermissionResultValue,
  TInteractivePermissionHandler,
  TInteractiveEventName,
  IInteractiveSessionEvents,
  ITransportAdapter,
} from './interactive/index.js';

// ── createQuery() factory (convenience API) ─────────────────
export { createQuery } from './query.js';
export type { ICreateQueryOptions } from './query.js';

// ── Session event contracts ─────────────────────────────────
export type { ICompactEvent, TCompactTrigger } from '@robota-sdk/agent-sessions';

// ── Command system (managed by InteractiveSession) ──────────
export {
  CommandRegistry,
  BuiltinCommandSource,
  createBuiltinCommandModule,
  SkillCommandSource,
  PluginCommandSource,
  SystemCommandExecutor,
  createSystemCommands,
  parseFrontmatter,
  executeSkill,
} from './commands/index.js';
export type {
  ICapabilityDescriptor,
  TCapabilityKind,
  TCapabilitySafety,
} from './capabilities/types.js';
export type {
  ICommand,
  ICommandHostAdapters,
  ICommandHostContext,
  ICommandModule,
  ICommandPickerAdapter,
  ICommandProcessAdapter,
  ICommandSource,
  ICommandSessionRuntime,
  ICommandSettingsAdapter,
  ICommandSettingsDocument,
  ISystemCommand,
  ICommandResult,
  ICommandInteraction,
  ICommandChoicePromptOption,
  ICommandListEntry,
  TCommandEffect,
  TCommandInteractionPrompt,
  TCommandResultDataValue,
  TSystemCommandLifecycle,
  ICommandPermissionModeAdapter,
  IForkExecutionOptions,
  ISkillExecutionCallbacks,
  ISkillExecutionResult,
  TCommandModuleSessionRequirement,
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
  ILegacyProviderSettings,
  IProviderProfileSettings,
  IProviderSettingsBuildOptions,
  IProviderSetupInput,
  IProviderSetupPatch,
  TProviderSettingsDocument,
} from './commands/index.js';
export {
  buildProviderProfile,
  buildProviderSetupPatch,
  createProviderSetupFlow,
  formatEnvReference,
  formatProviderSetupChoiceLabel,
  formatProviderSetupPromptLabel,
  formatProviderSetupSelectionPrompt,
  getProviderSetupStep,
  hasUsableSecretReference,
  isEnvReference,
  mergeProviderPatch,
  probeProviderProfile,
  resolveEnvReference,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  setCurrentProvider,
  submitProviderSetupValue,
  testProviderProfileCommand,
  AUTO_COMPACT_THRESHOLD_SETTINGS_KEY,
  compactCommandContext,
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  readAutoCompactThreshold,
  readAutoCompactThresholdSource,
  readCommandContextState,
  resetAutoCompactThresholdSetting,
  setCommandAutoCompactThreshold,
  upsertProviderProfile,
  validateProviderProfile,
  validateProviderSetupValue,
  writeAutoCompactThresholdSetting,
  buildModelCommandSubcommands,
  MODEL_COMMAND_ARGUMENT_HINT,
  MODEL_COMMAND_DESCRIPTION,
  buildLanguageCommandSubcommands,
  formatLanguageUsageMessage,
  LANGUAGE_COMMAND_ARGUMENT_HINT,
  LANGUAGE_COMMAND_DESCRIPTION,
  parseLanguageArgument,
  RECOMMENDED_RESPONSE_LANGUAGES,
  buildPermissionModeSubcommands,
  formatCommandPermissionsMessage,
  formatInvalidPermissionModeMessage,
  isPermissionMode,
  listCommandSessionAllowedTools,
  parsePermissionModeArgument,
  PERMISSIONS_COMMAND_DESCRIPTION,
  PERMISSION_MODE_ARGUMENT_HINT,
  PERMISSION_MODE_COMMAND_DESCRIPTION,
  readCommandPermissionsState,
  readCommandPermissionMode,
  resolvePermissionModeAdapter,
  VALID_PERMISSION_MODES,
  writeCommandPermissionMode,
} from './commands/index.js';
export type {
  ICompactContextResult,
  IPermissionsCommandState,
  IProviderSetupFlowState,
  IProviderSetupPromptStep,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
  TProviderSetupFlowSubmitResult,
  TProviderSetupType,
  TRecommendedResponseLanguage,
  TPromptInput,
} from './commands/index.js';

// ── Skill prompt utilities ───────────────────────────────────
export {
  buildSkillPrompt,
  substituteVariables,
  preprocessShellCommands,
} from './utils/skill-prompt.js';
export type { SkillPromptContext } from './utils/skill-prompt.js';

// ── Types (re-exported from owning packages) ────────────────
export type { TToolResult, TTrustLevel, TPermissionDecision, TPermissionMode } from './types.js';
export { TRUST_TO_MODE } from './types.js';
export type { ITerminalOutput, ISpinner } from './types.js';
export type {
  IContextWindowState,
  IContextTokenUsage,
  IHistoryEntry,
} from '@robota-sdk/agent-core';
export {
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
} from '@robota-sdk/agent-core';
export type { TToolArgs, IPermissionLists } from '@robota-sdk/agent-core';
export type { THookEvent, THooksConfig, IHookInput } from '@robota-sdk/agent-core';
export type { IAIProvider } from '@robota-sdk/agent-core';

// ── Project memory ─────────────────────────────────────────
export {
  ProjectMemoryStore,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_MAX_BYTES,
  isMemoryType,
} from './memory/project-memory-store.js';
export type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
  TMemoryType,
} from './memory/project-memory-store.js';
// ── Edit checkpointing ─────────────────────────────────────
export { EditCheckpointStore, wrapEditCheckpointTools } from './checkpoints/index.js';
export type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
  IEditCheckpointRecorder,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
} from './checkpoints/index.js';

// ── Self-hosting verification ─────────────────────────────
export { planSelfHostingVerification, transitionSelfHostingLoop } from './self-hosting/index.js';
export type {
  ISelfHostingVerificationPlan,
  ISelfHostingVerificationPlanInput,
  ISelfHostingVerificationStep,
  TSelfHostingLoopEvent,
  TSelfHostingLoopState,
  TSelfHostingVerificationPhase,
} from './self-hosting/index.js';

// ── Plugin management ───────────────────────────────────────
export { PluginSettingsStore } from './plugins/index.js';
export type { IPluginSettings } from './plugins/index.js';
export { BundlePluginLoader } from './plugins/index.js';
export { BundlePluginInstaller } from './plugins/index.js';
export type {
  IBundlePluginInstallerOptions,
  IInstalledPluginRecord,
  IInstalledPluginsRegistry,
} from './plugins/index.js';
export { MarketplaceClient } from './plugins/index.js';
export type {
  IMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
  IKnownMarketplaceEntry,
  IKnownMarketplacesRegistry,
} from './plugins/index.js';
export type {
  IBundlePluginManifest,
  IBundlePluginFeatures,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './plugins/index.js';

// ── Agent definitions ───────────────────────────────────────
export type { IAgentDefinition } from './agents/index.js';
export { BUILT_IN_AGENTS, getBuiltInAgent } from './agents/index.js';

// ── Subagent (SDK-internal, exported for CLI fork execution) ─
export {
  createDefaultTools,
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
  createSubagentSession,
  createSubagentLogger,
  resolveSubagentLogDir,
} from './assembly/index.js';
export type { ISubagentPromptOptions, ISubagentOptions } from './assembly/index.js';
export { createAgentTool, storeAgentToolDeps, retrieveAgentToolDeps } from './tools/agent-tool.js';
export type { IAgentToolDeps } from './tools/agent-tool.js';
export { createCommandExecutionTool } from './tools/command-execution-tool.js';
export type { ICommandExecutionToolDeps } from './tools/command-execution-tool.js';
export { createBackgroundProcessTool } from './tools/background-process-tool.js';
export type { IBackgroundProcessToolDeps } from './tools/background-process-tool.js';

// ── Background task runtime contracts ──────────────────────
export {
  BackgroundTaskError,
  BackgroundJobOrchestrator,
  BackgroundTaskManager,
  getBackgroundTaskTransitions,
  isTerminalBackgroundTaskStatus,
  summarizeBackgroundJobGroup,
  transitionBackgroundTaskStatus,
} from './background-tasks/index.js';
export type {
  IAgentBackgroundTaskRequest,
  IBaseBackgroundTaskRequest,
  IBackgroundTaskError,
  IBackgroundTaskHandle,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskManager,
  IBackgroundTaskManagerOptions,
  IBackgroundTaskRequest,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IBackgroundTaskState,
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupSummary,
  IBackgroundJobGroupState,
  IBackgroundJobOrchestratorOptions,
  IBackgroundJobResultEnvelope,
  IProcessBackgroundTaskRequest,
  ISerializableProviderProfile,
  TBackgroundTaskIdFactory,
  TBackgroundPermissionPolicy,
  TBackgroundPrimitive,
  TBackgroundTaskErrorCategory,
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
  TBackgroundTaskKind,
  TBackgroundTaskIsolation,
  TBackgroundTaskMode,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskStatus,
  TBackgroundTaskTimeoutReason,
  TBackgroundTaskTransitionEvent,
  TBackgroundJobGroupEvent,
  TBackgroundJobGroupEventListener,
  TBackgroundJobGroupIdFactory,
  TBackgroundJobGroupStatus,
  TBackgroundJobWaitPolicy,
} from './background-tasks/index.js';

// ── Subagent process manager contracts ─────────────────────
export {
  SubagentManager,
  WorktreeSubagentRunner,
  createWorktreeSubagentRunner,
} from './subagents/index.js';
export type {
  IInProcessSubagentRunnerDeps,
  IPreparedSubagentWorktree,
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentJobState,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentRunner,
  ISubagentSpawnRequest,
  ISubagentWorktreeAdapter,
  ISubagentWorktreePrepareRequest,
  IWorktreeSubagentRunnerOptions,
  TSubagentRunnerFactory,
  TSubagentJobMode,
  TSubagentJobStatus,
} from './subagents/index.js';

// ── Hook executors ──────────────────────────────────────────
export { PromptExecutor, AgentExecutor } from './hooks/index.js';
export type { TProviderFactory, IPromptProvider, IPromptExecutorOptions } from './hooks/index.js';
export type { TSessionFactory, IAgentSession, IAgentExecutorOptions } from './hooks/index.js';

// ── Paths ───────────────────────────────────────────────────
export { projectPaths, userPaths } from './paths.js';

// ── Task context ───────────────────────────────────────────
export {
  discoverTaskFiles,
  formatTaskContext,
  loadTaskContext,
  parseTaskFile,
  readCurrentGitBranch,
  selectRelevantTasks,
  updateTaskFileStatus,
} from './context/task-context.js';
export type {
  ITaskContextFile,
  ITaskSelectionOptions,
  IUpdateTaskFileStatusOptions,
  TTaskFileStatus,
} from './context/task-context.js';

// ── Permissions (from agent-core) ───────────────────────────
export { evaluatePermission } from '@robota-sdk/agent-core';
export { promptForApproval } from './permissions/permission-prompt.js';
export { runHooks } from '@robota-sdk/agent-core';

// ──────────────────────────────────────────────────────────────
// INTERNAL (not exported):
//   createSession()        — assembly factory
//   createProvider()       — REMOVED (provider comes from consumer)
//   loadConfig()           — config loading (used by InteractiveSession internally)
//   loadContext()          — context loading (used by InteractiveSession internally)
// ──────────────────────────────────────────────────────────────
