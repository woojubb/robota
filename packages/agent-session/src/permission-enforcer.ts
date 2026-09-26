/**
 * PermissionEnforcer — handles tool permission checking, hook execution,
 * and tool output truncation.
 *
 * Extracted from Session to separate permission/hook concerns from
 * conversation management.
 */

import { homedir } from 'node:os';

import {
  allowRulesForAutoMode,
  applyPresetToolLists,
  evaluatePermission,
  findInvalidPermissionPatterns,
  findPermissionPatternWarnings,
  getToolPermissionProfile,
  isToolDeniedOutright,
  matchesAnyPattern,
  projectPermissionPolicy,
  registerToolPermissionProfile,
  requiresFreshApproval,
  runHooks,
} from '@robota-sdk/agent-core';

import { decideApproval } from './abortable-approval.js';
import { AutoModeGate } from './auto-mode-gate.js';
import { consentScopeFor } from './consent-scope.js';
import { buildHookInput, runPreToolHook } from './tool-hook-helpers.js';
import { PermissionDenialLog } from './permission-denial-log.js';
import { wrapToolWithPermission } from './tool-permission-wrapper.js';
import { createWorkspacePathResolver } from './workspace-path-resolver.js';

import type {
  IPermissionEnforcerOptions,
  IPermissionRefusal,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';
import type { IPermissionDenial } from './permission-denial-log.js';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import type { IToolWrapperDeps } from './tool-permission-wrapper.js';
import type {
  IToolExecutionContext,
  IToolWithEventService,
  TToolArgs,
  TToolParameters,
  THooksConfig,
  TResolveInWorkspace,
} from '@robota-sdk/agent-core';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner };
export type { IPermissionEnforcerOptions };

/**
 * Throw naming every malformed permission pattern and why (issue #2428). Allow rules are held to
 * the narrower allow grammar (issue #3081).
 */
function assertPermissionPatternsEvaluable(rules: {
  allow: readonly string[];
  restrictive: readonly string[];
}): void {
  const problems = [
    ...findInvalidPermissionPatterns(rules.allow, 'allow'),
    ...findInvalidPermissionPatterns(rules.restrictive, 'deny'),
  ];
  if (problems.length === 0) return;
  const listed = problems.map(({ pattern, reason }) => `"${pattern}" ${reason}`).join('; ');
  throw new Error(
    `Invalid permission pattern(s) in permissions.allow/deny/ask: ${listed}. ` +
      'Fix the pattern where it is configured (issue #2428).',
  );
}

/** How a decision's call will run, where that changes the answer. */
interface IDecisionScope {
  /** `false` when the call will NOT run inside the command sandbox, so its approval cannot apply. */
  readonly sandboxed?: boolean;
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
  private readonly homeDirectory: string;
  private readonly resolveInWorkspace: TResolveInWorkspace;
  private readonly commandSandbox?: IPermissionEnforcerOptions['commandSandbox'];
  private readonly denials = new PermissionDenialLog();
  /** A turn a peer's message started is in progress: the one place the reply to that peer exists. */
  private peerTurn = false;
  private readonly autoMode?: AutoModeGate;

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
    assertPermissionPatternsEvaluable(this.configuredRules(options));
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
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.resolveInWorkspace = createWorkspacePathResolver(options.cwd);
    this.commandSandbox = options.commandSandbox;
    if (options.permissionClassifier !== undefined) {
      this.autoMode = new AutoModeGate(options.permissionClassifier);
    }
  }

  /**
   * Start a turn, which a peer's message started when `peerTurn` is true. That decides only whether
   * the reply to the peer exists; every other call is decided exactly as in any turn.
   */
  beginTurn(peerTurn: boolean): void {
    this.peerTurn = peerTurn;
  }

  /** End the turn; the reply to a peer is gone until the next peer turn begins. */
  endTurn(): void {
    this.peerTurn = false;
  }

  /** Whether `auto` mode can run here: it needs a classifier to decide for it. */
  hasPermissionClassifier(): boolean {
    return this.autoMode !== undefined;
  }

  /**
   * Let the call behind a classifier denial run once, unjudged, when the model tries it again.
   * Returns the denial, or `undefined` when `index` names no classifier denial.
   */
  allowRetryOfDenial(index: number): IPermissionDenial | undefined {
    const denial = this.denials.list()[index];
    const call = this.denials.callAt(index);
    if (denial?.reason !== 'classifier' || call === undefined || this.autoMode === undefined) {
      return undefined;
    }
    this.autoMode.grantRetry(call.toolName, call.toolArgs);
    return denial;
  }

  /** Every configured pattern, split by the grammar it is held to. */
  private configuredRules(
    options: Pick<IPermissionEnforcerOptions, 'config' | 'taskPermissions'> = {
      config: this.config,
      ...(this.taskPermissions !== undefined ? { taskPermissions: this.taskPermissions } : {}),
    },
  ): { allow: string[]; restrictive: string[] } {
    return {
      allow: [...options.config.permissions.allow, ...(options.taskPermissions?.allow ?? [])],
      restrictive: [
        ...options.config.permissions.deny,
        ...(options.config.permissions.ask ?? []),
        ...(options.taskPermissions?.deny ?? []),
      ],
    };
  }

  /**
   * Whether the model is shown this tool at all. A bare-name deny (`Tool`, `Tool(*)`, a name glob)
   * removes it rather than offering it and refusing every call (issue #3081). Read live, so a
   * `/preset` that denies a tool hides it from the next round.
   */
  isToolVisible(toolName: string): boolean {
    // The reply exists in a peer turn alone; a peer turn is otherwise shown what any turn is.
    if (!this.peerTurn && getToolPermissionProfile(toolName).repliesToPeer === true) return false;
    return !isToolDeniedOutright(toolName, [
      ...this.config.permissions.deny,
      ...(this.taskPermissions?.deny ?? []),
    ]);
  }

  /**
   * Tell the gate each tool's parameter names — the schema is what makes `Tool(name:value)` a
   * parameter rule — then re-check the rules against them, before any turn runs.
   */
  private registerToolParameters(tools: readonly IToolWithEventService[]): void {
    for (const tool of tools) {
      // Read defensively: a tool without a schema has no parameters to name.
      const schema = (tool as Partial<Pick<IToolWithEventService, 'schema'>>).schema;
      if (schema === undefined) continue;
      const properties = schema.parameters?.properties ?? {};
      registerToolPermissionProfile(schema.name, { parameters: Object.keys(properties) });
    }
    const rules = this.configuredRules();
    assertPermissionPatternsEvaluable(rules);
    for (const { pattern, reason } of findPermissionPatternWarnings(rules.restrictive)) {
      this.terminal.writeLine(`  ⚠  Permission rule "${pattern}" ${reason}.`);
    }
  }

  /** Wrap all tools with permission checking */
  wrapTools(tools: IToolWithEventService[]): IToolWithEventService[] {
    this.registerToolParameters(tools);
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
      checkPermission: (toolName, toolArgs, signal, interaction, hookTraceEnv) =>
        this.decidePermission(toolName, toolArgs, signal, interaction, hookTraceEnv),
    };

    return tools.map((tool) => wrapToolWithPermission(tool, deps));
  }

  /** The consent patterns granted this session via "Allow always" — e.g. `Bash(git *)` (issue #2351). */
  getSessionAllowedTools(): string[] {
    return [...this.sessionAllowedTools];
  }

  /** The calls this session refused, most recent first (issue #3082). */
  getRecentDenials(): readonly IPermissionDenial[] {
    return this.denials.list();
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
  currentPermissionRules(): {
    allow: readonly string[];
    deny: readonly string[];
    ask: readonly string[];
  } {
    return {
      allow: [...this.config.permissions.allow],
      deny: [...this.config.permissions.deny],
      ask: [...(this.config.permissions.ask ?? [])],
    };
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
    interaction: IToolExecutionContext['permissionInteraction'] = 'interactive',
    hookTraceEnv?: IToolExecutionContext['hookTraceEnv'],
  ): Promise<boolean> {
    return (
      (await this.decidePermission(toolName, toolArgs, signal, interaction, hookTraceEnv)) === true
    );
  }

  /**
   * Decide an action that has `toolName`'s effect but does not run through that tool — a command
   * that starts a process, say. It passes what the tool call would: the PreToolUse hooks (so
   * guardrails apply), then the gate's rules, mode, remembered consent and prompt. It never takes
   * the command sandbox's auto-approval, because the action does not run inside that sandbox.
   */
  async checkDelegatedToolCall(
    toolName: string,
    toolParameters: TToolParameters,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const hookInput = buildHookInput(
      this.sessionId,
      this.cwd,
      toolName,
      toolParameters,
      this.getPermissionMode(),
      this.transcriptPath,
    );
    const blocked = await runPreToolHook(this.config.hooks, hookInput, this.hookTypeExecutors);
    if (blocked) {
      this.log('tool_blocked', { tool: toolName, reason: 'hook', delegated: true });
      return false;
    }
    const decision = await this.decidePermission(
      toolName,
      toolParameters as TToolArgs,
      signal,
      'interactive',
      undefined,
      { sandboxed: false },
    );
    return decision === true;
  }

  /** {@link checkPermission}, keeping the reason a refusal carries for the model. */
  private async decidePermission(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
    interaction: IToolExecutionContext['permissionInteraction'] = 'interactive',
    hookTraceEnv?: IToolExecutionContext['hookTraceEnv'],
    scope: IDecisionScope = {},
  ): Promise<boolean | IPermissionRefusal> {
    // Issue #3081: ONE evaluator for every caller. A background/subagent policy (CORE-025) only
    // adds a ceiling, an ask-everything flag and the task's own lists; the ceiling is checked before
    // bypassPermissions, so a policy still binds under a permissive mode.
    const policy =
      this.permissionPolicy !== undefined
        ? projectPermissionPolicy(this.permissionPolicy, {
            taskAllow: this.taskPermissions?.allow,
            taskDeny: this.taskPermissions?.deny,
            parentAllow: this.config.permissions.allow,
          })
        : undefined;

    const mode = this.getPermissionMode();
    const allow = [...this.config.permissions.allow, ...(policy?.allow ?? [])];
    const rules = {
      // An allow rule that lets any code run would carry every call past the classifier.
      allow: mode === 'auto' ? allowRulesForAutoMode(allow) : allow,
      deny: [...this.config.permissions.deny, ...(policy?.deny ?? [])],
      ask: this.config.permissions.ask ?? [],
    };
    const where = { cwd: this.cwd, homeDirectory: this.homeDirectory };
    const decision = evaluatePermission(toolName, toolArgs, mode, rules, {
      ...where,
      resolveInWorkspace: this.resolveInWorkspace,
      sandboxAutoApproved:
        scope.sandboxed !== false && this.sandboxAutoApproves(toolName, toolArgs),
      ...(policy?.ceiling !== undefined ? { ceiling: policy.ceiling } : {}),
      askAll: policy?.askAll ?? false,
      ...(this.peerTurn ? { peerTurn: true } : {}),
    });

    // SELFHOST-009: fire PermissionDecision (INFORMATIONAL-ONLY, non-blocking) right after the
    // decision is made. Fire-and-forget — the hook cannot change the outcome that follows.
    this.firePermissionDecisionHook(toolName, toolArgs, decision, hookTraceEnv);

    if (decision === 'auto') return true;
    if (decision === 'deny') {
      this.denials.record(toolName, toolArgs, 'policy');
      return false;
    }

    // 'approve' — route to the human-approval path. An ask that must reach a person every time is
    // not answered by a remembered consent, and does not create one (issue #3081).
    const fresh = requiresFreshApproval(toolName, toolArgs, rules, where);
    // In auto mode the classifier stands in for the person, except where a person is required: an
    // ask rule, a critical removal or protected path, or a policy that asks about everything.
    if (mode === 'auto' && this.autoMode !== undefined && !fresh && policy?.askAll !== true) {
      return this.decideInAutoMode(
        this.autoMode,
        toolName,
        toolArgs,
        signal,
        interaction,
        hookTraceEnv,
        scope,
      );
    }
    return this.promptForApproval(toolName, toolArgs, signal, interaction, fresh);
  }

  private async decideInAutoMode(
    gate: AutoModeGate,
    toolName: string,
    toolArgs: TToolArgs,
    signal: AbortSignal | undefined,
    interaction: IToolExecutionContext['permissionInteraction'],
    hookTraceEnv: IToolExecutionContext['hookTraceEnv'],
    scope: IDecisionScope,
  ): Promise<boolean | IPermissionRefusal> {
    if (gate.takeRetry(toolName, toolArgs)) return true;
    // A consent given this session still answers, unless it is one no auto-mode rule could be.
    if (
      matchesAnyPattern(toolName, toolArgs, allowRulesForAutoMode([...this.sessionAllowedTools]))
    ) {
      return true;
    }
    if (gate.isPaused()) {
      const allowed = await this.promptForApproval(toolName, toolArgs, signal, interaction, true);
      if (allowed) gate.resume();
      return allowed;
    }
    const judgement = await gate.judge({ toolName, toolArgs, cwd: this.cwd }, signal);
    if (signal?.aborted === true) return false;
    // The user left auto mode while the classifier was deciding: decide again under the new mode.
    if (this.getPermissionMode() !== 'auto') {
      return this.decidePermission(toolName, toolArgs, signal, interaction, hookTraceEnv, scope);
    }
    if (judgement.kind === 'allow') return true;
    this.denials.record(toolName, toolArgs, 'classifier', judgement.reason);
    return { message: judgement.message };
  }

  /**
   * The human-approval path: session-scoped allow list → custom handler → injected approval fn → fail-closed
   * deny. Every `approve` decision comes here, whoever the caller, so every ask fails closed identically
   * when no approver is attached (e.g. a detached background task).
   */
  private async promptForApproval(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
    interaction: IToolExecutionContext['permissionInteraction'] = 'interactive',
    fresh = false,
  ): Promise<boolean> {
    const scope = consentScopeFor(toolName, toolArgs);
    const cancelledBeforeAsking = signal?.aborted === true;
    const hasApprover =
      interaction === 'interactive' &&
      (this.permissionHandler !== undefined || this.promptForApprovalFn !== undefined);
    const outcome = await decideApproval({
      toolName,
      alreadyAllowed:
        !fresh && matchesAnyPattern(toolName, toolArgs, [...this.sessionAllowedTools]),
      ...(interaction === 'interactive' && this.permissionHandler
        ? { handler: this.permissionHandler }
        : {}),
      ...(interaction === 'interactive' && this.promptForApprovalFn
        ? { injectedPrompt: this.promptForApprovalFn, terminal: this.terminal }
        : {}),
      toolArgs,
      ...(signal ? { signal } : {}),
    });
    // A turn cancelled before anyone was asked is not a refusal of this call.
    if (!outcome.allowed && !cancelledBeforeAsking) {
      this.denials.record(toolName, toolArgs, hasApprover ? 'user' : 'no-approver');
    }
    // A fresh-approval answer covers this call only: remembering its wide scope would let it answer
    // the next critical removal or protected write too.
    if (fresh) return outcome.allowed;
    if (outcome.rememberForProject) {
      if (this.onProjectAllowTool === undefined) {
        throw new Error('Project-wide permission persistence is unavailable for this session.');
      }
      this.onProjectAllowTool(scope);
    }
    if (outcome.rememberForSession) this.sessionAllowedTools.add(scope);
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
    hookTraceEnv: IToolExecutionContext['hookTraceEnv'],
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
      hookTraceEnv,
    ).catch(() => undefined);
  }

  /** Whether the OS sandbox confines this shell command and lets it run without a prompt. */
  private sandboxAutoApproves(toolName: string, toolArgs: TToolArgs): boolean {
    if (this.commandSandbox === undefined) return false;
    const argument = getToolPermissionProfile(toolName).argument;
    if (argument?.kind !== 'command') return false;
    const command = toolArgs[argument.key];
    return typeof command === 'string' && this.commandSandbox.autoApproves(toolName, command);
  }

  /** Delegate session event to the injected logger. */
  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }
}
