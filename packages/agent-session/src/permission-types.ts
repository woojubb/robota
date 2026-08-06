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

/**
 * How a tool call ended, when it did not simply succeed (CORE-027).
 *
 * Three outcomes used to be indistinguishable from success at this type — a tool that THREW, a user
 * DENIAL, and a hook BLOCK — because each was returned as `{ success: true, data: '{"success":
 * false,…}' }`. Every consumer above had to parse English out of a string and guess, and all three
 * guesses were the same one.
 *
 * The framing the audit stated is the one kept here: **"never throw" is correct and "encode the
 * failure as success" is not — they are independent decisions.** Nothing below starts throwing.
 */
export type TToolFailureOutcome = 'threw' | 'denied' | 'hook-blocked';

/**
 * The failure envelope. `success: false` is the part consumers branch on; `outcome` is the part they
 * branch on when they need to know WHICH failure, and neither requires reading `data`.
 *
 * `data` keeps the JSON string it always carried, because the model is shown that text and changing
 * what it sees is a separate decision from making the envelope honest.
 */
export function toolFailure(
  outcome: TToolFailureOutcome,
  error: string,
  /**
   * What the MODEL is shown, when it differs from the default.
   *
   * A hook block has said `{ blocked: true, reason }` since HOOK-003, and the model reads that text.
   * Changing the envelope is this item's subject; changing what the model sees is a different
   * decision with a different blast radius, so the payload stays exactly as it was.
   */
  data?: unknown,
) {
  return {
    success: false as const,
    outcome,
    error,
    data: JSON.stringify(data ?? { success: false, output: '', error }),
    metadata: {},
  };
}

/**
 * The crash path, as one call: announce the failure to the listener and return an honest envelope.
 *
 * It lives beside the envelope rather than in the enforcer because the enforcer is at its size
 * ceiling and this is the same subject — what a failed tool call looks like. Two things happen here
 * and both are the point: before CORE-027 the catch returned `success: true` AND emitted no end
 * event at all, so a crash was invisible to the caller and to anything watching.
 */
/**
 * What a crash announcement looks like, named rather than widened.
 *
 * The first version typed `announce` as taking a `Record<string, unknown>`, which the real
 * `onToolExecution` cannot be assigned to — parameter positions are contravariant — so the call site
 * reached for `as never`. A cast at a boundary is the boundary's type being wrong; this is the
 * subset of the event this function actually emits.
 */
export interface IToolCrashAnnouncement {
  type: 'end';
  toolName: string;
  toolArgs: TToolArgs;
  success: false;
  executionId?: string;
}

export function reportToolCrash(
  error: unknown,
  announce: ((event: IToolCrashAnnouncement) => void) | undefined,
  where: { toolName: string; toolArgs: TToolArgs; executionId?: string },
) {
  const message = error instanceof Error ? error.message : String(error);
  announce?.({
    type: 'end',
    toolName: where.toolName,
    toolArgs: where.toolArgs,
    success: false,
    executionId: where.executionId,
  });
  return toolFailure('threw', message);
}

/** Returned when the user denies a permission prompt. */
export const PERMISSION_DENIED_RESULT = toolFailure(
  'denied',
  'Permission denied. The user did not approve this action.',
);

/** Maximum chars for any single tool output. Matches Claude Code's 30K limit. */
export const MAX_TOOL_OUTPUT_CHARS = 30_000;
