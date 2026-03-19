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

import type { TPermissionMode, TPermissionDecision } from '../types.js';
import { MODE_POLICY, UNKNOWN_TOOL_FALLBACK } from './permission-mode.js';

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
 *   Bash → args.command
 *   Read → args.filePath
 *   Write → args.filePath
 *   Edit → args.filePath
 *   Glob → args.pattern
 *   Grep → args.pattern
 */
function primaryArg(toolName: string, args: TToolArgs): string | undefined {
  switch (toolName) {
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
  for (const pattern of deny) {
    if (matchesPattern(toolName, toolArgs, pattern)) {
      return 'deny';
    }
  }

  // Step 2: allow list — if any allow pattern matches, auto-approve
  for (const pattern of allow) {
    if (matchesPattern(toolName, toolArgs, pattern)) {
      return 'auto';
    }
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
