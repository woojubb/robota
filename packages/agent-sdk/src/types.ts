/**
 * Shared types for Robota SDK — re-exported from their owning packages.
 */

// Permission types from agent-core
export type { TPermissionMode, TTrustLevel, TPermissionDecision } from '@robota-sdk/agent-core';
export { TRUST_TO_MODE } from '@robota-sdk/agent-core';

// Tool result type from agent-tools
export type { TToolResult } from '@robota-sdk/agent-tools';

// Terminal types from agent-sessions
export type { ITerminalOutput, ISpinner } from '@robota-sdk/agent-sessions';
