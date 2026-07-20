/**
 * Permission system types — Claude Code compatible permission model.
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
 * Per-task permission policy for a spawned background / subagent task (CORE-025).
 *
 * SSOT lives here (the permission-logic home) rather than in a transport package, because
 * `agent-interface-transport` → `agent-core` is a one-way dependency; the transport contract
 * (`IAgentBackgroundTaskRequest.permissionPolicy`) imports + re-exports this union.
 *
 * - `inherit-allowlist` (default): inherit the parent session allow/deny rules — matched → allow,
 *   unmatched → deny (never prompt). The detached-safe locked-down default.
 * - `preapproved`: allow only the task's own declared allowlist; everything else denies.
 * - `prompt`: route to a human approver; fail-closed to deny when no surface can answer.
 * - `deny`: deny every privileged call (call-scoped structured deny; does not force-fail the task).
 */
export type TBackgroundPermissionPolicy = 'inherit-allowlist' | 'preapproved' | 'prompt' | 'deny';
