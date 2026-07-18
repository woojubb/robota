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
  | 'WebSearch'
  | 'AskUserQuestion'
  // SELFHOST-010: computer-use. `ComputerView` (perceive) is decided EXACTLY like `Read`; `Computer`
  // (mutating action) is decided EXACTLY like `Shell` — read-vs-mutate, no new gate.
  | 'ComputerView'
  | 'Computer';

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
    AskUserQuestion: 'auto',
    // SELFHOST-010: perceive mirrors Read (auto in plan → read-only inspection works in plan);
    // mutate mirrors Shell (deny in plan).
    ComputerView: 'auto',
    Computer: 'deny',
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
    AskUserQuestion: 'auto',
    ComputerView: 'auto',
    Computer: 'approve',
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
    AskUserQuestion: 'auto',
    // A GUI mutation is not a file edit, so acceptEdits' edit-auto does not cover it (mirror Shell).
    ComputerView: 'auto',
    Computer: 'approve',
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
    AskUserQuestion: 'auto',
    ComputerView: 'auto',
    Computer: 'auto',
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
