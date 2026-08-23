/**
 * SEC-016 — the per-event enforcement posture table.
 *
 * ## Why a table, and why it carries a reachability field
 *
 * Issue #2083 made a hook's failure representable: `runHooks` reports every execution that reached no
 * verdict on `IRunHooksResult.errors`. Nothing consumed it, so an enforcing hook that timed out or
 * could not spawn was still indistinguishable at the boundary from one that approved. This table is
 * what a consumer reads to decide whether that matters for a given event.
 *
 * The second field is the one that needs justifying. Measured across the tree: of the sixteen
 * `THookEvent` members, exactly ONE — `PreToolUse` — has a fire site that can block. The other
 * fifteen are advisory by construction, not by decision: seven fire `void`, five are called without
 * `await`, and three await a result they never inspect for `blocked`. A table that recorded only a
 * posture would therefore be fifteen-sixteenths inert, and — worse — unfalsifiable in the direction
 * that matters, because marking one of those events `enforcing` would change nothing while reading as
 * though it had.
 *
 * `enforcementReachable` records whether the event's fire site can honour an enforcing posture.
 * It is deliberately RECORDED rather than derived: deriving it would require the runner to know its
 * caller, which inverts the dependency the hooks module exists to keep clean.
 * `scripts/harness/scan-hook-enforcement-reachable.mjs` is what keeps the record honest, and
 * `assertPolicyCoherent` below catches the narrower contradiction without needing the scan at all.
 */

import type { THookEvent } from './types.js';

/** Whether a failed hook blocks at this event, or is merely reported. */
export type THookEnforcementPosture = 'enforcing' | 'advisory';

export interface IHookEventPolicy {
  readonly posture: THookEnforcementPosture;
  /**
   * Whether this event's fire site awaits `runHooks` and consults `blocked`. An `enforcing` posture
   * at a site where this is `false` is a claim the code cannot honour.
   */
  readonly enforcementReachable: boolean;
  /** Why this event has this posture — read by whoever considers changing it. */
  readonly rationale: string;
}

/** Advisory because the fire site discards the result outright. */
function firesAndForgets(where: string): IHookEventPolicy {
  return {
    posture: 'advisory',
    enforcementReachable: false,
    rationale: `Fire-and-forget at ${where}: the result is never awaited, so no posture can be honoured here.`,
  };
}

/** Advisory because the fire site awaits but never inspects `blocked`. */
function awaitsButIgnoresBlocked(where: string, reads: string): IHookEventPolicy {
  return {
    posture: 'advisory',
    enforcementReachable: false,
    rationale: `Awaited at ${where} but only ${reads} is read; \`blocked\` is never consulted.`,
  };
}

/**
 * Freeze the table AND every row in it.
 *
 * `Object.freeze` is shallow and `readonly` is compile-time only, so a single-level freeze leaves
 * `HOOK_ENFORCEMENT_POLICY.PreToolUse.posture = 'advisory'` working at runtime — silently disarming
 * the gate `isEnforcing` consults on every tool call. For a table whose entire value is that it
 * cannot drift, freezing the outer object states an intent the code only half-delivers.
 */
function deepFreezePolicy(
  policy: Record<THookEvent, IHookEventPolicy>,
): Readonly<Record<THookEvent, IHookEventPolicy>> {
  for (const row of Object.values(policy)) Object.freeze(row);
  return Object.freeze(policy);
}

/**
 * The posture for every lifecycle event.
 *
 * Exhaustive over `THookEvent` by construction — `Record` makes a missing member a compile error,
 * and `assertPolicyCoherent` catches an extra one.
 */
export const HOOK_ENFORCEMENT_POLICY: Readonly<Record<THookEvent, IHookEventPolicy>> =
  deepFreezePolicy({
    PreToolUse: {
      posture: 'enforcing',
      enforcementReachable: true,
      rationale:
        'The tool-execution gate. `runPreToolHook` awaits the result and turns `blocked` into a denial, so a hook that reached no verdict must not read as approval (tracker issue #2075).',
    },

    // ── Awaited, but the result's `blocked` is never consulted ───────────────────────────────────
    SessionEnd: awaitsButIgnoresBlocked('session-lifecycle.ts', 'nothing'),
    PreCompact: awaitsButIgnoresBlocked('compaction-orchestrator.ts', 'nothing'),
    UserPromptSubmit: awaitsButIgnoresBlocked('session-run.ts', '`stdout`'),

    // ── Called without `await` ───────────────────────────────────────────────────────────────────
    PostToolUse: firesAndForgets('tool-hook-helpers.ts'),
    SessionStart: firesAndForgets('session-lifecycle.ts'),
    PostCompact: firesAndForgets('session-history-ops.ts'),
    Stop: firesAndForgets('session-run.ts'),
    StopFailure: firesAndForgets('session-run.ts'),

    // ── Explicitly `void`, by SELFHOST-009 design for the informational events ───────────────────
    SubagentStart: firesAndForgets('background-task-hooks.ts'),
    SubagentStop: firesAndForgets('background-task-hooks.ts'),
    WorktreeCreate: firesAndForgets('worktree-subagent-runner.ts'),
    WorktreeRemove: firesAndForgets('worktree-subagent-runner.ts'),
    PreModelCall: firesAndForgets('session-run.ts'),
    PostModelCall: firesAndForgets('session-run.ts'),
    PermissionDecision: firesAndForgets('permission-enforcer.ts'),
  });

/** Does a hook that reached no verdict block at this event? */
export function isEnforcing(event: THookEvent): boolean {
  return HOOK_ENFORCEMENT_POLICY[event].posture === 'enforcing';
}

/**
 * The table's internal invariant: a row may not claim to enforce where enforcement is unreachable.
 *
 * This catches the NARROW contradiction — `posture: 'enforcing'` with `enforcementReachable: false`
 * — without needing the harness scan, which is the point: the two checks must be independent, or
 * whichever one is skipped becomes the only thing standing between the two fields. The scan carries
 * the WIDER case, where both fields are flipped together and the row is internally consistent while
 * still describing a gate the fire site cannot operate.
 *
 * @throws when a row is self-contradictory, naming the event.
 */
export function assertPolicyCoherent(
  policy: Readonly<Record<string, IHookEventPolicy>> = HOOK_ENFORCEMENT_POLICY,
): void {
  const rows = Object.entries(policy);

  // A table with no rows is degenerate, not coherent — the same reasoning
  // `scan-hook-enforcement-reachable.mjs` applies to a policy containing zero enforcing rows.
  // Without this, the only test of the production form was vacuous: changing the default binding to
  // `= {}` left every agent-core hook test green, because an empty table has nothing dishonest in
  // it. That default binding IS the mechanism behind this module's claim that two independent
  // checks keep the two fields honest, so a check that passes on nothing silently removed one of
  // them.
  if (rows.length === 0) {
    throw new Error(
      'Hook enforcement policy is empty. A table with no rows has nothing to check, which is a ' +
        'degenerate policy rather than a coherent one — most likely the default binding to ' +
        'HOOK_ENFORCEMENT_POLICY was broken.',
    );
  }

  const dishonest = rows
    .filter(([, entry]) => entry.posture === 'enforcing' && !entry.enforcementReachable)
    .map(([event]) => event);

  if (dishonest.length > 0) {
    throw new Error(
      `Hook enforcement policy is self-contradictory: ${dishonest.join(', ')} ` +
        `claim posture 'enforcing' while recording enforcementReachable: false. ` +
        `Either the fire site was changed and the flag is stale, or the posture asserts a gate that cannot run.`,
    );
  }
}
