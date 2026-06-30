/**
 * Permission mode definitions for Robota CLI
 *
 * Matches Claude Code-compatible permission modes:
 * - plan: read-only tools only (Read, Glob, Grep, WebFetch, WebSearch auto; Write, Edit, Bash denied)
 * - default: safe reads auto, writes and bash need approval
 * - acceptEdits: reads + writes auto, bash needs approval
 * - bypassPermissions: all tools auto
 */

import type { TPermissionMode, TPermissionDecision } from './types.js';

/**
 * Tool names known to the permission system
 */
export type TKnownToolName =
  | 'Shell'
  | 'Bash'
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'WebFetch'
  | 'WebSearch';

/**
 * Permission mode → tool policy matrix
 * Maps each mode to a decision for each known tool.
 */
export const MODE_POLICY: Record<TPermissionMode, Record<TKnownToolName, TPermissionDecision>> = {
  plan: {
    Shell: 'deny',
    Bash: 'deny',
    Read: 'auto',
    Write: 'deny',
    Edit: 'deny',
    Glob: 'auto',
    Grep: 'auto',
    WebFetch: 'auto',
    WebSearch: 'auto',
  },
  default: {
    Shell: 'approve',
    Bash: 'approve',
    Read: 'auto',
    Write: 'approve',
    Edit: 'approve',
    Glob: 'auto',
    Grep: 'auto',
    WebFetch: 'auto',
    WebSearch: 'auto',
  },
  acceptEdits: {
    Shell: 'approve',
    Bash: 'approve',
    Read: 'auto',
    Write: 'auto',
    Edit: 'auto',
    Glob: 'auto',
    Grep: 'auto',
    WebFetch: 'auto',
    WebSearch: 'auto',
  },
  bypassPermissions: {
    Shell: 'auto',
    Bash: 'auto',
    Read: 'auto',
    Write: 'auto',
    Edit: 'auto',
    Glob: 'auto',
    Grep: 'auto',
    WebFetch: 'auto',
    WebSearch: 'auto',
  },
};

/**
 * Fallback decision when a tool name is not in the policy matrix.
 * Unknown tools are treated as requiring approval (fail-safe).
 */
export const UNKNOWN_TOOL_FALLBACK: Record<TPermissionMode, TPermissionDecision> = {
  plan: 'deny',
  default: 'approve',
  acceptEdits: 'approve',
  bypassPermissions: 'auto',
};
