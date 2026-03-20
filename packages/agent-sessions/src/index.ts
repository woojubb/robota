// @robota-sdk/agent-sessions

// Session
export { Session } from './session.js';
export type {
  ISessionOptions,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  ISystemPromptParams,
} from './session.js';

// Context window state (re-exported from agent-core for convenience)
export type { IContextWindowState } from '@robota-sdk/agent-core';

// Session persistence
export { SessionStore } from './session-store.js';
export type { ISessionRecord } from './session-store.js';
