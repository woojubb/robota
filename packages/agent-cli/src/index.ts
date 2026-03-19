// @robota-sdk/agent-cli — Re-export SDK types for backward compatibility

export { Session, SessionStore, query, TRUST_TO_MODE } from '@robota-sdk/agent-sdk';
export type {
  TToolResult,
  ITerminalOutput,
  ISpinner,
  TTrustLevel,
  TPermissionDecision,
  TPermissionMode,
  ISessionOptions,
  TPermissionHandler,
  ISessionRecord,
  IQueryOptions,
} from '@robota-sdk/agent-sdk';

export { startCli } from './cli.js';
