// @robota-sdk/agent-sdk — Universal AI agent SDK
// Provider-neutral. InteractiveSession is the single entry point.

// ── InteractiveSession (primary API) ────────────────────────
export { InteractiveSession } from './interactive/index.js';
export type {
  IInteractiveSessionOptions,
  IToolState,
  IDiffLine,
  IExecutionResult,
  IToolSummary,
  TInteractivePermissionHandler,
  TInteractiveEventName,
  IInteractiveSessionEvents,
} from './interactive/index.js';

// ── createQuery() factory (convenience API) ─────────────────
export { createQuery } from './query.js';
export type { ICreateQueryOptions } from './query.js';

// ── Command system (managed by InteractiveSession) ──────────
export {
  CommandRegistry,
  BuiltinCommandSource,
  SkillCommandSource,
  parseFrontmatter,
} from './commands/index.js';
export type { ICommand, ICommandSource, ISystemCommand, ICommandResult } from './commands/index.js';

// ── Types (re-exported from owning packages) ────────────────
export type { TToolResult, TTrustLevel, TPermissionDecision, TPermissionMode } from './types.js';
export { TRUST_TO_MODE } from './types.js';
export type { ITerminalOutput, ISpinner } from './types.js';
export type { IContextWindowState, IContextTokenUsage } from '@robota-sdk/agent-core';
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
//   createDefaultTools()   — tool assembly
//   createProvider()       — REMOVED (provider comes from consumer)
//   loadConfig()           — config loading (used by InteractiveSession internally)
//   loadContext()          — context loading (used by InteractiveSession internally)
//   SystemCommandExecutor  — embedded in InteractiveSession
//   createSystemCommands() — embedded in InteractiveSession
// ──────────────────────────────────────────────────────────────
