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
  ICommandModule,
  ICommandSource,
  ISystemCommand,
  ICommandResult,
  IForkExecutionOptions,
  ISkillExecutionCallbacks,
  ISkillExecutionResult,
  TCommandModuleSessionRequirement,
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
  BackgroundTaskManager,
  getBackgroundTaskTransitions,
  isTerminalBackgroundTaskStatus,
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
