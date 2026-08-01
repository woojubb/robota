/**
 * Permission gate — evaluates whether a tool call is auto-approved, needs user approval, or denied.
 *
 * Three-step deterministic policy (in order of precedence):
 * 1. Deny list match → deny
 * 2. Allow list match → auto
 * 3. Mode policy lookup
 *
 * Pattern syntax (same as Claude Code):
 * - `Bash(pnpm *)` — Bash tool whose command starts with "pnpm "
 * - `Read(/src/**)` — Read tool whose filePath is under /src/
 * - `Write(*)`      — Write tool with any argument
 * - `ToolName`      — match any invocation of that tool
 */

import { MODE_POLICY, UNKNOWN_TOOL_FALLBACK } from './permission-mode.js';

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
 * Convert a glob-style wildcard pattern to a RegExp.
 * Only `*` and `**` wildcards are supported (same semantics as minimatch lite).
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * ?
    .replace(/\*\*/g, '.+') // ** → one-or-more any char
    .replace(/\*/g, '.*'); // * → zero-or-more any char (shell-style, not path-segment restricted)
  return new RegExp(`^${escaped}$`);
}

/**
 * Parse a permission pattern entry into tool name and optional argument pattern.
 *
 * Examples:
 * - "Bash"             → { toolName: "Bash", argPattern: undefined }
 * - "Bash(pnpm *)"     → { toolName: "Bash", argPattern: "pnpm *" }
 * - "Read(/src/**)"    → { toolName: "Read", argPattern: "/src/**" }
 */
function parsePattern(pattern: string): { toolName: string; argPattern: string | undefined } {
  const parenIdx = pattern.indexOf('(');
  if (parenIdx === -1) {
    return { toolName: pattern.trim(), argPattern: undefined };
  }

  const toolName = pattern.slice(0, parenIdx).trim();
  const argPattern = pattern.slice(parenIdx + 1, pattern.lastIndexOf(')')).trim();
  return { toolName, argPattern };
}

/**
 * Return the "primary" argument value for a tool to match against argument patterns.
 * The matching argument depends on the tool:
 *   Shell/Bash → args.command
 *   Read → args.filePath
 *   Write → args.filePath
 *   Edit → args.filePath
 *   Glob → args.pattern
 *   Grep → args.pattern
 */
const registeredArgumentKeys = new Map<string, string>();

/**
 * Declare which argument a tool's permission patterns are scoped to. CORE-030.
 *
 * The switch below is a hardcoded list of PRODUCT tool names in the vendor-neutral foundation, and
 * a tool it has never heard of had no way onto it. That is not merely a layering complaint: an
 * argument-scoped deny for such a tool could never match, and evaluation fell through to
 * `UNKNOWN_TOOL_FALLBACK`, which is `'approve'` in `default` and `acceptEdits`. A deny that silently
 * becomes an approve is the worst direction for this particular failure.
 *
 * A tool's owner registers its key; the built-in switch remains until those tools do the same.
 */
export function registerToolArgumentKey(toolName: string, argumentKey: string): void {
  registeredArgumentKeys.set(toolName, argumentKey);
}

/** Forget registered argument keys. For tests and for hosts that rebuild a registry. */
export function clearRegisteredToolArgumentKeys(): void {
  registeredArgumentKeys.clear();
}

/** Whether the argument a pattern would be matched against is knowable for this tool at all. */
function hasKnownArgumentKey(toolName: string): boolean {
  if (registeredArgumentKeys.has(toolName)) return true;
  return ['Shell', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'].includes(toolName);
}

function primaryArg(toolName: string, args: TToolArgs): string | undefined {
  const registeredKey = registeredArgumentKeys.get(toolName);
  if (registeredKey !== undefined) {
    const value = args[registeredKey];
    return typeof value === 'string' ? value : undefined;
  }
  switch (toolName) {
    case 'Shell':
    case 'Bash':
      return typeof args['command'] === 'string' ? args['command'] : undefined;
    case 'Read':
    case 'Write':
    case 'Edit':
      return typeof args['filePath'] === 'string' ? args['filePath'] : undefined;
    case 'Glob':
    case 'Grep':
      return typeof args['pattern'] === 'string' ? args['pattern'] : undefined;
    default:
      return undefined;
  }
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
  return patterns.some((pattern) => matchesPattern(toolName, args, pattern));
}

/**
 * Whether an argument-scoped pattern for this tool cannot be evaluated at all. CORE-030.
 *
 * `matchesPattern` answers `false` when the argument is unknowable, and `false` from a DENY list
 * means "not denied" — so `MyTool(secrets/**)` silently permitted every invocation of a tool the
 * foundation had never heard of. "I cannot tell" is not "no".
 */
function hasUnevaluableArgumentPattern(
  toolName: string,
  args: TToolArgs,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => {
    const parsed = parsePattern(pattern);
    if (parsed.toolName !== toolName || parsed.argPattern === undefined) return false;
    // Knowable in principle but absent from THIS invocation is a real non-match; unknowable at all
    // is the case that must not read as one.
    return !hasKnownArgumentKey(toolName) || primaryArg(toolName, args) === undefined;
  });
}

/**
 * Test whether a tool invocation matches a permission pattern entry.
 */
function matchesPattern(toolName: string, args: TToolArgs, pattern: string): boolean {
  const parsed = parsePattern(pattern);

  // Tool name must match (case-sensitive)
  if (parsed.toolName !== toolName) {
    return false;
  }

  // No argument constraint → matches any invocation of that tool
  if (parsed.argPattern === undefined) {
    return true;
  }

  const primary = primaryArg(toolName, args);
  if (primary === undefined) {
    return false;
  }

  return globToRegex(parsed.argPattern).test(primary);
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

  // Step 3: mode policy lookup
  const modePolicy = MODE_POLICY[mode];
  const knownDecision = modePolicy[toolName as keyof typeof modePolicy];
  if (knownDecision !== undefined) {
    return knownDecision;
  }

  // Unknown tool — use fail-safe fallback per mode
  return UNKNOWN_TOOL_FALLBACK[mode];
}
