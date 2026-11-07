// @robota-sdk/agent-framework — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

export { decodeFrontmatterJson } from './frontmatter/frontmatter-json.js';
export { decodeFrontmatter } from './frontmatter/frontmatter-decoder.js';
export type { TFrontmatterJsonResult } from './frontmatter/frontmatter-json.js';

// Runtime-host implementations (STRUCT-012): these symbols are owned here.
export { HeadlessInteractionChannel } from './transport-host/headless/HeadlessInteractionChannel.js';
export type { IHeadlessInteractionChannelOptions } from './transport-host/headless/HeadlessInteractionChannel.js';
export { createHeadlessRunner, OUTPUT_FORMATS } from './transport-host/headless/headless-runner.js';
export type {
  IHeadlessOutput,
  IHeadlessRunnerOptions,
  IHeadlessTextSink,
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
export { createMemoryTransportSettingsRepository } from './transport-host/memory-transport-settings-repository.js';

// ── The platform the host lends: the `host` every session, runtime and query takes ────────
export type { IAsyncScope, IFrameworkHost } from './host/framework-host.js';

// ── Explicit workspace project authority (ARCH-042) ────────
export {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
  assertWorkspaceProjectAuthority,
  assertWorkspaceProjectReader,
  assertWorkspaceProjectMutation,
  assertWorkspaceProjectMutationForAuthority,
  createWorkspaceProjectMutation,
  prepareWorkflowJsonMutation,
  assertWorkspaceProjectSettingsWriter,
  assertWorkspaceProjectStateStorage,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from './workspace-trust/index.js';
export type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceTrustCause,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectFiles,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectReader,
  IWorkspaceProjectMutation,
  IWorkspaceProjectSettingsWriter,
  IWorkspaceProjectStableWriter,
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
  isLoopStopVerb,
} from './interactive/index.js';
export { withUniqueSessionName } from './interactive/interactive-session-fork-record.js';
// TERM-001: a client attached to a runtime in another process hands its own terminal to the
// client-run commands (`/shell`, `/editor`) through the same gate the session uses.
export { SessionTerminalHandoffGate } from './interactive/interactive-session-terminal-handoff.js';
export type {
  IExternalEventTokenClaim,
  IExternalEventTokenClaimStore,
  IExternalEventSourceOptions,
  IExternalEventSource,
  TExternalEventTokenClaimResult,
  TExternalEventReceipt,
  TExternalEventSettlement,
} from './interactive/index.js';

// ── Autonomous goal pursuit (GOAL-001) ──────────────────────
export {
  GoalController,
  extractGoalSignal,
  isGoalCancelVerb,
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
  ambiguousSessionNameMessage,
  decorateSessionStore,
  isSafeSessionId,
  isSessionLocked,
  listResumableSessionSummaries,
  listResumableSessions,
  listUnreadableSessions,
  listUnreadableSessionsForWorkspace,
  lockedSessionMessage,
  lockedSessionReason,
  lockedSessionsNotice,
  resolveLatestSessionId,
  resolveReusableEmptySessionId,
  resolveSessionIdByIdOrName,
  scanSessionStore,
  generateSessionName,
  restoreSessionRecordIntoSession,
  restoredScheduleDisposition,
  resumeRefusal,
  SessionAuthorshipRefusedError,
  OWNER_SANDBOX_REVIEW_UNAVAILABLE,
  UNVERIFIED_SESSION_QUESTION,
  isSessionAuthorshipRefusedError,
  unacceptableSessionMessage,
  unverifiedSessionNotice,
  SessionRenameUnavailableError,
  persistSessionRename,
} from './interactive/index.js';
export type {
  IHostToolResultSpillStore,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  ISessionRecordRestoreResult,
  TLockedSessionReason,
  TSessionAuthorshipRefusal,
  TSessionIdResolution,
  TSessionLoadOutcome,
  TSessionStoreOverrides,
  TRestoredScheduleDisposition,
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
  createSkillCommand,
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
  IPermissionRuleRemoval,
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
  IProviderConnectionRequest,
  IProviderConnectionHost,
  TProviderConnectionStage,
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
  TProviderEnvironment,
  IModelListSelection,
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
export { EFFORT_LEVEL_LABELS, parseModelEffort, resolveModelEffort } from './effort/index.js';
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
  resolveProviderEnvironment,
  buildModelListSnapshot,
  resolveModelListSelection,
  buildProviderProfilesSnapshot,
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
  PERMISSION_MODE_LABELS,
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
  readCommandEditCheckpointListing,
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
export {
  EditCheckpointNumberingExhaustedError,
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
  editCheckpointsLockedMessage,
  EditCheckpointsUnavailableError,
  wrapEditCheckpointTools,
} from './checkpoints/index.js';
export type {
  TEditCheckpointsUnavailableReason,
  TEditCheckpointUnreadableReason,
  IEditCheckpointFileInspection,
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointListing,
  IEditCheckpointManifest,
  IEditCheckpointRecorder,
  IEditCheckpointRestoreResult,
  IEditCheckpointStore,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
  IEditCheckpointUnreadableCounts,
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
export { BUILT_IN_AGENTS, DEFAULT_AGENT_DEFINED_IN, DEFAULT_AGENT_TYPE } from './agents/index.js';

export {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
  createSubagentSession,
  sandboxApprovalFor,
  deriveContextCapacityHint,
} from './assembly/index.js';
export type {
  ISubagentPromptOptions,
  ISubagentOptions,
  ISubagentParentContext,
  TSubagentSuffix,
} from './assembly/index.js';
// The framework owns this options type even though its session factory is not public.
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
  // CLI-1994: a surface asks this what attaching to an entry does; the answer is the framework's
  // because the same table (`attachKind`) decides when the `attach` control is offered.
  attachKind,
  liveBackgroundJobCount,
  resolveExecutionAttach,
  summarizeBackgroundJobGroup,
} from './background-tasks/index.js';
export type {
  IHostAttachFacts,
  IStoreAttachFacts,
  TExecutionAttachFacts,
  TExecutionAttachKind,
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
  createWorkspaceProjectContributionSource,
  listFrameworkProjectContributionPaths,
} from './contributions/index.js';
export type {
  IContributionSource,
  IProjectContributionPath,
  IContributionDescriptor,
} from './contributions/index.js';
export { describeBundleContribution } from './contributions/index.js';

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
  createWorkspaceProjectSettingsSources,
  readSettingsSourceText,
} from './config/settings-source.js';
export type {
  IHostSettingsSource,
  IProjectSettingsPath,
  IWorkspaceProjectSettingsSource,
  THostSettingsScope,
  TProjectSettingsScope,
  TSettingsSource,
} from './config/settings-source.js';
export { createWorkspaceProjectSettingsStore } from './config/settings-store.js';
export type { ISettingsDocumentStore, TSettingsData } from './config/settings-store-types.js';
export type { TSettingsScope } from './config/settings-scope-types.js';
export { inspectSettingsLayers } from './config/settings-inspection.js';
export {
  createSettingsPermissionRulesAdapter,
  readPermissionRuleLayers,
  removePermissionRule,
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

// ── Git utilities ─────────────────────────────────────────────
// BEHAVIOR-2437 / #3282 §4c: the git process port and the `/git status` + `/git diff` readers moved
// here from `agent-command` (which depends on this package, never the reverse) so the Project panel's
// session-level reads and the `/git` command run through the exact SAME functions — never a second,
// possibly-drifting implementation of "what changed" or "what does this diff show".
export {
  executeGitDiff,
  executeGitStatus,
  formatGitStatus,
  gitDiffArgv,
  gitFailureMessage,
  isNotAGitRepositoryFailure,
  parseGitDiffArgs,
  parseStatusPorcelainV2,
  parseStatusRecords,
  parseUnifiedDiffLines,
  readProjectGitDiff,
  readProjectGitStatus,
  GIT_DIFF_USAGE,
  GIT_STATUS_ARGS,
  MAX_PROJECT_DIFF_LINES,
  MAX_STATUS_FILES,
} from './git/index.js';
export type {
  IGitDiffArgs,
  IGitProcessPort,
  IGitProcessRunOptions,
  IGitStatusSummary,
  IParsedGitStatus,
  IProjectGitStatusFile,
  IRawGitStatusRecord,
  TGitDiffTarget,
  TGitProcessFailureReason,
  TGitProcessOutcome,
  TParseGitDiffArgs,
  TProjectFileStatus,
  TProjectGitDiffResult,
  TProjectGitStatusResult,
  TRawGitStatusRecordKind,
} from './git/index.js';

// ── Semver comparison ─────────────────────────────────────────
export { compareSemverVersions, isNewerSemverVersion } from './utils/semver-compare.js';
export { trimTrailingChars } from './utils/trim-char.js';

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
  SESSION_STILL_CLOSING_MESSAGE,
  SessionChangeRefusal,
  SessionDeleteRefusal,
  claimChangeRefusal,
  claimDeleteRefusal,
  claimedSessionMessage,
  claimRefusalMessage,
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

// Command-axis role ports come directly from the contract module.
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
  ICommandProductVocabulary,
  ICommandHostPlan,
  ICommandHostPresetApplication,
  ICommandHostSessionAccess,
  ICommandHostSetupState,
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
