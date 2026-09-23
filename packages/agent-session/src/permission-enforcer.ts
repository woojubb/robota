/**
 * PermissionEnforcer — handles tool permission checking, hook execution,
 * and tool output truncation.
 *
 * Extracted from Session to separate permission/hook concerns from
 * conversation management.
 */

import {
  applyPresetToolLists,
  evaluatePermission,
  findInvalidPermissionPatterns,
  matchesAnyPattern,
  resolvePermissionByPolicy,
  runHooks,
} from '@robota-sdk/agent-core';

import { decideApproval } from './abortable-approval.js';
import { consentScopeFor } from './consent-scope.js';
import { wrapToolWithPermission } from './tool-permission-wrapper.js';

import type {
  IPermissionEnforcerOptions,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import type { IToolWrapperDeps } from './tool-permission-wrapper.js';
import type { IToolWithEventService, TToolArgs, THooksConfig } from '@robota-sdk/agent-core';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner };
export type { IPermissionEnforcerOptions };

/** Throw naming every malformed permission pattern and why (issue #2428). */
function assertPermissionPatternsEvaluable(patterns: readonly string[]): void {
  const problems = findInvalidPermissionPatterns(patterns);
  if (problems.length === 0) return;
  const listed = problems.map(({ pattern, reason }) => `"${pattern}" ${reason}`).join('; ');
  throw new Error(
    `Invalid permission pattern(s) in permissions.allow/deny: ${listed}. ` +
      'Fix the pattern where it is configured (issue #2428).',
  );
}

export class PermissionEnforcer {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly getPermissionMode: IPermissionEnforcerOptions['getPermissionMode'];
  private readonly config: IPermissionEnforcerOptions['config'];
  private readonly terminal: ITerminalOutput;
  private readonly permissionHandler?: TPermissionHandler;
  private readonly promptForApprovalFn?: IPermissionEnforcerOptions['promptForApprovalFn'];
  private readonly sessionLogger?: ISessionLogger;
  private readonly onToolExecution?: IPermissionEnforcerOptions['onToolExecution'];
  private readonly hookTypeExecutors?: IPermissionEnforcerOptions['hookTypeExecutors'];
  private readonly transcriptPath?: string;
  /**
   * Issue #2351: consent is remembered as PATTERNS (`consentScopeFor`), not tool names, and read
   * back through the gate's own matcher — approving one argument does not allow every argument.
   */
  private readonly sessionAllowedTools = new Set<string>();
  /** The configured rules before any preset contributed — see {@link applyPresetToolLists}. */
  private readonly presetFreeRules: { allow: readonly string[]; deny: readonly string[] };
  private readonly onProjectAllowTool?: (toolName: string) => void;
  private readonly permissionPolicy?: IPermissionEnforcerOptions['permissionPolicy'];
  private readonly taskPermissions?: IPermissionEnforcerOptions['taskPermissions'];

  constructor(options: IPermissionEnforcerOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.getPermissionMode = options.getPermissionMode;
    this.config = options.config;
    // Absent ⇒ no preset contributed, so the configured rules ARE the preset-free base. Copied, not
    // aliased: `applyPresetToolLists` writes back into `config.permissions`, and a shared array
    // would make the base track its own output.
    this.presetFreeRules = options.presetFreePermissions ?? {
      allow: [...options.config.permissions.allow],
      deny: [...options.config.permissions.deny],
    };
    // Issue #2428: a pattern the gate could never evaluate is refused HERE, with the pattern and
    // the reason, before any turn — not discovered one unevaluable prompt at a time at the gate.
    assertPermissionPatternsEvaluable([
      ...options.config.permissions.allow,
      ...options.config.permissions.deny,
    ]);
    this.terminal = options.terminal;
    this.permissionHandler = options.permissionHandler;
    this.promptForApprovalFn = options.promptForApprovalFn;
    this.sessionLogger = options.sessionLogger;
    this.onToolExecution = options.onToolExecution;
    this.hookTypeExecutors = options.hookTypeExecutors;
    this.transcriptPath = options.transcriptPath;
    this.onProjectAllowTool = options.onProjectAllowTool;
    this.permissionPolicy = options.permissionPolicy;
    this.taskPermissions = options.taskPermissions;
  }

  /** Wrap all tools with permission checking */
  wrapTools(tools: IToolWithEventService[]): IToolWithEventService[] {
    // Built explicitly rather than cast. A blind assertion here would compile only by silencing the
    // private-member mismatch, and this repository counts and ratchets those. Naming the ten members
    // is what makes the extraction a boundary: if the wrapper starts reading an eleventh, this stops
    // compiling instead of quietly widening.
    const deps: IToolWrapperDeps = {
      sessionId: this.sessionId,
      cwd: this.cwd,
      config: this.config,
      terminal: this.terminal,
      transcriptPath: this.transcriptPath,
      onToolExecution: this.onToolExecution,
      hookTypeExecutors: this.hookTypeExecutors,
      getPermissionMode: this.getPermissionMode,
      log: (event, detail) => this.log(event, detail),
      checkPermission: (toolName, toolArgs, signal) =>
        this.checkPermission(toolName, toolArgs, signal),
    };

    return tools.map((tool) => wrapToolWithPermission(tool, deps));
  }

  /** The consent patterns granted this session via "Allow always" — e.g. `Bash(git *)` (issue #2351). */
  getSessionAllowedTools(): string[] {
    return [...this.sessionAllowedTools];
  }

  /** Clear all session-scoped allow rules. */
  clearSessionAllowedTools(): void {
    this.sessionAllowedTools.clear();
  }

  /**
   * Replace the configured permission rules on a LIVE session (ARCH-040 Group C, issue #1934).
   *
   * The seam is this small because `checkPermission` reads `this.config.permissions` on every call
   * rather than snapshotting it at construction — so the next call sees the new rules and nothing
   * needs re-wiring. Without a seam the startup path could apply a preset's tool lists and the live
   * `/preset` path could not, which is the divergence `scan-preset-projection` exists to measure:
   * one session holding two answers for the same preset depending on WHEN it was chosen.
   *
   * **A call already in flight runs to completion.** `checkPermission` is awaited BEFORE the tool
   * executes, so such a call has already passed its gate, and a gate is a decision at a point in
   * time. There is also no rollback for a partially applied tool — a file already written stays
   * written — so a revocation that cannot undo is a stop, not a denial. Building one would rest on
   * the cancellation path, which RUNTIME-004 records as declared at four layers and honoured at none.
   *
   * A newly applied denial DOES outrank an earlier "always allow": `evaluatePermission` answers
   * `deny` before `promptForApproval` — the only reader of `sessionAllowedTools` — is reached. That
   * is not new behaviour here; it is the existing precedence, and it agrees with the combine rule
   * that a denial is not weakened by a later layer.
   */
  /**
   * The rules the next `checkPermission` will read.
   *
   * Exposed so a case can assert what a live re-application PRODUCED, not merely that the method
   * exists. Review found the first cut composing onto a contaminated base and no test could see it,
   * because nothing could look at the rules.
   */
  currentPermissionRules(): { allow: readonly string[]; deny: readonly string[] } {
    return { allow: [...this.config.permissions.allow], deny: [...this.config.permissions.deny] };
  }

  applyPresetToolLists(preset: {
    allowedTools?: readonly string[];
    deniedTools?: readonly string[];
  }): void {
    // The BASE is what the session was configured with independently of any preset — SUPPLIED, not
    // captured here. Capturing it lazily read `config.permissions` after the startup preset's
    // patterns were already baked in, so the first preset's allowlist survived every later switch:
    // the accumulation the replace rule exists to prevent, arriving through the base rather than
    // through the merge. Review found it; the comment two lines up had described the failure exactly
    // and the code still had it.
    const next = applyPresetToolLists(this.presetFreeRules, preset);
    this.config.permissions.allow = next.allow;
    this.config.permissions.deny = next.deny;
  }

  /** Evaluate permission for a tool call. `signal` — RUNTIME-005; see `decideApproval` for why a
   * cancelled approval denies. */
  async checkPermission(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
  ): Promise<boolean> {
    // CORE-025: a background/subagent task permission policy is resolved BEFORE the session-mode gate, so
    // `deny`/`preapproved`/`inherit-allowlist` override even a permissive mode (e.g. bypassPermissions).
    // `evaluatePermission`'s `auto` branch never runs for a policy-gated call — that was the bypass hole.
    if (this.permissionPolicy) {
      const policyDecision = resolvePermissionByPolicy(this.permissionPolicy, toolName, toolArgs, {
        taskAllow: this.taskPermissions?.allow,
        taskDeny: this.taskPermissions?.deny,
        parentAllow: this.config.permissions.allow,
        parentDeny: this.config.permissions.deny,
      });
      this.firePermissionDecisionHook(toolName, toolArgs, policyDecision);
      if (policyDecision === 'allow') return true;
      if (policyDecision === 'deny') return false;
      // 'prompt' → route to the human-approval path (fail-closed to deny with no approver).
      return this.promptForApproval(toolName, toolArgs, signal);
    }

    const decision = evaluatePermission(toolName, toolArgs, this.getPermissionMode(), {
      allow: this.config.permissions.allow,
      deny: this.config.permissions.deny,
    });

    // SELFHOST-009: fire PermissionDecision (INFORMATIONAL-ONLY, non-blocking) right after the
    // decision is made. Fire-and-forget — the hook cannot change the outcome that follows.
    this.firePermissionDecisionHook(toolName, toolArgs, decision);

    if (decision === 'auto') return true;
    if (decision === 'deny') return false;

    // 'approve' — route to the human-approval path.
    return this.promptForApproval(toolName, toolArgs, signal);
  }

  /**
   * The human-approval path: session-scoped allow list → custom handler → injected approval fn → fail-closed
   * deny. Shared by the session-mode `approve` decision and the CORE-025 `prompt` policy so both fail closed
   * identically when no approver is attached (e.g. a detached background task).
   */
  private async promptForApproval(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const scope = consentScopeFor(toolName, toolArgs);
    const outcome = await decideApproval({
      toolName,
      alreadyAllowed: matchesAnyPattern(toolName, toolArgs, [...this.sessionAllowedTools]),
      ...(this.permissionHandler ? { handler: this.permissionHandler } : {}),
      ...(this.promptForApprovalFn
        ? { injectedPrompt: this.promptForApprovalFn, terminal: this.terminal }
        : {}),
      toolArgs,
      ...(signal ? { signal } : {}),
    });
    if (outcome.rememberForSession) this.sessionAllowedTools.add(scope);
    if (outcome.rememberForProject) this.onProjectAllowTool?.(scope);
    return outcome.allowed;
  }

  /**
   * SELFHOST-009: fire the PermissionDecision hook (informational-only, non-blocking) via the shared
   * `runHooks` path. Fire-and-forget — the result is never awaited or consulted, so it cannot gate the
   * permission outcome. The sole blocking gate remains PreToolUse (`runPreToolHook`).
   */
  private firePermissionDecisionHook(
    toolName: string,
    toolArgs: TToolArgs,
    decision: string,
  ): void {
    const permissionMode = this.getPermissionMode();
    void runHooks(
      this.config.hooks as THooksConfig | undefined,
      'PermissionDecision',
      {
        session_id: this.sessionId,
        cwd: this.cwd,
        hook_event_name: 'PermissionDecision',
        tool_name: toolName,
        tool_input: toolArgs as Record<string, string | number | boolean | object>,
        permission_decision: decision,
        ...(permissionMode !== undefined && { permission_mode: permissionMode }),
        ...(this.transcriptPath !== undefined && { transcript_path: this.transcriptPath }),
        env: {
          CLAUDE_PROJECT_DIR: this.cwd,
          CLAUDE_SESSION_ID: this.sessionId,
        },
      },
      this.hookTypeExecutors,
    ).catch(() => undefined);
  }

  /** Delegate session event to the injected logger. */
  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }
}
