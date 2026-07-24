/**
 * Permission types — interfaces and type aliases for permission enforcement.
 */

import type { ISessionLogger } from './session-logger.js';
import type { IToolWithEventService, TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type {
  IHookTypeExecutor,
  ISpinner,
  ITerminalOutput,
  TBackgroundPermissionPolicy,
} from '@robota-sdk/agent-core';

export type { ISpinner, ITerminalOutput };

/**
 * Permission handler result:
 * - true: allow this invocation
 * - false: deny this invocation
 * - 'allow-session': allow this invocation and auto-approve this tool for the rest of the session
 * - 'allow-project': allow this invocation and persist the approval to the project's local
 *   settings; the storage location is owned by the consuming layer (via `onProjectAllowTool`)
 */
export type TPermissionResult = boolean | 'allow-session' | 'allow-project';

/**
 * Custom permission handler — called when a tool needs user approval.
 * Returns true to allow, false to deny, or 'allow-session' to remember for the session.
 */
export type TPermissionHandler = (
  toolName: string,
  toolArgs: TToolArgs,
) => Promise<TPermissionResult>;

export interface IPermissionEnforcerOptions {
  sessionId: string;
  cwd: string;
  getPermissionMode: () => TPermissionMode;
  config: {
    permissions: { allow: string[]; deny: string[] };
    hooks?: Record<string, unknown>;
  };
  terminal: ITerminalOutput;
  permissionHandler?: TPermissionHandler;
  promptForApprovalFn?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<TPermissionResult>;
  sessionLogger?: ISessionLogger;
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }) => void;
  /** Additional hook type executors (e.g. prompt, agent) beyond the core defaults. */
  hookTypeExecutors?: IHookTypeExecutor[];
  /** Absolute path to session transcript file — passed to PreToolUse hook inputs as transcript_path */
  transcriptPath?: string;
  /** Called when the user selects "allow for project" — persists the tool pattern to project settings. */
  onProjectAllowTool?: (toolName: string) => void;
  /**
   * CORE-025: a background/subagent task permission policy. When set, it is resolved BEFORE the session-mode
   * gate, so `deny`/`preapproved`/`inherit-allowlist` override even a permissive session mode (e.g.
   * `bypassPermissions`). `prompt` routes to the human-approval path; absent → the session-mode gate alone.
   */
  permissionPolicy?: TBackgroundPermissionPolicy;
  /**
   * CORE-025: the task's OWN declared allow/deny rules (distinct from the parent session's `config.permissions`
   * which `inherit-allowlist` inherits). `preapproved` consults these.
   */
  taskPermissions?: { allow?: readonly string[]; deny?: readonly string[] };
}

/** Returned when the user denies a permission prompt. success:true prevents ToolExecutionError. */
export const PERMISSION_DENIED_RESULT = {
  success: true,
  data: JSON.stringify({
    success: false,
    output: '',
    error: 'Permission denied. The user did not approve this action.',
  }),
  metadata: {},
} as const;

/** Maximum chars for any single tool output. Matches Claude Code's 30K limit. */
export const MAX_TOOL_OUTPUT_CHARS = 30_000;
