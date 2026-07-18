// @robota-sdk/agent-framework — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

// ── InteractiveSession (primary API) ────────────────────────
export { InteractiveSession } from './interactive/index.js';

// ── Autonomous goal pursuit (GOAL-001) ──────────────────────
export {
  GoalController,
  extractGoalSignal,
  createGoalStatusTool,
  GOAL_SIGNAL_TOOL_NAME,
  DEFAULT_GOAL_MAX_ITERATIONS,
  DEFAULT_GOAL_NO_PROGRESS_LIMIT,
  buildGoalStartPrompt,
  buildGoalContinuationPrompt,
  type IGoalSignal,
  type TGoalDecision,
  type IGoalStartOptions,
} from './goal/index.js';

// ── Explicit plan-mode (SELFHOST-002) ───────────────────────
export { PlanController, type TPlanDecision, type IPlanControllerDeps } from './plan/index.js';
export {
  createProjectSessionStore,
  createUserSessionStore,
  listResumableSessionSummaries,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  generateSessionName,
} from './interactive/index.js';
export type {
  TInteractiveSessionOptions,
  IInteractiveSessionShutdownOptions,
} from './interactive/index.js';

// ── createQuery() factory (convenience API) ─────────────────
export { createQuery } from './query.js';
export type { ICreateQueryOptions, TQueryFunction } from './query.js';

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
  createSkillExecutionPort,
  selectCommandModules,
  findUnknownModuleNames,
  createDefaultRemoteCommandPolicy,
} from './commands/index.js';
export type {} from './capabilities/types.js';
export type { IOrgPolicy } from './command-api/org-policy/index.js';
export {
  loadOrgPolicy,
  formatOrgPolicyViolationMessage,
  isApiKeyPlaintext,
} from './command-api/org-policy/index.js';
export type {
  IAgentJobHostContext,
  ICommandHostAdapters,
  ICommandHostContext,
  ICommandModule,
  IRemoteCommandPolicy,
  ICommandPickerAdapter,
  ICommandProcessAdapter,
  ICommandSessionRuntime,
  IModelReapplyOptions,
  IUnknownCommandModuleName,
  ICommandSettingsAdapter,
  ICommandSettingsDocument,
  ICommandSkillListEntry,
  ISystemCommand,
  TSystemCommandLifecycle,
  ICommandPermissionModeAdapter,
  ICommandRemoteControlAdapter,
  TRemoteControlStatus,
  IForkExecutionOptions,
  ISkillExecutionCallbacks,
  ISkillExecutionResult,
  ISkillActivationHistoryData,
  TCommandModuleSessionRequirement,
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
  IProviderProfileNameSuggestionInput,
  IProviderProfileNameSuggestionOptions,
  ILegacyProviderSettings,
  IProviderProfileSettings,
  IProviderSettingsBuildOptions,
  IProviderSetupInput,
  IProviderSetupPatch,
  TProviderSettingsDocument,
  TSettingsCheck,
  IProviderSwitchOptions,
  IActiveModelChangeOptions,
  IActiveModelChangeResult,
  IProviderSettingsWriteTargetOptions,
  IReadProviderSettingsOptions,
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceRemoveResult,
} from './commands/index.js';
export {
  addCommandContextReference,
  buildProviderProfile,
  buildProviderSetupPatch,
  checkSettingsDocument,
  checkSettingsFile,
  applyProviderConfiguration,
  applyProviderSwitch,
  applyActiveModelChange,
  resolveProviderSettingsWriteTargetPath,
  mergeProviders,
  mergeSettings,
  readMergedProviderSettingsFromPaths,
  resolveActiveProvider,
  createProviderFromSettings,
  ProviderConfigError,
  readMergedProviderSettings,
  readProviderSettings,
  resolveEnvDefaultProvider,
  clearCommandContextReferences,
  deleteProviderProfile,
  formatEnvReference,
  hasUsableSecretReference,
  isEnvReference,
  mergeProviderPatch,
  probeProviderProfile,
  listCommandContextReferences,
  resolveEnvReference,
  sanitizeProviderProfileName,
  setCurrentProvider,
  suggestProviderProfileName,
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
  writeAutoCompactThresholdSetting,
  formatCommandHelpMessage,
  HELP_COMMAND_DESCRIPTION,
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
  applyPresetToSession,
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
  readStatusLineSettings,
  applyStatusLineSettings,
  isCommandMemoryType,
  inspectCommandEditCheckpoint,
  listCommandEditCheckpoints,
  listCommandUsedMemoryReferences,
  recordCommandMemoryEvent,
  restoreCommandEditCheckpoint,
  rollbackCommandEditCheckpoint,
  forkCommandEditCheckpoint,
  switchCommandEditCheckpointBranch,
  listCommandEditCheckpointBranches,
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
  IPresetApplicationOptions,
  IPresetApplicationResult,
  ICommandMemoryStores,
  ICommandPendingMemoryStore,
  ICommandProjectMemoryStore,
  IMemoryCandidate,
  IMemoryPendingRecord,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
  TMemoryCandidateStatus,
  TRecommendedResponseLanguage,
} from './commands/index.js';

// ── User-local storage and memory ──────────────────────────
export {
  USER_LOCAL_MEMORY_CATEGORIES,
  USER_LOCAL_STORAGE_CATEGORIES,
  USER_LOCAL_STORAGE_CATEGORY_DEFINITIONS,
  deleteUserLocalMemoryItem,
  disableUserLocalMemoryItem,
  inspectUserLocalMemoryItem,
  inspectUserLocalStorage,
  listUserLocalMemoryItems,
  readEnabledUserLocalMemoryItem,
  resolveUserLocalStorageRoot,
  setUserLocalMemoryItem,
} from './user-local/index.js';
export type {
  IInspectUserLocalStorageOptions,
  IResolveUserLocalStorageRootOptions,
  IUserLocalMemoryDeleteResult,
  IUserLocalMemoryItemOptions,
  IUserLocalMemoryItemProjection,
  IUserLocalMemoryListOptions,
  IUserLocalMemoryListProjection,
  IUserLocalMemorySetOptions,
  IUserLocalStorageCategoryDefinition,
  IUserLocalStorageCategoryProjection,
  IUserLocalStorageInspection,
  IUserLocalStorageItemSummary,
  TUserLocalMemoryCategory,
  TUserLocalMemoryCommandExecutionEffect,
  TUserLocalStorageCategory,
} from './user-local/index.js';

// ── Skill prompt utilities ───────────────────────────────────
export { substituteVariables, preprocessShellCommands } from './utils/skill-prompt.js';
export type { ISkillPromptContext, TShellExecFn } from './utils/skill-prompt.js';

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
} from './memory/project-memory-store.js';
// SELFHOST-008: the neutral durable-memory port + filesystem reference adapter.
export {
  FileSystemMemoryStore,
  createFileSystemMemoryStore,
} from './memory/file-system-memory-store.js';
export type {
  IMemoryStore,
  IMemoryBudget,
  ISemanticMemoryAdapter,
  ISemanticMemoryQueryResult,
} from './memory/types.js';
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
  TInstalledPluginsRegistry,
} from './plugins/index.js';
export { MarketplaceClient } from './plugins/index.js';
export type {
  TMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
  IKnownMarketplaceEntry,
  TKnownMarketplacesRegistry,
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
export type { ICreateSessionOptions, ICreateSessionResult } from './assembly/index.js';
export { createAgentTool, storeAgentToolDeps, retrieveAgentToolDeps } from './tools/agent-tool.js';
export type { IAgentToolDeps } from './tools/agent-tool.js';
export { createCommandExecutionTool } from './tools/command-execution-tool.js';
export type { ICommandExecutionToolDeps } from './tools/command-execution-tool.js';
export {
  createModelCommandToolProjection,
  createProjectedCommandExecutionTools,
  createProviderSafeModelCommandToolName,
  formatProjectedModelCommandToolPromptDescription,
  MODEL_COMMAND_TOOL_PREFIX,
  normalizeModelCommandName,
  PROVIDER_SAFE_TOOL_NAME_PATTERN,
} from './tools/model-command-tool-projection.js';
export type {
  IModelCommandToolProjection,
  IProjectedCommandExecutionToolsDeps,
  IProjectedModelCommandTool,
} from './tools/model-command-tool-projection.js';
export { createBackgroundProcessTool } from './tools/background-process-tool.js';
export type { IBackgroundProcessToolDeps } from './tools/background-process-tool.js';

// ── Background task runtime contracts ──────────────────────
export {
  BackgroundJobOrchestrator,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createExecutionOriginMetadata,
  createExecutionWorkspaceTaskSpawner,
  createExecutionWorkspaceSnapshot,
  createLineDetailPage,
  createMainThreadDetailPage,
  createMainThreadExecutionEntryId,
  EXECUTION_ORIGIN_METADATA_KEYS,
  parseExecutionWorkspaceEntryId,
  summarizeBackgroundJobGroup,
} from './background-tasks/index.js';
export type {
  IBackgroundTaskHandle,
  IBackgroundTaskManager,
  IBackgroundTaskManagerOptions,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IBackgroundJobOrchestratorOptions,
  IBackgroundTaskSpawnerGroupRequest,
  ICreateExecutionWorkspaceTaskSpawnerOptions,
  IExecutionWorkspaceTaskSpawner,
  ISpawnAgentTaskRequest,
  ISpawnProcessTaskRequest,
  TBackgroundTaskIdFactory,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskTransitionEvent,
  ICreateLimitedOutputCaptureOptions,
  ILimitedOutputCapture,
} from './background-tasks/index.js';

// ── Subagent process manager contracts ─────────────────────
export { createInProcessSubagentRunner } from './subagents/index.js';
export type {
  IInProcessSubagentRunnerDeps,
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
  TSubagentRunnerFactory,
} from './subagents/index.js';

// ── Multi-agent orchestration mechanism (SELFHOST-001) ──────
export {
  runSequential,
  runParallel,
  runHandoff,
  runHierarchical,
  runGroupChat,
} from './orchestration/index.js';
export type {
  ISequentialOrchestratorDeps,
  ISequentialRunContext,
  IParallelOrchestratorDeps,
  IHandoffOrchestratorDeps,
  ResolveHandoff,
  IHierarchicalOrchestratorDeps,
  PlanDelegation,
  IGroupChatOrchestratorDeps,
  SelectNextStep,
  IOrchestrationRunContext,
} from './orchestration/index.js';

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
  IPromptFileReferenceResolveOptions,
  IPromptFileReferenceToken,
  IResolvedPromptFileReference,
  IResolvedPromptFileReferences,
  TPromptFileReferenceDiagnosticCode,
} from './context/prompt-file-references.js';
export type {
  IContextReferenceInventoryLimits,
  IContextReferenceUpsertResult,
} from './context/context-reference-inventory.js';

// ── Interaction channel contracts: SSOT is @robota-sdk/agent-interface-transport ─────
// (HARNESS-022 / CONTRACT-013: the residual type-only pass-through re-exports were removed;
// consumers import IInteractionChannel/InteractionEvent/ICommandInfo from the SSOT.)
export { parseInput, isSlashCommand, tokeniseSlashCommand } from './interaction/input-parser.js';
export type { TParsedInput } from './interaction/input-parser.js';
export type { IInteractiveRuntime } from './interaction/InteractiveRuntime.js';
export { createInteractiveRuntime } from './interaction/createInteractiveRuntime.js';
export type { IInteractiveRuntimeOptions } from './interaction/createInteractiveRuntime.js';

// ── Permissions ─────────────────────────────────────────────
export { promptForApproval } from './permissions/permission-prompt.js';

// ── Testing utilities ────────────────────────────────────────
// Test-only fixtures (the functional session harness + stub session) are exported from the
// `@robota-sdk/agent-framework/testing` subpath, not the runtime entry, so they stay out of the
// runtime bundle (TEST-003).

// ── Settings I/O ─────────────────────────────────────────────
export {
  getUserSettingsPath,
  resolveSettingsPathForScope,
  readSettings,
  writeSettings,
  updateModelInSettings,
  deleteSettings,
} from './config/settings-io.js';
export type { TSettingsData, TSettingsScope } from './config/settings-io.js';
export { SettingsParseError } from './config/settings-parse-error.js';
export { resetUserConfig } from './config/reset-user-config.js';
export type { IResetUserConfigResult } from './config/reset-user-config.js';

// ── Provider settings paths ──────────────────────────────────
export { getProviderSettingsPaths } from './config/provider-paths.js';

// ── Git utilities ─────────────────────────────────────────────
export { resolveGitBranch } from './git/git-branch.js';

// ── Semver comparison ─────────────────────────────────────────
export { compareSemverVersions, isNewerSemverVersion } from './utils/semver-compare.js';

// ── Package version ───────────────────────────────────────────
export { readPackageVersion } from './utils/read-package-version.js';

// ── CLI update check ──────────────────────────────────────────
export {
  checkForCliUpdate,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  getStartupCliUpdateNotice,
  getUserUpdateCheckCachePath,
  readUpdateCheckCache,
  shouldRunStartupCliUpdateCheck,
  writeUpdateCheckCache,
  CLI_UPDATE_CACHE_TTL_MS,
  CLI_UPDATE_PACKAGE_NAME,
  CLI_UPDATE_REGISTRY_URL,
  CLI_UPDATE_TIMEOUT_MS,
} from './update-check/update-check.js';
export type {
  ICheckForCliUpdateOptions,
  ICliUpdateNotice,
  IStartupCliUpdatePolicyInput,
  IUpdateCheckCache,
  TCliUpdateCheckResult,
} from './update-check/update-check.js';

// ── Agent runtime ─────────────────────────────────────────────
export { createAgentRuntime, createStatelessRuntime } from './runtime/index.js';
export type {
  IAgentRuntimeConfig,
  IAgentRuntime,
  IHeadlessSessionOptions,
  IStatelessRuntimeConfig,
} from './runtime/index.js';
// RUNTIME-001: the shared, presentation-free runtime host (build session + transport lifecycle).
export { buildRuntimeSession, startRuntimeHost } from './runtime/index.js';
export type { IRuntimeHostOptions, IRuntimeHostHandle } from './runtime/index.js';
export type { IResolvedConfig } from './config/config-types.js';

// SELFHOST-006: per-role model routing policy (neutral, over the provider DIP).
export {
  resolveRoleModel,
  resolveRoleFallbackChain,
  runWithRoleFallback,
} from './routing/role-model-routing.js';

// ──────────────────────────────────────────────────────────────
// INTERNAL (not exported):
//   createSession()        — assembly factory
//   createProvider()       — REMOVED (provider comes from consumer)
//   loadConfig()           — config loading (used by InteractiveSession internally)
//   loadContext()          — context loading (used by InteractiveSession internally)
// ──────────────────────────────────────────────────────────────
