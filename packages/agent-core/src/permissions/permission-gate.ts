/**
 * Permission gate — evaluates whether a tool call is auto-approved, needs user approval, or denied.
 *
 * Deterministic policy, in order of precedence:
 * 1. Deny list match → deny
 * 2. Deny list UNEVALUABLE (CORE-030) → approve (prompt), or deny in plan mode
 * 3. Allow list match → auto
 * 4. Mode policy lookup
 *
 * Pattern syntax (same as Claude Code):
 * - `Bash(pnpm *)` — Bash tool whose command starts with "pnpm "
 * - `Read(/src/**)` — Read tool whose filePath is under /src/
 * - `Write(*)`      — Write tool with any argument
 * - `ToolName`      — match any invocation of that tool
 */

import { globToRegex, matchCommand, matchPath, matchUrl } from './argument-matchers.js';
import { RISK_CLASS_POLICY, UNCLASSIFIED_TOOL_FALLBACK } from './permission-mode.js';

import type { TArgumentKind, TPatternMatch } from './argument-matchers.js';
import type { TToolRiskClass } from './permission-mode.js';
import type { TPermissionMode, TPermissionDecision } from './types.js';

/**
 * Tool arguments passed from the LLM invocation.
 * The values relevant to permission matching are strings.
 */
export type TToolArgs = Record<string, string | number | boolean | object>;

/**
 * Permission list entries (allow / deny).
 * Each entry is a pattern string such as "Bash(pnpm *)" or "Read(/src/**)".
 */
export interface IPermissionLists {
  allow?: string[];
  deny?: string[];
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
export type { TArgumentKind, TPatternMatch } from './argument-matchers.js';

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
 */
export function matchesAnyPattern(
  toolName: string,
  args: TToolArgs,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => evaluateArgumentPattern(toolName, args, pattern) === 'match');
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
    (pattern) => evaluateArgumentPattern(toolName, args, pattern) === 'unevaluable',
  );
}

/**
 * One invocation against one permission pattern entry: `match`, `no-match`, or `unevaluable`.
 */
function evaluateArgumentPattern(
  toolName: string,
  args: TToolArgs,
  pattern: string,
): TPatternMatch {
  const parsed = parsePattern(pattern);

  // Tool name must match (case-sensitive)
  if (parsed.toolName !== toolName) {
    return 'no-match';
  }

  // No argument constraint, or a bare wildcard → any invocation of that tool, whatever its kind —
  // and whether or not it declared an argument: `Tool(*)` names none.
  if (parsed.argPattern === undefined || parsed.argPattern === '*' || parsed.argPattern === '**') {
    return 'match';
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
      return matchCommand(parsed.argPattern, primary);
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

/**
 * Evaluate whether a tool invocation should be auto-approved, require user approval, or be denied.
 *
 * @param toolName   Name of the tool being invoked (e.g. "Bash", "Write")
 * @param toolArgs   Arguments provided by the LLM
 * @param mode       Active permission mode
 * @param permissions Optional allow/deny lists from config
 */
export function evaluatePermission(
  toolName: string,
  toolArgs: TToolArgs,
  mode: TPermissionMode,
  permissions: IPermissionLists = {},
): TPermissionDecision {
  const { allow = [], deny = [] } = permissions;

  // Step 1: deny list — if any deny pattern matches, block immediately
  if (matchesAnyPattern(toolName, toolArgs, deny)) {
    return 'deny';
  }

  // CORE-030: a deny the gate could not EVALUATE is not a deny that did not match. When the
  // argument a pattern is scoped to is unknowable for this tool, the previous code answered "not
  // denied" and — in `default` and `acceptEdits` — went on to AUTO-approve. The operator wrote a
  // deny and got an approval.
  //
  // `'approve'` in this vocabulary means "ask the user", which is the right answer here: refusing
  // outright would break a legitimate invocation the pattern was never about, and auto-approving is
  // what this exists to stop. `plan` mode still denies, matching its fallback.
  if (hasUnevaluableArgumentPattern(toolName, toolArgs, deny)) {
    return mode === 'plan' ? 'deny' : 'approve';
  }

  // Step 2: allow list — if any allow pattern matches, auto-approve
  if (matchesAnyPattern(toolName, toolArgs, allow)) {
    return 'auto';
  }

  // Step 3: what the mode says about this KIND of action, which is the only thing it decides.
  const riskClass = toolProfiles.get(toolName)?.riskClass;
  if (riskClass !== undefined) {
    return RISK_CLASS_POLICY[mode][riskClass];
  }

  // Nobody declared what this tool does — fail safe, which means ask rather than proceed.
  return UNCLASSIFIED_TOOL_FALLBACK[mode];
}
