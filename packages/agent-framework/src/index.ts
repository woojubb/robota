// @robota-sdk/agent-framework — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

// Runtime-host implementations (STRUCT-012): these symbols are owned here.
export { HeadlessInteractionChannel } from './transport-host/headless/HeadlessInteractionChannel.js';
export type { IHeadlessInteractionChannelOptions } from './transport-host/headless/HeadlessInteractionChannel.js';
export { createHeadlessRunner, OUTPUT_FORMATS } from './transport-host/headless/headless-runner.js';
export type {
  IHeadlessRunnerOptions,
  TOutputFormat,
} from './transport-host/headless/headless-runner.js';
export { createHeadlessTransport } from './transport-host/headless/headless-transport.js';
export type {
  IHeadlessTransport,
  IHeadlessTransportOptions,
} from './transport-host/headless/headless-transport.js';
export type { IHeadlessSession } from './transport-host/headless/headless-session.js';
export { ProgrammaticInteractionChannel } from './transport-host/programmatic/ProgrammaticInteractionChannel.js';
export { createProgrammaticAgent } from './transport-host/programmatic/createProgrammaticAgent.js';
export type { ICreateProgrammaticAgentOptions } from './transport-host/programmatic/createProgrammaticAgent.js';
export { TransportRegistry } from './transport-host/transport-registry.js';
export { bindTransportAdapter } from './transport-host/bind-transport-adapter.js';
export {
  createFileTransportSettingsRepository,
  createMemoryTransportSettingsRepository,
} from './transport-host/transport-settings-repository.js';

// ── Explicit workspace project authority (ARCH-042) ────────
export {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustService,
  createNodeWorkspaceTrustStore,
  inspectPreTrustProjectPaths,
  assertWorkspaceProjectAuthority,
  assertWorkspaceProjectReader,
  assertWorkspaceProjectMutation,
  assertWorkspaceProjectMutationForAuthority,
  createWorkspaceProjectMutation,
  assertWorkspaceProjectSettingsWriter,
  assertWorkspaceProjectStateStorage,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
  supportsWorkspaceProjectMutation,
} from './workspace-trust/index.js';
export type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceTrustCause,
  IPreTrustProjectPathInspection,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectReader,
  IWorkspaceProjectMutation,
  IWorkspaceProjectSettingsWriter,
  IWorkspaceProjectStateStorage,
  IWorkspaceTrustServiceOptions,
  IWorkspaceTrustGrant,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceContributionKind,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectAccess,
  TWorkspaceProjectSettingsTarget,
  TWorkspaceProjectSettingsWriteDecision,
  TWorkspaceProjectMutationDecision,
  TWorkspaceProjectStateNamespace,
  TWorkspaceProjectStateDirectories,
  TWorkspaceTrustState,
} from './workspace-trust/index.js';

// ── InteractiveSession (primary API) ────────────────────────
export {
  InteractiveSession,
  PeerMessageIngress,
  ExternalEventIngress,
  ExternalEventGrantHistory,
  createExternalEventGrantHistory,
} from './interactive/index.js';
export { withUniqueSessionName } from './interactive/interactive-session-fork-record.js';
// TERM-001: a client attached to a runtime in another process hands its own terminal to the
// client-run commands (`/shell`, `/editor`) through the same gate the session uses.
export { SessionTerminalHandoffGate } from './interactive/interactive-session-terminal-handoff.js';
export type {
  IExternalEventSourceOptions,
  IExternalEventSource,
  TExternalEventReceipt,
  TExternalEventSettlement,
} from './interactive/index.js';

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
  createNodeHostSessionStore,
  createNodeToolResultSpillStore,
  createUserSessionStore,
  createUserPromptHistoryFile,
  isSafeSessionId,
  listResumableSessionSummaries,
  listUnreadableSessions,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  generateSessionName,
  restoreSessionRecordIntoSession,
  WorkspaceProjectSessionStore,
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
} from './interactive/index.js';
export type {
  IHostToolResultSpillStore,
  ISessionRecordRestoreResult,
} from './interactive/index.js';
export type {
  TInteractiveSessionOptions,
  ILivePromptTracePort,
  IInteractiveSessionShutdownOptions,
  IGenerateSessionNameOptions,
} from './interactive/index.js';
export type { IProviderErrorGuidance } from './utils/error-humanizer.js';

// ── createQuery() factory (convenience API) ─────────────────
export { createQuery } from './query.js';
export type { ICreateQueryOptions, TQueryFunction } from './query.js';

export {
  CommandRegistry,
  BuiltinCommandSource,
  createBuiltinCommandModule,
  SkillCommandSource,
  inspectSkillSources,
  PluginCommandSource,
  SystemCommandExecutor,
  createSystemCommands,
  executeSkill,
  createSkillExecutionPort,
  selectCommandModules,
  findUnknownModuleNames,
  createDefaultRemoteCommandPolicy,
  DuplicateSystemCommandSemanticRoleError,
} from './commands/index.js';
export type {} from './capabilities/types.js';
export type { IOrgPolicy } from './command-api/org-policy/index.js';
export type { ICommandCostBudget, ICommandCostBudgetAdapter } from './command-api/index.js';
export {
  loadOrgPolicy,
  formatOrgPolicyViolationMessage,
  isApiKeyPlaintext,
  OrgPolicyParseError,
} from './command-api/org-policy/index.js';
export type {
  IAgentJobHostContext,
  ICommandHostAdapters,
  ICommandEffortAdapter,
  ICommandHandoffAdapter,
  ICommandWorkspaceAdapter,
  IWorkspaceMoveRequest,
  ICommandHostContext,
  IHandoffProgress,
  IHandoffStaysBehind,
  ILinkedDeviceSummary,
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
  ISystemCommandSemanticRoles,
  TSystemCommandLifecycle,
  TSystemCommandSemanticRole,
  ICommandPermissionModeAdapter,
  ICommandPermissionRulesAdapter,
  ICommandSandboxAdapter,
  ICommandSandboxStatus,
  ICommandExternalEventGrant,
  ICommandExternalEventsAdapter,
  TSandboxCommandMode,
  IPermissionRuleLayer,
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPSourceProblem,
  ICommandMCPOAuthStatus,
  ICommandMCPOAuthLogoutResult,
  ICommandMCPOAuthLoginRequest,
  ICommandMCPOAuthLoginResult,
  ICommandMCPOAuthRedirectPrompt,
  ICommandOutputStyleRegistryAdapter,
  ICommandOutputStyleSummary,
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
  IReadProviderSettingsOptions,
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceRemoveResult,
  IAppearanceSettings,
  TAppearanceSettingsPatch,
} from './commands/index.js';
export {
  ADVISOR_OFF,
  ADVISOR_TOOL_NAME,
  AdvisorController,
  createAdvisorTool,
  describeProviderDestination,
  formatAdvisorSpec,
  parseAdvisorSpec,
  providerDestinationOf,
  rememberProviderDestination,
  resolveStartupAdvisorSpec,
} from './advisor/index.js';
export type {
  IAdvisorConsentStore,
  IAdvisorControllerOptions,
  IAdvisorSetResult,
  IAdvisorSpec,
  IAdvisorStatus,
  IAdvisorTarget,
  ICommandAdvisorAdapter,
  TAdvisorTargetResolver,
} from './advisor/index.js';
export type { ISessionUsageRecord } from './command-api/session/session-usage.js';
export { parseModelEffort, resolveModelEffort } from './effort/index.js';
export type {
  IModelEffortInputs,
  IModelEffortResolution,
  TEffortDisposition,
  TEffortSelection,
  TEffortSource,
} from './effort/index.js';
export {
  addCommandContextReference,
  buildProviderProfile,
  buildProviderSetupPatch,
  checkSettingsDocument,
  checkNodeHostSettingsFile,
  applyProviderConfiguration,
  applyProviderSwitch,
  applyActiveModelChange,
  resolveProviderSettingsWriteTarget,
  mergeProviders,
  mergeSettings,
  readMergedProviderSettingsFromSources,
  resolveActiveProvider,
  createProviderFromSettings,
  ProviderConfigError,
  readMergedProviderSettings,
  readProviderSettings,
  resolveEnvDefaultProvider,
  clearCommandContextReferences,
  deleteProviderProfile,
  mergeProviderPatch,
  probeProviderProfile,
  listCommandContextReferences,
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
  groupPermissionRulesBySource,
  RUNTIME_RULE_SOURCE,
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
  retryCommandPermissionDenial,
  applyPresetToSession,
  buildStatusLineCommandSubcommands,
  buildPluginCommandSubcommands,
  createShowPluginManagerIntent,
  clearConversationHistory,
  createShowSessionPickerIntent,
  createSessionRenameHostAction,
  CLEAR_COMMAND_DESCRIPTION,
  COST_COMMAND_DESCRIPTION,
  createSessionExitHostAction,
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
  DEFAULT_STATUS_LINE_COMMAND_SETTINGS,
  hasSensitiveCommandMemoryContent,
  isStatusLineCommandSettingsPatch,
  readStatusLineSettings,
  applyStatusLineSettings,
  APPEARANCE_SETTINGS_KEYS,
  applyAppearanceSettings,
  DEFAULT_APPEARANCE_SETTINGS,
  isAppearanceSettingsPatch,
  readAppearanceSettings,
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
  IPermissionRuleGroup,
  IPermissionsCommandState,
  TPermissionRuleKind,
  IPresetApplicationOptions,
  IPresetApplicationResult,
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
  WorkspaceMemoryStore,
  createWorkspaceMemoryStore,
  SemanticMemoryStore,
  createSemanticMemoryStore,
  DEFAULT_MEMORY_EXTRACTOR_POLICY,
  RegexMemoryCandidateExtractor,
  approvePendingMemoryCandidate,
} from './memory/index.js';
export type {
  IApprovedMemoryCandidate,
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
  IMemoryStore,
  IDurableMemoryReader,
  IMemoryWriter,
  IMemoryRecaller,
  IMemoryCurationQueue,
  IMemoryBudget,
  IPerTurnRecallConfig,
  ISemanticMemoryAdapter,
  ISemanticMemoryQueryResult,
  IAutomaticMemoryConfig,
  TMemoryPolicyMode,
  IMemoryCandidateExtractor,
  IMemoryExtractorPolicy,
  IMemoryExtractorTrigger,
} from './memory/index.js';
// ── Prompt history (SCREEN-1993) ────────────────────────────
export type { IPromptHistoryOptions } from './interactive/interactive-session-prompt-history.js';
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
  ISelfHostingCommandTemplates,
  ISelfHostingVerificationPlan,
  ISelfHostingVerificationPlanInput,
  ISelfHostingVerificationStep,
  TSelfHostingLoopEvent,
  TSelfHostingLoopState,
  TSelfHostingVerificationPhase,
} from './self-hosting/index.js';

// ── Evals ─────────────────────────────────────────────────
export { defineEval, runEval, createSessionRunFn } from './evals/index.js';
export {
  exactMatch,
  includesText,
  regexMatch,
  responseIsJson,
  usedTool,
  parseEvalCases,
  formatEvalReport,
} from './evals/index.js';
export type {
  IEvalCase,
  IEvalCaseResult,
  IEvalDefinition,
  IEvalMetricScore,
  IEvalReport,
  IMetric,
  TEvalRunFn,
} from './evals/index.js';

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
export {
  NodeHostPluginSettingsStore,
  BundlePluginLoader,
  createHostBundlePluginLoader,
  loadHostBundlePluginInspectionFromScopes,
  loadHostBundlePluginsFromScopes,
} from './plugins/index.js';
export type { IHostBundlePluginLoaderOptions } from './plugins/index.js';
export type { IPluginSettings } from './plugins/index.js';
export { BundlePluginInstaller } from './plugins/index.js';
export { MarketplaceClient } from './plugins/index.js';
export type {
  IBundlePluginInstallerOptions,
  IInstalledPluginRecord,
  TInstalledPluginsRegistry,
  TMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
  IKnownMarketplaceEntry,
  TKnownMarketplacesRegistry,
  IBundlePluginFeatures,
  IBundlePluginHookIssue,
  IBundlePluginInspection,
  IBundlePluginManifest,
  IBundlePluginMcpFault,
  IBundlePluginMcpServer,
  IBundlePluginSkip,
  IBundleSkill,
  ILoadedBundlePlugin,
  TBundlePluginSkipReason,
  TEnabledPlugins,
} from './plugins/index.js';

export type { IAgentDefinition } from './agents/index.js';
export { BUILT_IN_AGENTS } from './agents/index.js';

export {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
  createSubagentSession,
  createSubagentLogger,
  resolveSubagentLogDir,
  deriveContextCapacityHint,
} from './assembly/index.js';
export type {
  ISubagentPromptOptions,
  ISubagentOptions,
  ISubagentParentContext,
  TSubagentSuffix,
} from './assembly/index.js';
// `ICreateSessionOptions` stays exported although `createSession` does not (issue #2270).
//
// It is agent-framework's OWN type, and four packages read indexed-access types off it as the option
// SSOT: agent-preset, agent-cli, agent-transport, agent-ui-terminal. Exporting a type this package
// owns is ownership, not pass-through.
//
// The tempting alternative — re-export `agent-core`'s `TPermissionMode` / `TModelEffort` from here so
// the options type can go — is banned as a pass-through re-export of another package's symbols
// (STRUCT-07). Consumers that want those unions take them from `agent-core`, which exports both from
// its root. NOTE for anyone re-deriving this: an earlier version of this comment claimed
// `TPermissionMode` is exported from no package root. That was false — agent-core's root re-exports
// its permissions barrel wholesale (a star re-export), so the symbol never appears BY NAME in that
// index and a grep for the name cannot see it. Resolve exports against the built .d.ts instead of
// grepping barrels.
//
// Written without the literal re-export syntax on purpose: `check-sdk-public-surface.mjs` (scan id
// `sdk-public-surface`) matches raw source, so spelling it out here registers a phantom export-star
// in this barrel and fails that scan.
// That is issue #2258's defect — comment text read as code — arriving from the other direction.
//
// The type is inert without the factory: no exported function accepts it, so nothing public reaches
// `additionalHookExecutors` through it.
//
// `ICreateSessionResult` is no longer re-exported from this root (it stays on `assembly/index.ts`).
// The ground is not that it had few consumers — `.agents/project-structure.md` bans that reasoning
// about a public surface at any count. It is the return type of a factory that is no longer public,
// so it describes nothing a consumer can obtain.
export type { ICreateSessionOptions, TSessionResponseFormat } from './assembly/index.js';
// MCP-004 §S3: the `toolCallHandoff` policy shape reachable from `ICreateSessionOptions` — the ONLY
// barrel addition this unit makes; `buildToolCallHandoff`, the wrapper class and
// `unwrapToolCallHandoff` stay off the barrel (`tool-call-handoff.ts`'s own module doc).
export type { IToolCallHandoffPolicy, IToolCallHandoffProvenance } from './assembly/index.js';
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
  // CLI-1994: a surface asks this whether an entry can be attached to; the answer is the framework's
  // because the same module decides when the `attach` control is offered.
  resolveExecutionAttach,
  summarizeBackgroundJobGroup,
} from './background-tasks/index.js';
export type {
  IResolveExecutionAttachInput,
  TExecutionAttachOutcome,
} from './background-tasks/execution-workspace-attach.js';
// ARCH-039: nine `agent-executor` names were re-exported here through the background-tasks barrel
// and had NO external importer — this barrel was their only consumer, re-publishing what nothing
// asked for. The per-symbol exemption made that visible; they are imported from
// `@robota-sdk/agent-executor` by anyone who needs them.
export type {
  IBackgroundTaskRunner,
  IBackgroundJobOrchestratorOptions,
  IBackgroundTaskSpawnerGroupRequest,
  ICreateExecutionWorkspaceTaskSpawnerOptions,
  IExecutionWorkspaceTaskSpawner,
  ISpawnAgentTaskRequest,
  ISpawnProcessTaskRequest,
} from './background-tasks/index.js';

// ── Subagent process manager contracts ─────────────────────
export { createInProcessSubagentRunner } from './subagents/index.js';
// ARCH-031 removed eleven type-only `agent-executor` republications. Import from the owner: the SPI
// from `@robota-sdk/agent-executor`, data contracts from `@robota-sdk/agent-interface-execution`.
export type { IInProcessSubagentRunnerDeps, TSubagentRunnerFactory } from './subagents/index.js';

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

// ── Plugin scope path ──────────────────────────────────────

// ── Explicit project/host contribution sources ─────────────
export {
  createContributionSourcesForProjectAccess,
  createDefaultUserContributionSources,
  createNodeHostContributionSource,
  createWorkspaceProjectContributionSource,
  listFrameworkProjectContributionPaths,
} from './contributions/index.js';
export type { IContributionSource, IProjectContributionPath } from './contributions/index.js';

// ── Task context ───────────────────────────────────────────
export {
  discoverTaskFiles,
  formatTaskContext,
  loadTaskContext,
  parseTaskFile,
  readCurrentGitBranchFromNodeHost,
  selectRelevantTasks,
} from './context/task-context.js';
export type {
  ITaskContextFile,
  ITaskSelectionOptions,
  TTaskFileStatus,
} from './context/task-context.js';
export type { ILoadContextOptions } from './context/context-loader.js';

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

// ── Interaction channel contracts: SSOT is @robota-sdk/agent-interface-session ─────
// (HARNESS-022 / CONTRACT-013: the residual type-only pass-through re-exports were removed;
// consumers import IInteractionChannel/InteractionEvent/ICommandInfo from the SSOT.)
export { parseInput, isSlashCommand, tokeniseSlashCommand } from './interaction/input-parser.js';
export type { TParsedInput } from './interaction/input-parser.js';
export type { IInteractiveRuntime } from './interaction/InteractiveRuntime.js';
export { createInteractiveRuntime } from './interaction/createInteractiveRuntime.js';
export type { IInteractiveRuntimeOptions } from './interaction/createInteractiveRuntime.js';

// ── Permissions ─────────────────────────────────────────────
// Issue #2351: `consentScopeFor` is what "allow always" grants, so every prompt surface prints the
// same scope — the framework's own facade over agent-session's rule (see permission-prompt.ts).
export { consentScopeFor, promptForApproval } from './permissions/permission-prompt.js';

// ── Testing utilities ────────────────────────────────────────
// Test-only fixtures (the functional session harness + stub session) are exported from the
// `@robota-sdk/agent-framework/testing` subpath, not the runtime entry, so they stay out of the
// runtime bundle (TEST-003).

// ── Settings I/O ─────────────────────────────────────────────
export {
  createNodeHostSettingsSource,
  createWorkspaceProjectSettingsSources,
  readSettingsSourceText,
} from './config/settings-source.js';
export type {
  INodeHostSettingsSource,
  IProjectSettingsPath,
  IWorkspaceProjectSettingsSource,
  THostSettingsScope,
  TProjectSettingsScope,
  TSettingsSource,
} from './config/settings-source.js';
export {
  createNodeHostSettingsStore,
  createWorkspaceProjectSettingsStore,
} from './config/settings-store.js';
export type { ISettingsDocumentStore } from './config/settings-store.js';
export {
  readSettings,
  writeSettings,
  updateModelInSettings,
  deleteSettings,
} from './config/settings-io.js';
export type { TSettingsData, TSettingsScope } from './config/settings-io.js';
export { inspectSettingsLayers } from './config/settings-inspection.js';
export {
  createSettingsPermissionRulesAdapter,
  readPermissionRuleLayers,
} from './config/permission-rule-layers.js';
export type {
  ISettingsInspection,
  ISettingsKeyProvenance,
  ISettingsLayerCause,
  ISettingsLayerInspection,
  ISettingsSchemaIssue,
  TSettingsLayerState,
} from './config/settings-inspection.js';
export type { TSettingsMergeRule } from './config/config-merge.js';
export type { TSandboxSettings, TSettings } from './config/config-types.js';
export type {
  ISkillRootDescriptor,
  ISkillRootInspection,
  ISkillSourceInspection,
  ISkillSourceSkip,
  TSkillSkipReason,
} from './commands/index.js';
export { SettingsParseError } from './config/settings-parse-error.js';
export { NoCurrentProviderProfileError } from './config/no-current-provider-profile-error.js';
export { resetUserConfig } from './config/reset-user-config.js';
export type { IResetUserConfigResult } from './config/reset-user-config.js';

// ── Git utilities ─────────────────────────────────────────────
export { resolveGitBranchFromNodeHost } from './git/git-branch.js';

// ── Semver comparison ─────────────────────────────────────────
export { compareSemverVersions, isNewerSemverVersion } from './utils/semver-compare.js';
export { trimTrailingChars } from './utils/trim-char.js';

// ── Package version ───────────────────────────────────────────
export { readPackageVersion } from './utils/read-package-version.js';

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
export { SessionSlot } from './runtime/index.js';
export type { ISessionSlotOptions, IRuntimeHostPoolOptions } from './runtime/index.js';
export {
  SessionPool,
  isSessionBusy,
  SESSION_POOL_MAX_LIVE,
  SESSION_POOL_IDLE_GRACE_MS,
  SessionChangeRefusal,
} from './runtime/index.js';
export type {
  ISessionPoolOptions,
  ISessionPoolBinding,
  ISessionPoolEntry,
  ISessionLease,
  TPoolBusySession,
  TSessionPoolRole,
} from './runtime/index.js';
export type { IResolvedConfig } from './config/config-types.js';
export type { IOutputStylePrompt } from './context/output-style-prompt.js';

// SELFHOST-006: per-role model routing policy (neutral, over the provider DIP).
export {
  resolveRoleModel,
  resolveRoleFallbackChain,
  runWithRoleFallback,
} from './routing/role-model-routing.js';
export { FallbackProvider } from './routing/fallback-provider.js';
export type {
  IFallbackModelTarget,
  IFallbackProviderOptions,
} from './routing/fallback-provider.js';
export {
  applyModelFallback,
  FALLBACK_MODEL_SETTINGS_KEY,
  MAX_FALLBACK_MODELS,
  describeModelFallback,
  parseFallbackModelList,
  readFallbackModelSetting,
  resolveModelFallbackChain,
  selectFallbackModelEntries,
} from './routing/model-fallback-chain.js';
export type {
  IApplyModelFallbackInput,
  IModelFallbackChain,
  IModelFallbackPrimary,
  IResolveModelFallbackChainInput,
} from './routing/model-fallback-chain.js';

// ──────────────────────────────────────────────────────────────
// INTERNAL (not exported):
//   createProvider()       — REMOVED (provider comes from consumer)
//   createSession()        — assembly factory (restored to this ledger by issue #2270; the entry
//                            was deleted by 2d3b2c028 in the same commit that made it public)
//   loadConfig()           — config loading (used by InteractiveSession internally)
//   loadContext()          — context loading (used by InteractiveSession internally)
// ──────────────────────────────────────────────────────────────

// ARCH-029: the command-axis role ports. Named explicitly (the barrels carry no `export *` —
// sdk-public-surface enforces that, so owner boundaries stay auditable) and sourced straight from
// the contract module rather than through ./commands, which keeps that barrel under its size floor.
export type {
  IAgentJobDispatch,
  IAgentJobGroups,
  IAgentJobLogs,
  IAgentJobMonitors,
  IAgentJobSchedules,
  ICommandHostAdapterAccess,
  ICommandHostAgentJobs,
  ICommandHostBackgroundTasks,
  ICommandHostCatalog,
  ICommandHostCheckpoints,
  ICommandHostContextReferences,
  ICommandHostContextWindow,
  ICommandHostGoal,
  ICommandHostMemory,
  ICommandHostNoCapability,
  ICommandHostPlan,
  ICommandHostPresetApplication,
  ICommandHostSessionAccess,
  ICommandHostTerminalHandoff,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
  ICommandSessionContextWindow,
  ICommandSessionHistory,
  ICommandSessionIdentity,
  ICommandSessionModel,
  ICommandSessionPermissions,
  ICommandSessionPreset,
} from './command-api/host-context.js';
export { MONITOR_SHELL_TOOL, MonitorCommandRefusedError } from './command-api/agent-job-roles.js';
