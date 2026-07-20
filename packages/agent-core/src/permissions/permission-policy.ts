/**
 * Background/subagent permission POLICY resolver (CORE-025).
 *
 * A spawned background task carries a `permissionPolicy` (`inherit-allowlist | preapproved | prompt | deny`).
 * This pure function maps that policy — together with the task's own and the parent session's allow/deny
 * rules — onto a single permission decision (`allow | deny | prompt`), so the enforcement site
 * (`create-subagent-session`) can gate a tool call BEFORE the session-mode `auto` branch and thus be MORE
 * restrictive than the session mode (e.g. `deny`/`preapproved` must block even under `bypassPermissions`).
 *
 * Precedence mirrors `evaluatePermission` (deny > allow), extended for the policy layer:
 *   1. `deny` policy → deny (absolute).
 *   2. an explicit deny-list match → deny (task or parent, deny beats allow).
 *   3. `prompt` policy → prompt (the caller routes to the approver; fail-closes on no surface).
 *   4. `preapproved` → the TASK allowlist; `inherit-allowlist` → the PARENT allowlist. Matched → allow,
 *      unmatched → deny (never prompt) — the detached-safe locked-down semantics.
 */

import { matchesAnyPattern } from './permission-gate.js';

import type { TToolArgs } from './permission-gate.js';
import type { TBackgroundPermissionPolicy } from './types.js';

/** Outcome of the policy resolution. `prompt` means "route to the human approver". */
export type TPermissionPolicyDecision = 'allow' | 'deny' | 'prompt';

/**
 * Allow/deny rules available to the resolver. `task*` are the spawned task's own declared lists;
 * `parent*` are the parent session's rules that `inherit-allowlist` inherits.
 */
export interface IPermissionPolicyContext {
  taskAllow?: readonly string[];
  taskDeny?: readonly string[];
  parentAllow?: readonly string[];
  parentDeny?: readonly string[];
}

export function resolvePermissionByPolicy(
  policy: TBackgroundPermissionPolicy,
  toolName: string,
  toolArgs: TToolArgs,
  context: IPermissionPolicyContext = {},
): TPermissionPolicyDecision {
  // 1. `deny` policy denies every privileged call, absolutely.
  if (policy === 'deny') return 'deny';

  // 2. An explicit deny-list match always wins (deny > allow > prompt) — task or parent.
  const taskDeny = context.taskDeny ?? [];
  const parentDeny = context.parentDeny ?? [];
  if (
    matchesAnyPattern(toolName, toolArgs, taskDeny) ||
    matchesAnyPattern(toolName, toolArgs, parentDeny)
  ) {
    return 'deny';
  }

  // 3. `prompt` routes to the human approver (the enforcement site fail-closes to deny with no surface).
  if (policy === 'prompt') return 'prompt';

  // 4. `preapproved` consults the task's own allowlist; `inherit-allowlist` inherits the parent's.
  //    Matched → allow, unmatched → deny (never prompt).
  const allow = policy === 'preapproved' ? (context.taskAllow ?? []) : (context.parentAllow ?? []);
  return matchesAnyPattern(toolName, toolArgs, allow) ? 'allow' : 'deny';
}
