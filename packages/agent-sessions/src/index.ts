// @robota-sdk/agent-sessions

// Session
export { Session } from './session.js';
export type {
  ISessionOptions,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './session.js';

// Sub-components (exported for advanced use cases)
export { PermissionEnforcer } from './permission-enforcer.js';
export { ContextWindowTracker } from './context-window-tracker.js';
export { CompactionOrchestrator } from './compaction-orchestrator.js';

// Context window state (re-exported from agent-core for convenience)
export type { IContextWindowState } from '@robota-sdk/agent-core';

// Session logging
export { FileSessionLogger, SilentSessionLogger } from './session-logger.js';
export type { ISessionLogger, TSessionLogData } from './session-logger.js';

// Session persistence
export { SessionStore } from './session-store.js';
export type { ISessionRecord } from './session-store.js';
