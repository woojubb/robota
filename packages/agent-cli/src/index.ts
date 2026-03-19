// @robota-sdk/agent-cli

// Re-export SDK types for backward compatibility
export { Session, SessionStore, query, TRUST_TO_MODE } from '@robota-sdk/agent-sdk';
export type {
  TToolResult,
  TTrustLevel,
  TPermissionDecision,
  TPermissionMode,
  ISessionOptions,
  TPermissionHandler,
  ISessionRecord,
  IQueryOptions,
} from '@robota-sdk/agent-sdk';

// Permission types from agent-core
export type { TToolArgs } from '@robota-sdk/agent-core';

// Local CLI types
export type { ITerminalOutput, ISpinner } from './types.js';

// CLI entry point
export { startCli } from './cli.js';
