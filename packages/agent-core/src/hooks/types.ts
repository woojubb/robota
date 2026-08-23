/**
 * Hook system types — Claude Code compatible event/hook model.
 */

/**
 * Hook lifecycle events.
 *
 * `PreModelCall`, `PostModelCall`, and `PermissionDecision` (SELFHOST-009) are
 * INFORMATIONAL-ONLY: they are fired fire-and-forget from the turn owner at points it already
 * observes and their `runHooks` result is NOT awaited or consulted for gating. The sole BLOCKING
 * event is `PreToolUse`, on a `deny` outcome, on an `allow` whose stdout carries a deny directive,
 * and — since SEC-016 — on an `error` OR on a configured hook type with no registered executor,
 * because a hook that reached no verdict is not a hook that approved. That fourth cause is easy to
 * omit from a list of three, and the catalog SSOT names it: a gate nothing evaluated denies rather
 * than allowing silently. Which events enforce is recorded in `HOOK_ENFORCEMENT_POLICY`
 * (`./enforcement-policy.ts`); see the catalog SSOT `packages/agent-core/docs/HOOK-CATALOG.md` for
 * per-event timing, fire-site, and blocking semantics.
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
  'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'bypass_permissions_disabled' | 'other';

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

/**
 * Why a hook execution could not produce a verdict (SEC-015).
 *
 * The distinction these six names carry is the one the exit-code channel could not: a hook that
 * DECIDED versus one that never got to. Which of the six it was is diagnostic detail; that it was
 * any of them is what an enforcing consumer acts on.
 */
export type THookErrorKind =
  /** The executor's own deadline elapsed before the hook answered. */
  | 'timeout'
  /** The process or transport never started (ENOENT, EACCES, a refused handshake). */
  | 'spawn-failure'
  /** It started and failed mid-flight — network drop, provider error, session failure. */
  | 'transport-failure'
  /** A well-formed response carrying a non-2xx status. */
  | 'http-status'
  /** A response arrived and could not be decoded into a verdict. */
  | 'malformed-response'
  /** The process exited with a code that is neither 0 nor 2, or was killed by a signal. */
  | 'nonzero-exit';

/** The hook approved. Its stdout carries the Claude Code response protocol, which the runner decodes. */
export interface IHookAllowOutcome {
  readonly outcome: 'allow';
  /** Which executor produced this outcome — preserved for diagnostics. */
  readonly source: THookDefinition['type'];
  readonly stdout: string;
}

/** The hook decided to block, and said why. */
export interface IHookDenyOutcome {
  readonly outcome: 'deny';
  /** Which executor produced this outcome — preserved for diagnostics. */
  readonly source: THookDefinition['type'];
  readonly reason: string;
}

/**
 * The hook rendered no verdict.
 *
 * This is NOT a third verdict — it is the absence of one, and the policy for what an enforcing event
 * does about it is deliberately not encoded here.
 */
export interface IHookErrorOutcome {
  readonly outcome: 'error';
  /** Which executor produced this outcome — preserved for diagnostics. */
  readonly source: THookDefinition['type'];
  readonly kind: THookErrorKind;
  readonly reason: string;
}

/**
 * The decoded result of one hook execution (SEC-015).
 *
 * It replaces an `{ exitCode, stdout, stderr }` record whose only channel for a failure was a
 * number, which forced every failure to be coerced into a verdict: a truthy non-boolean `ok` read
 * as allow and disabled the gate, while a falsy or missing one read as deny and blocked the user's
 * tool call on a decision no hook made. Making the third outcome representable is what removes the
 * coercion — a malformed response is now `error`, which is neither.
 */
export type THookOutcome = IHookAllowOutcome | IHookDenyOutcome | IHookErrorOutcome;

/** Strategy interface for hook type executors */
export interface IHookTypeExecutor {
  /** The hook type this executor handles */
  type: THookDefinition['type'];
  /** Execute a hook definition with the given input */
  execute(definition: THookDefinition, input: IHookInput): Promise<THookOutcome>;
}
