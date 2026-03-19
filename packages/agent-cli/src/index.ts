// @robota-sdk/agent-cli — re-exports from agent-core + CLI-specific exports
export type {
  TToolResult,
  TTrustLevel,
  TPermissionDecision,
  TPermissionMode,
  ITerminalOutput,
  ISpinner,
} from '@robota-sdk/agent-core';
export { TRUST_TO_MODE } from '@robota-sdk/agent-core';

export { Session } from '@robota-sdk/agent-core';
export type { ISessionOptions, TPermissionHandler } from '@robota-sdk/agent-core';

export { SessionStore } from '@robota-sdk/agent-core';
export type { ISessionRecord } from '@robota-sdk/agent-core';

export { query } from '@robota-sdk/agent-core';
export type { IQueryOptions } from '@robota-sdk/agent-core';

export { startCli } from './cli.js';
