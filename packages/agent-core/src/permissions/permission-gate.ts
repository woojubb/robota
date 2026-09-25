/**
 * Permission gate — evaluates whether a tool call is auto-approved, needs user approval, or denied.
 *
 * ONE ordered policy for every caller class (issue #3081): the interactive session, background
 * tasks and subagents differ only in the context they pass, never in the order.
 *
 * 1. Deny list match → deny
 * 2. Outside the caller's ceiling → deny, in every mode
 * 3. Deny list UNEVALUABLE (CORE-030) → ask
 * 4. Never-auto-approve set → ask, in every mode: an ask rule, a critical-path removal, a
 *    modify-class call on a protected path
 * 5. The caller asks about everything → ask
 * 6. bypassPermissions → auto
 * 7. Allow list match → auto
 * 8. Mode policy lookup
 *
 * In plan mode an ask about anything but an inspect-class call is a deny.
 *
 * Pattern syntax (same as Claude Code):
 * - `Bash(pnpm *)` — Bash tool whose command starts with "pnpm "
 * - `Read(/src/**)` — Read tool whose filePath is under /src/
 * - `Write(*)`      — Write tool with any argument
 * - `ToolName`      — match any invocation of that tool
 * - `Bash(run_in_background:true)` — deny/ask only: a named top-level parameter's value
 * - `github__*`     — a glob in the tool-name position (allow only after a literal `<server>__`)
 */

import { globToRegex, matchCommand, matchPath, matchUrl } from './argument-matchers.js';
import { RISK_CLASS_POLICY, UNCLASSIFIED_TOOL_FALLBACK } from './permission-mode.js';
import { isProtectedPath, removesCriticalPath } from './permission-safeguards.js';
import { isReadOnlyCommandLine } from './read-only-commands.js';
import type { TResolveInWorkspace } from './read-only-commands.js';

import type { TArgumentKind, TMatchDirection, TPatternMatch } from './argument-matchers.js';
import type { TToolRiskClass } from './permission-mode.js';
import type { ICriticalPathContext } from './permission-safeguards.js';
import type { TPermissionMode, TPermissionDecision } from './types.js';

/**
 * Tool arguments passed from the LLM invocation.
 * The values relevant to permission matching are strings.
 */
export type TToolArgs = Record<string, string | number | boolean | object>;

/**
 * Permission list entries (allow / deny / ask).
 * Each entry is a pattern string such as "Bash(pnpm *)" or "Read(/src/**)".
 */
export interface IPermissionLists {
  allow?: readonly string[];
  deny?: readonly string[];
  /** Calls that always ask, in every mode including bypassPermissions. */
  ask?: readonly string[];
}

/** What the caller adds to the rules: where it runs, and how far it may go. */
export interface IPermissionEvaluationContext extends ICriticalPathContext {
  /**
   * The most this caller may do. A call no pattern here matches is denied in every mode, bypass
   * included. Absent means no ceiling; an empty list denies everything.
   */
  ceiling?: readonly string[];
  /** Every call that is not denied asks, whatever the mode or allow list says. */
  askAll?: boolean;
  /**
   * Where a path really is, symlinks followed, or `undefined` outside the workspace. Supplied by a
   * host with a filesystem; without it a read-only command naming a path is not treated as a read.
   */
  resolveInWorkspace?: TResolveInWorkspace;
  /**
   * This call runs inside an OS sandbox whose settings let a confined command proceed without a
   * prompt. It turns an `execute` ask into `auto` in `default` and `acceptEdits` only; everything
   * before the mode step, and plan mode's refusal, still hold.
   */
  sandboxAutoApproved?: boolean;
}

/**
 * Parse a permission pattern entry into tool name and optional argument pattern.
 *
 * Examples:
 * - "Bash"             → { toolName: "Bash", argPattern: undefined }
 * - "Bash(pnpm *)"     → { toolName: "Bash", argPattern: "pnpm *" }
 * - "Read(/src/**)"    → { toolName: "Read", argPattern: "/src/**" }
 */
export function parsePattern(pattern: string): {
  toolName: string;
  argPattern: string | undefined;
} {
  const parenIdx = pattern.indexOf('(');
  if (parenIdx === -1) {
    return { toolName: pattern.trim(), argPattern: undefined };
  }

  const toolName = pattern.slice(0, parenIdx).trim();
  const argPattern = pattern.slice(parenIdx + 1, pattern.lastIndexOf(')')).trim();
  return { toolName, argPattern };
}

/**
 * What a tool's owner declares about it for permission purposes.
 *
 * Both halves used to live in this file as hardcoded product-name tables — an argument-key `switch`
 * and a mode-policy matrix keyed on a closed union of tool names — two layers below the packages
 * that define those tools, with nothing coupling the lists. CORE-030.
 */
/**
 * The argument a tool's permission patterns are scoped to, and what kind of thing it is. One
 * object, so a key cannot be declared without its kind — a key alone would leave the tool on the
 * string glob that matched a URL's query as its host (CORE-049).
 */
export type { TArgumentKind, TMatchDirection, TPatternMatch } from './argument-matchers.js';

export interface IToolPermissionArgument {
  /** `Shell(rm *)` matches against `command`; `Read(/src/**)` against `filePath`. */
  key: string;
  /** How a pattern is matched against that argument. */
  kind: TArgumentKind;
}

export interface IToolPermissionProfile {
  /**
   * Which argument this tool's permission patterns are scoped to, and its kind.
   *
   * Without it an argument-scoped pattern is UNEVALUABLE for this tool (a bare `Tool(*)` still
   * matches — it names no argument), and an unevaluable deny is not an allow — the gate prompts
   * rather than proceeding.
   */
  argument?: IToolPermissionArgument;
  /**
   * What kind of action this tool performs, which is what the modes actually decide about.
   *
   * Omitting it is not neutral: an unclassified tool takes the fallback, which prompts on every
   * call and is refused in plan mode.
   */
  riskClass?: TToolRiskClass;
  /**
   * The tool's top-level input parameter names. `Tool(name:value)` is a parameter rule only when
   * `name` is one of these — keyed on the schema, not the text's shape, so `WebFetch(https://…)`
   * stays a URL pattern. Declared by whoever holds the schema (the session registers every tool it
   * wraps, MCP tools included).
   */
  parameters?: readonly string[];
}

/** Profiles contributed by the packages that own the tools. */
const toolProfiles = new Map<string, IToolPermissionProfile>();

/**
 * Declare how a tool is treated by the permission system. CORE-030.
 *
 * Called by the package that DEFINES the tool, at the point it is created, so a tool's existence
 * and its classification arrive together. The foundation cannot know a product's tool inventory,
 * and every attempt to hardcode it drifted: `Agent`, `BackgroundProcess`, `CodebaseRetrieval` and
 * `ExecuteCommand` were all produced tools the old matrix had never heard of.
 *
 * Merges rather than replaces, so a tool may declare its argument key and its risk class from
 * different places without one silently erasing the other.
 */
export function registerToolPermissionProfile(
  toolName: string,
  profile: IToolPermissionProfile,
): void {
  toolProfiles.set(toolName, { ...toolProfiles.get(toolName), ...profile });
}

/** Forget registered profiles. For tests and for hosts that rebuild a registry. */
export function clearRegisteredToolProfiles(): void {
  toolProfiles.clear();
}

/** What has been declared about a tool, or an empty profile when nobody has said anything. */
export function getToolPermissionProfile(toolName: string): IToolPermissionProfile {
  return toolProfiles.get(toolName) ?? {};
}

/** Whether a pattern's tool-name part names this tool: exact, or a `*` glob over the name. */
export function toolNameMatches(patternName: string, toolName: string): boolean {
  return patternName.includes('*')
    ? globToRegex(patternName).test(toolName)
    : patternName === toolName;
}

/** A `name:value` argument pattern that names one of the tool's parameters. */
export interface IParameterRule {
  name: string;
  value: string;
}

/**
 * Read an argument pattern as a parameter rule. `'primary'` when it names the tool's primary field
 * — that field is matched by the ordinary `Tool(pattern)` form, and a rule written against it is
 * refused rather than silently ignored. `undefined` when it is an ordinary argument pattern.
 */
export function parseParameterRule(
  toolName: string,
  argPattern: string,
): IParameterRule | 'primary' | undefined {
  const match = /^([A-Za-z_]\w*):([\s\S]*)$/.exec(argPattern);
  if (match === null) return undefined;
  const name = match[1]!;
  const profile = toolProfiles.get(toolName);
  if (profile?.argument?.key === name) return 'primary';
  if (profile?.parameters?.includes(name) !== true) return undefined;
  return { name, value: match[2]! };
}

/** A parameter's value against the rule's glob, compared as the model sent it (issue #3081). */
function matchParameter(rule: IParameterRule, args: TToolArgs): TPatternMatch {
  if (!Object.prototype.hasOwnProperty.call(args, rule.name)) return 'no-match';
  const value: unknown = args[rule.name];
  if (value === undefined) return 'no-match';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return 'unevaluable';
  }
  return globToRegex(rule.value).test(String(value)) ? 'match' : 'no-match';
}

/**
 * Whether a deny list removes this tool outright — a bare name, `Tool(*)` or `Tool(**)`, glob names
 * included. Such a tool is withheld from the model entirely rather than offered and then refused.
 */
export function isToolDeniedOutright(toolName: string, deny: readonly string[]): boolean {
  return deny.some((pattern) => {
    const parsed = parsePattern(pattern);
    const bare =
      parsed.argPattern === undefined || parsed.argPattern === '*' || parsed.argPattern === '**';
    return bare && toolNameMatches(parsed.toolName, toolName);
  });
}

/** Which argument a pattern is matched against, or `undefined` when nobody has said. */
function argumentKeyFor(toolName: string): string | undefined {
  return toolProfiles.get(toolName)?.argument?.key;
}

function primaryArg(toolName: string, args: TToolArgs): string | undefined {
  const key = argumentKeyFor(toolName);
  if (key === undefined) return undefined;
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Test whether a tool invocation matches ANY pattern in a list (allow or deny).
 * Shared by `evaluatePermission` and the CORE-025 policy resolver so pattern semantics stay in one place.
 *
 * `direction` says which list these patterns came from. It defaults to `'allow'`, the narrower
 * reading, so a caller that forgets it never widens what a deny entry lets through — a DENY list
 * must pass `'deny'` explicitly, because for a `command` argument the two directions differ (see
 * {@link TMatchDirection}).
 */
export function matchesAnyPattern(
  toolName: string,
  args: TToolArgs,
  patterns: readonly string[],
  direction: TMatchDirection = 'allow',
): boolean {
  return patterns.some(
    (pattern) => evaluateArgumentPattern(toolName, args, pattern, direction) === 'match',
  );
}

/**
 * Whether an argument-scoped pattern for this tool cannot be evaluated at all. CORE-030.
 *
 * `matchesPattern` answers `false` when the argument is unknowable, and `false` from a DENY list
 * means "not denied" — so `MyTool(secrets/**)` lost to a broader `allow: ['MyTool']` and the
 * invocation was auto-approved. "I cannot tell" is not "no".
 */
export function hasUnevaluableArgumentPattern(
  toolName: string,
  args: TToolArgs,
  patterns: readonly string[],
): boolean {
  // Two shapes of "I cannot tell": nobody declared which argument the pattern is about (CORE-030),
  // or the argument or the pattern cannot be interpreted in the declared kind (CORE-049). A tool
  // whose key IS known but which was invoked without that argument is a real NON-match — the
  // pattern is about `path`, there is no path, so there is nothing to deny — and it goes back to
  // the allow list. (Review of #1596 caught those two conditions collapsing into one.)
  return patterns.some(
    (pattern) => evaluateArgumentPattern(toolName, args, pattern, 'deny') === 'unevaluable',
  );
}

/**
 * One invocation against one permission pattern entry: `match`, `no-match`, or `unevaluable`.
 *
 * `direction` reaches only the `command` matcher, the one kind whose answer depends on which list
 * the pattern came from (see {@link TMatchDirection}).
 */
function evaluateArgumentPattern(
  toolName: string,
  args: TToolArgs,
  pattern: string,
  direction: TMatchDirection,
): TPatternMatch {
  const parsed = parsePattern(pattern);

  // Tool name must match (case-sensitive), exactly or by a name glob.
  if (!toolNameMatches(parsed.toolName, toolName)) {
    return 'no-match';
  }

  // No argument constraint, or a bare wildcard → any invocation of that tool, whatever its kind —
  // and whether or not it declared an argument: `Tool(*)` names none.
  if (parsed.argPattern === undefined || parsed.argPattern === '*' || parsed.argPattern === '**') {
    return 'match';
  }

  // A named parameter (issue #3081). Deny and ask only: in an allow list it never widens anything.
  const parameterRule = parseParameterRule(toolName, parsed.argPattern);
  if (parameterRule === 'primary') return 'unevaluable';
  if (parameterRule !== undefined) {
    return direction === 'deny' ? matchParameter(parameterRule, args) : 'no-match';
  }

  // Nobody declared which argument this pattern is about (CORE-030)
  const argument = toolProfiles.get(toolName)?.argument;
  if (argument === undefined) {
    return 'unevaluable';
  }

  const primary = primaryArg(toolName, args);
  if (primary === undefined) {
    return 'no-match';
  }

  switch (argument.kind) {
    case 'url':
      return matchUrl(parsed.argPattern, primary);
    case 'path':
      return matchPath(parsed.argPattern, primary);
    case 'command':
      return matchCommand(parsed.argPattern, primary, direction);
    case 'text':
      return globToRegex(parsed.argPattern).test(primary) ? 'match' : 'no-match';
    default: {
      // A kind this switch does not name would otherwise land on the string glob — the failure
      // mode CORE-049 removes. The compiler holds the enumeration closed.
      const exhaustive: never = argument.kind;
      throw new Error(`unknown argument kind: ${String(exhaustive)}`);
    }
  }
}

/** Whether a call belongs to the never-auto-approve set beyond explicit ask rules. */
function isNeverAutoApproved(
  toolName: string,
  toolArgs: TToolArgs,
  context: ICriticalPathContext,
): boolean {
  const profile = toolProfiles.get(toolName);
  const argument = profile?.argument;
  if (argument === undefined) return false;
  const value = toolArgs[argument.key];
  if (typeof value !== 'string') return false;
  if (argument.kind === 'command') return removesCriticalPath(value, context);
  if (argument.kind === 'path' && profile?.riskClass === 'modify') return isProtectedPath(value);
  return false;
}

/** An ask rule matches the call, or cannot be evaluated for it, or the call is in the never-auto set. */
function isMandatoryAsk(
  toolName: string,
  toolArgs: TToolArgs,
  ask: readonly string[],
  context: ICriticalPathContext,
): boolean {
  return (
    matchesAnyPattern(toolName, toolArgs, ask, 'deny') ||
    hasUnevaluableArgumentPattern(toolName, toolArgs, ask) ||
    isNeverAutoApproved(toolName, toolArgs, context)
  );
}

/**
 * Whether an ask about this call must reach a person EVERY time — never answered by a consent the
 * session or project remembered from an earlier call. A remembered scope is wide (`Bash(rm *)`
 * from one `rm -rf build`); honouring it here would let one approval stand in for every later
 * critical-path removal, protected write or ask-rule call (issue #3081).
 */
export function requiresFreshApproval(
  toolName: string,
  toolArgs: TToolArgs,
  permissions: IPermissionLists = {},
  context: ICriticalPathContext = {},
): boolean {
  return (
    hasUnevaluableArgumentPattern(toolName, toolArgs, permissions.deny ?? []) ||
    isMandatoryAsk(toolName, toolArgs, permissions.ask ?? [], context)
  );
}

/** Arguments that move a command out of the session's working directory. */
const DIRECTORY_ARGUMENT_KEYS = ['workingDirectory', 'cwd'] as const;

/**
 * The tool's declared risk class, narrowed for this one call: a command tool running only built-in
 * read-only commands is decided like a read.
 */
function effectiveRiskClass(
  toolName: string,
  toolArgs: TToolArgs,
  context: IPermissionEvaluationContext,
): TToolRiskClass | undefined {
  const profile = toolProfiles.get(toolName);
  if (profile?.riskClass !== 'execute' || profile.argument?.kind !== 'command') {
    return profile?.riskClass;
  }
  const command = toolArgs[profile.argument.key];
  if (typeof command !== 'string') return profile.riskClass;
  const otherDirectory = DIRECTORY_ARGUMENT_KEYS.some((key) => toolArgs[key] !== undefined);
  const readOnly = isReadOnlyCommandLine(command, {
    otherDirectory,
    ...(context.resolveInWorkspace !== undefined
      ? { resolveInWorkspace: context.resolveInWorkspace }
      : {}),
  });
  return readOnly ? 'inspect' : profile.riskClass;
}

/**
 * Evaluate whether a tool invocation should be auto-approved, require user approval, or be denied.
 *
 * @param toolName    Name of the tool being invoked (e.g. "Bash", "Write")
 * @param toolArgs    Arguments provided by the LLM
 * @param mode        Active permission mode
 * @param permissions Allow/deny/ask lists from config
 * @param context     The caller's execution root, home directory, ceiling and ask-everything flag
 */
export function evaluatePermission(
  toolName: string,
  toolArgs: TToolArgs,
  mode: TPermissionMode,
  permissions: IPermissionLists = {},
  context: IPermissionEvaluationContext = {},
): TPermissionDecision {
  const { allow = [], deny = [], ask = [] } = permissions;
  const riskClass = effectiveRiskClass(toolName, toolArgs, context);
  // Plan mode's promise is "change nothing": an ask about anything that could change something is
  // a refusal there, and only an inspect-class call may still reach a person.
  const askDecision: TPermissionDecision =
    mode === 'plan' && riskClass !== 'inspect' ? 'deny' : 'approve';

  // 1. A matching deny blocks immediately.
  if (matchesAnyPattern(toolName, toolArgs, deny, 'deny')) {
    return 'deny';
  }

  // 2. The caller's ceiling only narrows. It is checked before bypass, so a background task or
  //    subagent under a permissive mode still cannot reach past what it was given (CORE-025).
  if (context.ceiling !== undefined && !matchesAnyPattern(toolName, toolArgs, context.ceiling)) {
    return 'deny';
  }

  // 3. CORE-030: a deny the gate could not EVALUATE is not a deny that did not match. Asking is
  //    the answer: refusing outright would break a call the pattern was never about, and
  //    auto-approving is what this exists to stop. Plan mode refuses.
  if (hasUnevaluableArgumentPattern(toolName, toolArgs, deny)) {
    return mode === 'plan' ? 'deny' : 'approve';
  }

  // 4. The never-auto-approve set holds in every mode, bypass included. An ask rule is read in
  //    the deny direction, and one it cannot evaluate asks too: both are "stop and ask".
  if (isMandatoryAsk(toolName, toolArgs, ask, context)) {
    return askDecision;
  }

  // 5. The caller routes every remaining call to a person.
  if (context.askAll === true) {
    return askDecision;
  }

  // 6. Bypass proceeds with everything the steps above let through; allow rules add nothing.
  if (mode === 'bypassPermissions') {
    return 'auto';
  }

  // 7. Allow list.
  if (matchesAnyPattern(toolName, toolArgs, allow)) {
    return 'auto';
  }

  // 8. What the mode says about this KIND of action, which is the only thing it decides. A command
  //    the OS confines is the exception the user opted into: it proceeds where the mode would ask.
  if (
    context.sandboxAutoApproved === true &&
    riskClass === 'execute' &&
    (mode === 'default' || mode === 'acceptEdits' || mode === 'auto')
  ) {
    return 'auto';
  }
  if (riskClass !== undefined) {
    return RISK_CLASS_POLICY[mode][riskClass];
  }

  // Nobody declared what this tool does — fail safe, which means ask rather than proceed.
  return UNCLASSIFIED_TOOL_FALLBACK[mode];
}
