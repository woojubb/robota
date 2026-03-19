// @robota-sdk/agent-sdk — Programmatic SDK for building AI agents

// Types
export type {
  TToolResult,
  ITerminalOutput,
  ISpinner,
  TTrustLevel,
  TPermissionDecision,
  TPermissionMode,
} from './types.js';
export { TRUST_TO_MODE } from './types.js';

// Session
export { Session } from './session.js';
export type { ISessionOptions, TPermissionHandler } from './session.js';

// Session persistence
export { SessionStore } from './session-store.js';
export type { ISessionRecord } from './session-store.js';

// Query API
export { query } from './query.js';
export type { IQueryOptions } from './query.js';

// Config
export type { IResolvedConfig } from './config/config-types.js';
export { loadConfig } from './config/config-loader.js';

// Context
export type { ILoadedContext } from './context/context-loader.js';
export { loadContext } from './context/context-loader.js';
export type { IProjectInfo } from './context/project-detector.js';
export { detectProject } from './context/project-detector.js';
export type { ISystemPromptParams } from './context/system-prompt-builder.js';
export { buildSystemPrompt } from './context/system-prompt-builder.js';

// Permissions
export { evaluatePermission } from './permissions/permission-gate.js';
export type { TToolArgs, IPermissionLists } from './permissions/permission-gate.js';
export { promptForApproval } from './permissions/permission-prompt.js';

// Hooks
export { runHooks } from './hooks/hook-runner.js';
export type { THookEvent, THooksConfig, IHookInput } from './hooks/types.js';

// Tools
export { bashTool } from './tools/bash-tool.js';
export { readTool } from './tools/read-tool.js';
export { writeTool } from './tools/write-tool.js';
export { editTool } from './tools/edit-tool.js';
export { globTool } from './tools/glob-tool.js';
export { grepTool } from './tools/grep-tool.js';
export { agentTool, setAgentToolDeps } from './tools/agent-tool.js';
