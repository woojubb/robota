/**
 * Background/subagent permission POLICY (CORE-025), projected onto the one evaluator.
 *
 * A spawned background task carries a `permissionPolicy` (`inherit-allowlist | preapproved | prompt | deny`).
 * It used to have its own resolver with its own order, so the same call could be decided differently
 * depending on who made it (issue #3081). A policy is now only what it adds to `evaluatePermission`'s
 * inputs — a ceiling, an ask-everything flag, and the task's own lists — so the order is shared and
 * a policy can only narrow:
 *
 * - `deny` → an empty ceiling: every call is denied.
 * - `prompt` → every call that is not denied asks (the approver fail-closes to deny with no surface).
 * - `preapproved` → the TASK allowlist is the ceiling and is auto-approved within it.
 * - `inherit-allowlist` → the PARENT's effective allowlist is the ceiling.
 *
 * The ceiling is checked before bypassPermissions, so a detached task under a permissive mode still
 * cannot reach past what it was given.
 */

import type { TBackgroundPermissionPolicy } from './types.js';

/**
 * Rules available to the projection. `task*` are the spawned task's own declared lists;
 * `parentAllow` is the parent session's effective allowlist that `inherit-allowlist` inherits.
 */
export interface IPermissionPolicyContext {
  taskAllow?: readonly string[];
  taskDeny?: readonly string[];
  parentAllow?: readonly string[];
}

/** What a policy adds to the evaluator's inputs. */
export interface IPermissionPolicyProjection {
  /** Absent means the policy sets no ceiling. */
  ceiling?: readonly string[];
  askAll: boolean;
  /** Added to the session's allow list. */
  allow: readonly string[];
  /** Added to the session's deny list. */
  deny: readonly string[];
}

export function projectPermissionPolicy(
  policy: TBackgroundPermissionPolicy,
  context: IPermissionPolicyContext = {},
): IPermissionPolicyProjection {
  const deny = context.taskDeny ?? [];
  switch (policy) {
    case 'deny':
      return { ceiling: [], askAll: false, allow: [], deny };
    case 'prompt':
      return { askAll: true, allow: [], deny };
    case 'preapproved': {
      const taskAllow = context.taskAllow ?? [];
      return { ceiling: taskAllow, askAll: false, allow: taskAllow, deny };
    }
    case 'inherit-allowlist':
      return { ceiling: context.parentAllow ?? [], askAll: false, allow: [], deny };
    default: {
      const exhaustive: never = policy;
      throw new Error(`unknown permission policy: ${String(exhaustive)}`);
    }
  }
}
