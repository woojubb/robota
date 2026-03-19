/**
 * Hook system types — Claude Code compatible event/hook model.
 */

/** Hook lifecycle events */
export type THookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'Stop'
  | 'PreCompact'
  | 'PostCompact';

/** A single hook definition */
export interface IHookDefinition {
  /** Shell command to execute */
  type: 'command';
  command: string;
}

/** A hook group — matcher + array of hook definitions */
export interface IHookGroup {
  /** Regex pattern to match tool name (empty string = match all) */
  matcher: string;
  hooks: IHookDefinition[];
}

/** Complete hooks configuration: event → array of hook groups */
export type THooksConfig = Partial<Record<THookEvent, IHookGroup[]>>;

/** Input passed to hook commands via stdin */
export interface IHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: THookEvent;
  tool_name?: string;
  tool_input?: Record<string, string | number | boolean | object>;
  tool_output?: string;
  /** Compaction trigger source (PreCompact/PostCompact only) */
  trigger?: 'auto' | 'manual';
  /** Compaction summary text (PostCompact only) */
  compact_summary?: string;
}

/** Hook execution result */
export interface IHookResult {
  /** 0 = allow/proceed, 2 = block/deny, other = proceed with warning */
  exitCode: number;
  stdout: string;
  stderr: string;
}
