// @robota-sdk/agent-sdk — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

// ── InteractiveSession (primary API) ────────────────────────
export { InteractiveSession } from './interactive/index.js';
export {
  createProjectSessionStore,
  listResumableSessionSummaries,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from './interactive/index.js';
export type {
  IInteractiveSessionOptions,
  IInteractiveSessionShutdownOptions,
  ISkillActivationEvent,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
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
  ICommandPluginAdapter,
  ICommandPluginReloadResult,
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
  ISkillActivationHistoryData,
  TSkillActivationInvocation,
  TSkillActivationMode,
  TSkillActivationSource,
  TSkillActivationStatus,
  TCommandModuleSessionRequirement,
  IActiveProviderModelCatalogState,
  IBuildModelCommandSubcommandsOptions,
  IModelCommandModuleOptions,
  IModelCommandSettingsAdapter,
  IResolveActiveProviderModelCatalogStateOptions,
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
  IProviderProfileNameSuggestionInput,
  IProviderProfileNameSuggestionOptions,
  ILegacyProviderSettings,
  IProviderProfileSettings,
  IProviderSettingsBuildOptions,
  IProviderSetupFlowOptions,
  IProviderSetupInput,
  IProviderSetupPatch,
  IStatusLineCommandSettings,
  TProviderSettingsDocument,
  TStatusLineCommandSettingsPatch,
  ICommandAvailablePlugin,
  ICommandInstalledPlugin,
  ICommandMarketplaceSource,
  TPluginInstallScope,
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from './commands/index.js';
export {
  addCommandContextReference,
  buildProviderProfile,
  buildProviderSetupPatch,
  clearCommandContextReferences,
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
  listCommandContextReferences,
  resolveEnvReference,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  sanitizeProviderProfileName,
  setCurrentProvider,
  suggestProviderProfileName,
  submitProviderSetupValue,
  testProviderProfileCommand,
  AUTO_COMPACT_THRESHOLD_SETTINGS_KEY,
  compactCommandContext,
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  readAutoCompactThreshold,
  readAutoCompactThresholdSource,
  readCommandContextState,
  removeCommandContextReference,
  resetAutoCompactThresholdSetting,
  setCommandAutoCompactThreshold,
  upsertProviderProfile,
  validateProviderProfile,
  validateProviderSetupValue,
  writeAutoCompactThresholdSetting,
  formatCommandHelpMessage,
  HELP_COMMAND_DESCRIPTION,
  buildModelCommandSubcommands,
  formatModelCommandUsageMessageAsync,
  formatModelCommandUsageMessage,
  MODEL_COMMAND_ARGUMENT_HINT,
  MODEL_COMMAND_DESCRIPTION,
  resolveActiveProviderModelCatalog,
  resolveActiveProviderModelCatalogState,
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
  buildStatusLineCommandSubcommands,
  buildPluginCommandSubcommands,
  createPluginRegistryReloadRequestedEffect,
  createPluginTuiRequestedEffect,
  clearConversationHistory,
  createSessionPickerRequestedEffect,
  createSessionRenamedEffect,
  CLEAR_COMMAND_DESCRIPTION,
  COST_COMMAND_DESCRIPTION,
  createSessionExitRequestedEffect,
  EXIT_COMMAND_DESCRIPTION,
  formatCommandSessionReplayValidationReport,
  parseSessionNameArgument,
  readCommandSessionInfo,
  validateCommandSessionReplayLog,
  RENAME_COMMAND_DESCRIPTION,
  RENAME_COMMAND_USAGE,
  RESUME_COMMAND_DESCRIPTION,
  VALIDATE_SESSION_COMMAND_DESCRIPTION,
  REWIND_COMMAND_ARGUMENT_HINT,
  REWIND_COMMAND_DESCRIPTION,
  buildRewindCommandSubcommands,
  MEMORY_COMMAND_ARGUMENT_HINT,
  MEMORY_COMMAND_DESCRIPTION,
  MEMORY_COMMAND_USAGE,
  buildMemoryCommandSubcommands,
  BACKGROUND_COMMAND_DESCRIPTION,
  BACKGROUND_COMMAND_USAGE,
  buildBackgroundCommandSubcommands,
  cancelCommandBackgroundTask,
  closeCommandBackgroundTask,
  formatCommandBackgroundTask,
  formatCommandBackgroundTaskList,
  listCommandBackgroundTasks,
  parseCommandBackgroundLogCursor,
  readCommandBackgroundTaskLog,
  createCommandMemoryStores,
  createCommandPendingMemoryStore,
  createCommandProjectMemoryStore,
  DEFAULT_STATUS_LINE_COMMAND_SETTINGS,
  hasSensitiveCommandMemoryContent,
  isStatusLineCommandSettingsPatch,
  isCommandMemoryType,
  inspectCommandEditCheckpoint,
  listCommandEditCheckpoints,
  listCommandUsedMemoryReferences,
  recordCommandMemoryEvent,
  restoreCommandEditCheckpoint,
  rollbackCommandEditCheckpoint,
  STATUSLINE_COMMAND_ARGUMENT_HINT,
  STATUSLINE_COMMAND_DESCRIPTION,
  PLUGIN_COMMAND_ARGUMENT_HINT,
  PLUGIN_COMMAND_DESCRIPTION,
  RELOAD_PLUGINS_COMMAND_DESCRIPTION,
  resolvePluginCommandAdapter,
} from './commands/index.js';
export type {
  ICompactContextResult,
  ICommandSessionInfo,
  ICommandSessionReplayValidationReport,
  IPermissionsCommandState,
  IProviderSetupFlowState,
  IProviderSetupPromptStep,
  ICommandMemoryStores,
  ICommandPendingMemoryStore,
  ICommandProjectMemoryStore,
  IMemoryCandidate,
  IMemoryEvent,
  IMemoryPendingRecord,
  IMemoryReference,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
  TMemoryCandidateStatus,
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
  IEditCheckpointFileInspection,
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointManifest,
  IEditCheckpointRecorder,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
  TEditCheckpointFileRestoreAction,
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

// ── Reversible execution safety ───────────────────────────
export {
  evaluateReversibleToolSafety,
  wrapReversibleExecutionTools,
} from './reversible-execution/index.js';
export type {
  IReversibleExecutionOptions,
  IReversibleToolSafetyContext,
  IReversibleToolSafetyInput,
  IReversibleToolSafetyReport,
  TReversibleExecutionIsolation,
  TReversibleRollbackLayer,
  TReversibleSafetyStatus,
  TReversibleSideEffect,
} from './reversible-execution/index.js';

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
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
  DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE,
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
  ICreateLimitedOutputCaptureOptions,
  ILimitedOutputCapture,
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

// ── Prompt file references ─────────────────────────────────
export {
  buildPromptWithFileReferences,
  createPromptFileReferenceHistoryEntry,
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  parsePromptFileReferences,
  resolvePromptFileReferences,
  resolvePromptFileReferencePaths,
  toPromptFileReferenceRecords,
} from './context/prompt-file-references.js';
export {
  clearContextReferences,
  createContextReferenceItem,
  listActiveContextReferences,
  removeContextReference,
  toContextReferenceRecords,
  upsertContextReference,
} from './context/context-reference-inventory.js';
export type {
  IPromptFileReferenceDiagnostic,
  IPromptFileReferenceHistoryData,
  IPromptFileReferenceLimits,
  IPromptFileReferenceRecord,
  IPromptFileReferenceResolveOptions,
  IPromptFileReferenceToken,
  IResolvedPromptFileReference,
  IResolvedPromptFileReferences,
  TPromptFileReferenceDiagnosticCode,
  TPromptFileReferenceReason,
} from './context/prompt-file-references.js';
export type {
  IContextReferenceInventoryLimits,
  IContextReferenceUpsertResult,
  TContextReferenceLoadType,
  TContextReferenceStatus,
} from './context/context-reference-inventory.js';

// ── Permissions ─────────────────────────────────────────────
export { promptForApproval } from './permissions/permission-prompt.js';

// ──────────────────────────────────────────────────────────────
// INTERNAL (not exported):
//   createSession()        — assembly factory
//   createProvider()       — REMOVED (provider comes from consumer)
//   loadConfig()           — config loading (used by InteractiveSession internally)
//   loadContext()          — context loading (used by InteractiveSession internally)
// ──────────────────────────────────────────────────────────────
