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
  | 'PostCompact'
  | 'UserPromptSubmit';

/** Command hook — executes a shell command */
export interface ICommandHookDefinition {
  type: 'command';
  command: string;
  timeout?: number;
}

/** HTTP hook — sends an HTTP request */
export interface IHttpHookDefinition {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/** Prompt hook — evaluates a prompt via an AI model */
export interface IPromptHookDefinition {
  type: 'prompt';
  prompt: string;
  model?: string;
}

/** Agent hook — delegates to a sub-agent */
export interface IAgentHookDefinition {
  type: 'agent';
  agent: string;
  maxTurns?: number;
  timeout?: number;
}

/** Discriminated union of all hook definition types */
export type IHookDefinition =
  | ICommandHookDefinition
  | IHttpHookDefinition
  | IPromptHookDefinition
  | IAgentHookDefinition;

/** A hook group — matcher + array of hook definitions */
export interface IHookGroup {
  /** Regex pattern to match tool name (empty string = match all) */
  matcher: string;
  hooks: IHookDefinition[];
  /** Environment variables injected into hook child processes for this group */
  env?: Record<string, string>;
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
  /** User message text (UserPromptSubmit only) */
  user_message?: string;
  /** User prompt text — Claude Code compatible alias for user_message (UserPromptSubmit only) */
  prompt?: string;
  /** Assistant response text (Stop only) */
  response?: string;
  /** Additional environment variables to pass to hook child processes */
  env?: Record<string, string>;
}

/** Hook execution result */
export interface IHookResult {
  /** 0 = allow/proceed, 2 = block/deny, other = proceed with warning */
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Strategy interface for hook type executors */
export interface IHookTypeExecutor {
  /** The hook type this executor handles */
  type: IHookDefinition['type'];
  /** Execute a hook definition with the given input */
  execute(definition: IHookDefinition, input: IHookInput): Promise<IHookResult>;
}
