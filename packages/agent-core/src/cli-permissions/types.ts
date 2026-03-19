/**
 * Permission and trust types for Robota CLI
 */

/**
 * Permission modes (Claude Code compatible)
 * - plan: read-only tools only
 * - default: reads auto, writes/bash need approval
 * - acceptEdits: reads + writes auto, bash needs approval
 * - bypassPermissions: all tools auto
 */
export type TPermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

/**
 * Friendly trust level aliases
 * - safe   → plan
 * - moderate → default
 * - full   → acceptEdits
 */
export type TTrustLevel = 'safe' | 'moderate' | 'full';

export const TRUST_TO_MODE: Record<TTrustLevel, TPermissionMode> = {
  safe: 'plan',
  moderate: 'default',
  full: 'acceptEdits',
};

/**
 * Outcome of a permission evaluation
 * - auto: proceed without prompting
 * - approve: prompt user for approval
 * - deny: block the action
 */
export type TPermissionDecision = 'auto' | 'approve' | 'deny';

/**
 * Result returned by a CLI tool invocation
 */
export interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}
