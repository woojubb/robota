// @robota-sdk/agent-sdk — Programmatic SDK for building AI agents

// Types (re-exported from owning packages)
export type { TToolResult, TTrustLevel, TPermissionDecision, TPermissionMode } from './types.js';
export { TRUST_TO_MODE } from './types.js';
export type { ITerminalOutput, ISpinner } from './types.js';

// Assembly — session factory and component creation
export {
  createSession,
  createDefaultTools,
  createProvider,
  DEFAULT_TOOL_DESCRIPTIONS,
} from './assembly/index.js';
export type { ICreateSessionOptions } from './assembly/index.js';

// Session (re-exported from agent-sessions — generic, requires tools/provider/systemMessage)
export { Session } from '@robota-sdk/agent-sessions';
export type {
  ISessionOptions,
  TPermissionHandler,
  TPermissionResult,
} from '@robota-sdk/agent-sessions';

// Session logging (from agent-sessions)
export { FileSessionLogger, SilentSessionLogger } from '@robota-sdk/agent-sessions';
export type { ISessionLogger, TSessionLogData } from '@robota-sdk/agent-sessions';

// Session persistence (from agent-sessions)
export { SessionStore } from '@robota-sdk/agent-sessions';
export type { ISessionRecord } from '@robota-sdk/agent-sessions';

// Query API
export { query } from './query.js';
export type { IQueryOptions } from './query.js';

// Config
export type { IResolvedConfig } from './config/config-types.js';
export { loadConfig } from './config/config-loader.js';

// Context
export type { ILoadedContext } from './context/context-loader.js';
export { loadContext } from './context/context-loader.js';

// Context window state (re-exported from agent-core)
export type { IContextWindowState, IContextTokenUsage } from '@robota-sdk/agent-core';
export type { IProjectInfo } from './context/project-detector.js';
export { detectProject } from './context/project-detector.js';
export type { ISystemPromptParams } from './context/system-prompt-builder.js';
export { buildSystemPrompt } from './context/system-prompt-builder.js';

// Permissions (from agent-core — direct re-export, no intermediate file)
export { evaluatePermission } from '@robota-sdk/agent-core';
export type { TToolArgs, IPermissionLists } from '@robota-sdk/agent-core';
export { promptForApproval } from './permissions/permission-prompt.js';

// Hooks (from agent-core — direct re-export, no intermediate file)
export { runHooks } from '@robota-sdk/agent-core';
export type { THookEvent, THooksConfig, IHookInput } from '@robota-sdk/agent-core';

// Hook executors (SDK-level — prompt, agent)
export { PromptExecutor, AgentExecutor } from './hooks/index.js';
export type { TProviderFactory, IPromptProvider, IPromptExecutorOptions } from './hooks/index.js';
export type { TSessionFactory, IAgentSession, IAgentExecutorOptions } from './hooks/index.js';

// Standard paths
export { projectPaths, userPaths } from './paths.js';

// BundlePlugin system
export { PluginSettingsStore } from './plugins/index.js';
export type { IPluginSettings } from './plugins/index.js';
export { BundlePluginLoader } from './plugins/index.js';
export { BundlePluginInstaller } from './plugins/index.js';
export type { IPluginSource, IBundlePluginInstallerOptions } from './plugins/index.js';
export { MarketplaceClient } from './plugins/index.js';
export type {
  IMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
} from './plugins/index.js';
export type {
  IBundlePluginManifest,
  IBundlePluginFeatures,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './plugins/index.js';

// Tools — agent-tool (SDK-specific, not a re-export)
export { agentTool, setAgentToolDeps } from './tools/agent-tool.js';

// Individual tools (re-exported from agent-tools for backward compatibility)
export { bashTool } from '@robota-sdk/agent-tools';
export { readTool } from '@robota-sdk/agent-tools';
export { writeTool } from '@robota-sdk/agent-tools';
export { editTool } from '@robota-sdk/agent-tools';
export { globTool } from '@robota-sdk/agent-tools';
export { grepTool } from '@robota-sdk/agent-tools';
