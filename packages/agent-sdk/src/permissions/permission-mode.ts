/**
 * Permission mode definitions for Robota CLI
 *
 * Matches Claude Code-compatible permission modes:
 * - plan: read-only tools only (Read, Glob, Grep auto; Write, Edit, Bash denied)
 * - default: safe reads auto, writes and bash need approval
 * - acceptEdits: reads + writes auto, bash needs approval
 * - bypassPermissions: all tools auto
 */

import type { TPermissionMode, TPermissionDecision } from '../types.js';

/**
 * Tool names known to the permission system
 */
export type TKnownToolName = 'Bash' | 'Read' | 'Write' | 'Edit' | 'Glob' | 'Grep';

/**
 * Permission mode → tool policy matrix
 * Maps each mode to a decision for each known tool.
 */
export const MODE_POLICY: Record<TPermissionMode, Record<TKnownToolName, TPermissionDecision>> = {
  plan: {
    Bash: 'deny',
    Read: 'auto',
    Write: 'deny',
    Edit: 'deny',
    Glob: 'auto',
    Grep: 'auto',
  },
  default: {
    Bash: 'approve',
    Read: 'auto',
    Write: 'approve',
    Edit: 'approve',
    Glob: 'auto',
    Grep: 'auto',
  },
  acceptEdits: {
    Bash: 'approve',
    Read: 'auto',
    Write: 'auto',
    Edit: 'auto',
    Glob: 'auto',
    Grep: 'auto',
  },
  bypassPermissions: {
    Bash: 'auto',
    Read: 'auto',
    Write: 'auto',
    Edit: 'auto',
    Glob: 'auto',
    Grep: 'auto',
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
