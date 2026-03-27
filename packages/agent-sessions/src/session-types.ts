/**
 * Session types — interfaces and type aliases for Session construction.
 */

import type {
  IAIProvider,
  IToolWithEventService,
  TPermissionMode,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { SessionStore } from './session-store.js';
import type { ISessionLogger } from './session-logger.js';
import type {
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner };

/** Options for constructing a Session */
export interface ISessionOptions {
  /** Pre-constructed tools to register with the agent */
  tools: IToolWithEventService[];
  /** Pre-constructed AI provider */
  provider: IAIProvider;
  /** Pre-built system message string */
  systemMessage: string;
  /** Terminal I/O for permission prompts */
  terminal: ITerminalOutput;
  /** Permission and hook configuration */
  permissions?: { allow: string[]; deny: string[] };
  hooks?: Record<string, unknown>;
  /** Initial permission mode */
  permissionMode?: TPermissionMode;
  /** Default trust level — used to derive permissionMode if not given */
  defaultTrustLevel?: 'safe' | 'moderate' | 'full';
  /** Model name (for context window sizing and Robota config) */
  model?: string;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: SessionStore;
  /** Override session ID (used when resuming a session to reuse the original ID) */
  sessionId?: string;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /** Callback when a tool starts or finishes execution — enables real-time tool display in UI */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
  }) => void;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
  /** Override context max tokens (otherwise derived from model name) */
  contextMaxTokens?: number;
  /** Session logger — injected for pluggable session event logging. */
  sessionLogger?: ISessionLogger;
  /** Additional hook type executors (e.g. prompt, agent) beyond the core defaults. */
  hookTypeExecutors?: IHookTypeExecutor[];
}
