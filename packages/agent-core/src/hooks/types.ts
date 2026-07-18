/**
 * Hook system types — Claude Code compatible event/hook model.
 */

/**
 * Hook lifecycle events.
 *
 * `PreModelCall`, `PostModelCall`, and `PermissionDecision` (SELFHOST-009) are
 * INFORMATIONAL-ONLY: they are fired fire-and-forget from the turn owner at points it already
 * observes and their `runHooks` result is NOT awaited or consulted for gating. The sole BLOCKING
 * event is `PreToolUse` (exit-code-2 / `permissionDecision: "deny"` → `blocked`). See the catalog
 * SSOT `packages/agent-core/docs/hook-catalog.md` for per-event timing, fire-site, and blocking
 * semantics.
 */
export type THookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'PreCompact'
  | 'PostCompact'
  | 'UserPromptSubmit'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PreModelCall'
  | 'PostModelCall'
  | 'PermissionDecision';

/** Claude Code compatible session end reasons. */
export type TSessionEndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other';

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

/** Agent hook — delegates to a subagent */
export interface IAgentHookDefinition {
  type: 'agent';
  agent: string;
  maxTurns?: number;
  timeout?: number;
}

/**
 * Guardrail hook (SELFHOST-005) — runs the registered guardrail SET in parallel and fails the turn
 * fast. The guardrail functions live in the `GuardrailExecutor` (registered by the consumer); this
 * data-only definition just selects which to run. Any failure maps onto the existing exit-code-2 /
 * `blocked` contract, so enforcement reuses the single `runHooks` → `runPreToolHook` path.
 */
export interface IGuardrailHookDefinition {
  type: 'guardrail';
  /** Names of registered guardrails to run; omitted = run ALL registered guardrails. */
  guardrails?: string[];
}

/** Discriminated union of all hook definition types */
export type THookDefinition =
  | ICommandHookDefinition
  | IHttpHookDefinition
  | IPromptHookDefinition
  | IAgentHookDefinition
  | IGuardrailHookDefinition;

/**
 * SELFHOST-005: the verdict a guardrail returns. `pass: false` fails the turn fast (mapped to the
 * exit-code-2 / `blocked` hook contract).
 */
export interface IGuardrailResult {
  pass: boolean;
  /** Human-readable reason surfaced when `pass === false`. */
  reason?: string;
}

/**
 * SELFHOST-005: a registerable guardrail — a pure MECHANISM that inspects the turn's hook input and
 * votes pass/block. The POLICY (what to check) is the consumer's. Guardrails in a set run in parallel
 * and the first `!pass` (or a thrown error — fail-safe) fails the turn fast.
 */
export type TGuardrail = (input: IHookInput) => IGuardrailResult | Promise<IGuardrailResult>;

/** A hook group — matcher + array of hook definitions */
export interface IHookGroup {
  /** Regex pattern to match tool name (empty string = match all) */
  matcher: string;
  hooks: THookDefinition[];
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
  /** Last assistant message text (StopFailure only) */
  last_assistant_message?: string;
  /** Stop hook recursion guard (Stop/StopFailure only) */
  stop_hook_active?: boolean;
  /** Session end reason (SessionEnd only) */
  reason?: TSessionEndReason | string;
  /** Session transcript path when available (SessionEnd/SubagentStop only) */
  transcript_path?: string;
  /** Subagent identifier (SubagentStart/SubagentStop only) */
  agent_id?: string;
  /** Subagent type/name (SubagentStart/SubagentStop only) */
  agent_type?: string;
  /** Subagent transcript path when available (SubagentStop only) */
  agent_transcript_path?: string;
  /** Claude Code permission mode at time of event (e.g. "default", "plan", "acceptEdits", "bypassPermissions") */
  permission_mode?: string;
  /**
   * Provider model identifier for the model call (PreModelCall/PostModelCall only).
   * SELFHOST-009 — informational.
   */
  model?: string;
  /**
   * Provider name for the model call (PreModelCall/PostModelCall only).
   * SELFHOST-009 — informational.
   */
  provider?: string;
  /** Agentic round index for the model call (PreModelCall/PostModelCall only). SELFHOST-009 — informational. */
  round?: number;
  /**
   * Reported permission decision (PermissionDecision only) — the value `evaluatePermission` returned
   * (`'auto' | 'approve' | 'deny'`). SELFHOST-009 — informational. This REPORTS a decision already made;
   * it neither extends `TPermissionDecision` nor the internal `IRunHooksResult.permissionDecision`, and
   * the hook cannot change the outcome.
   */
  permission_decision?: string;
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
  type: THookDefinition['type'];
  /** Execute a hook definition with the given input */
  execute(definition: THookDefinition, input: IHookInput): Promise<IHookResult>;
}
