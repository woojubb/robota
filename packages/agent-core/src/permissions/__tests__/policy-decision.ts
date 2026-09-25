/**
 * Test helper: a background policy decided through the one evaluator (issue #3081).
 *
 * Runs under bypassPermissions by default — the mode a policy exists to be stricter than — and maps
 * the evaluator's answer onto the policy vocabulary the cases are written in.
 */
import { evaluatePermission } from '../permission-gate.js';
import { projectPermissionPolicy } from '../permission-policy.js';

import type { TToolArgs } from '../permission-gate.js';
import type { TBackgroundPermissionPolicy, TPermissionMode } from '../types.js';

export interface IPolicyCaseRules {
  taskAllow?: readonly string[];
  taskDeny?: readonly string[];
  parentAllow?: readonly string[];
  parentDeny?: readonly string[];
}

export function decideByPolicy(
  policy: TBackgroundPermissionPolicy,
  toolName: string,
  toolArgs: TToolArgs,
  rules: IPolicyCaseRules = {},
  mode: TPermissionMode = 'bypassPermissions',
): 'allow' | 'deny' | 'prompt' {
  const projection = projectPermissionPolicy(policy, rules);
  const decision = evaluatePermission(
    toolName,
    toolArgs,
    mode,
    {
      allow: [...(rules.parentAllow ?? []), ...projection.allow],
      deny: [...(rules.parentDeny ?? []), ...projection.deny],
    },
    {
      ...(projection.ceiling !== undefined ? { ceiling: projection.ceiling } : {}),
      askAll: projection.askAll,
    },
  );
  return decision === 'auto' ? 'allow' : decision === 'approve' ? 'prompt' : 'deny';
}
