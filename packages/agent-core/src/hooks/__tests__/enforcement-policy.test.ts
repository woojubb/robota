/**
 * SEC-016 — the per-event enforcement posture table.
 *
 * TC-06 (exhaustiveness) and TC-12 (the table-internal invariant) live here. TC-12 exists as a unit
 * test AND as an arm of `scan-hook-enforcement-reachable.mjs` on purpose: two independent checks,
 * because whichever one is skipped would otherwise be the only thing standing between `posture` and
 * `enforcementReachable`.
 */

import { describe, it, expect } from 'vitest';

import {
  HOOK_ENFORCEMENT_POLICY,
  isEnforcing,
  assertPolicyCoherent,
  type IHookEventPolicy,
} from '../enforcement-policy.js';

import type { THookEvent } from '../types.js';

/**
 * Every member of the union, written out.
 *
 * Deliberately a literal list rather than a derivation: a type union has no runtime representation,
 * so deriving it would mean deriving it FROM the policy — and a test that checks the policy against
 * itself checks nothing. The compiler enforces the other direction (`satisfies` below fails if a
 * name here is not a `THookEvent`), so the two halves cannot drift silently.
 */
const ALL_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreModelCall',
  'PostModelCall',
  'PermissionDecision',
] as const satisfies readonly THookEvent[];

describe('HOOK_ENFORCEMENT_POLICY', () => {
  // ── SEC-016 TC-06 ────────────────────────────────────────────────────────────────────────────
  it('TC-06: has exactly one entry per THookEvent member, no more and no fewer', () => {
    expect(Object.keys(HOOK_ENFORCEMENT_POLICY).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('every entry carries a non-empty rationale', () => {
    // A posture without a stated reason is the shape this whole item is about: a record that reads
    // as a decision with nothing behind it.
    for (const [event, entry] of Object.entries(HOOK_ENFORCEMENT_POLICY)) {
      expect(entry.rationale, `${event} has no rationale`).toBeTruthy();
      expect(entry.rationale.length, `${event}'s rationale is too short to be one`).toBeGreaterThan(
        20,
      );
    }
  });

  it('records the measured baseline: PreToolUse is the only enforcing event', () => {
    const enforcing = Object.entries(HOOK_ENFORCEMENT_POLICY)
      .filter(([, entry]) => entry.posture === 'enforcing')
      .map(([event]) => event);
    expect(enforcing).toEqual(['PreToolUse']);

    // And the other fifteen say so about themselves, rather than being advisory by omission.
    const advisory = Object.values(HOOK_ENFORCEMENT_POLICY).filter(
      (entry) => entry.posture === 'advisory',
    );
    expect(advisory).toHaveLength(15);
    expect(advisory.every((entry) => !entry.enforcementReachable)).toBe(true);
  });

  it('isEnforcing answers from the table, for every event', () => {
    for (const event of ALL_EVENTS) {
      expect(isEnforcing(event)).toBe(HOOK_ENFORCEMENT_POLICY[event].posture === 'enforcing');
    }
    expect(isEnforcing('PreToolUse')).toBe(true);
    expect(isEnforcing('PostToolUse')).toBe(false);
  });

  // ── SEC-016 TC-12 — the table-internal invariant ──────────────────────────────────────────────
  describe('TC-12: a row may not claim to enforce where enforcement is unreachable', () => {
    it('the shipped policy is coherent', () => {
      expect(() => assertPolicyCoherent()).not.toThrow();
    });

    it('rejects posture "enforcing" with enforcementReachable: false, naming the event', () => {
      // The NARROW mutant. Caught here without the harness scan, which is the point — the scan
      // carries the wider case where both fields are flipped together and the row is internally
      // consistent while still describing a gate its fire site cannot operate.
      const dishonest: Record<string, IHookEventPolicy> = {
        ...HOOK_ENFORCEMENT_POLICY,
        SessionEnd: {
          posture: 'enforcing',
          enforcementReachable: false,
          rationale: 'a row asserting a gate its fire site cannot operate',
        },
      };
      expect(() => assertPolicyCoherent(dishonest)).toThrow(/SessionEnd/);
      expect(() => assertPolicyCoherent(dishonest)).toThrow(/self-contradictory/);
    });

    it('names every dishonest row, not just the first', () => {
      // A check that stops at the first finding under-reports, and the second row then looks clean
      // on the next run after the first is fixed.
      const dishonest: Record<string, IHookEventPolicy> = {
        ...HOOK_ENFORCEMENT_POLICY,
        SessionEnd: { posture: 'enforcing', enforcementReachable: false, rationale: 'mutant one' },
        PostCompact: { posture: 'enforcing', enforcementReachable: false, rationale: 'mutant two' },
      };
      expect(() => assertPolicyCoherent(dishonest)).toThrow(/SessionEnd/);
      expect(() => assertPolicyCoherent(dishonest)).toThrow(/PostCompact/);
    });

    it('does NOT reject the reverse — advisory with enforcementReachable: true is legal', () => {
      // A reachable fire site that we have chosen not to enforce at is a real, statable position.
      // Rejecting it would force the table to conflate "cannot" with "does not".
      const deliberate: Record<string, IHookEventPolicy> = {
        ...HOOK_ENFORCEMENT_POLICY,
        PreToolUse: {
          posture: 'advisory',
          enforcementReachable: true,
          rationale: 'could enforce, deliberately does not',
        },
      };
      expect(() => assertPolicyCoherent(deliberate)).not.toThrow();
    });
  });

  describe('the table cannot be mutated at runtime', () => {
    // `readonly` is compile-time only and `Object.freeze` is shallow, so a single-level freeze left
    // every ROW writable. `isEnforcing` reads `.posture` on every tool call, so a writable row means
    // one assignment silently disarms the gate — from inside the process, with no type error and no
    // diff. Asserted rather than trusted, because a freeze nothing checks is a freeze that can be
    // dropped in a refactor with the suite still green.
    it('refuses a write to a row field', () => {
      expect(() => {
        (HOOK_ENFORCEMENT_POLICY.PreToolUse as { posture: string }).posture = 'advisory';
      }).toThrow(TypeError);
      expect(HOOK_ENFORCEMENT_POLICY.PreToolUse.posture).toBe('enforcing');
      expect(isEnforcing('PreToolUse')).toBe(true);
    });

    it('refuses replacing a whole row', () => {
      // Asserts object IDENTITY rather than re-reading `posture`. If the row freeze above is ever
      // broken, the preceding case's write SUCCEEDS and leaks `advisory` into this one — so a
      // `posture` assertion here would go red on that leak rather than on this case's own property,
      // and its failure would point at the wrong defect. Identity is unaffected by that leak.
      const before = HOOK_ENFORCEMENT_POLICY.PreToolUse;

      expect(() => {
        (HOOK_ENFORCEMENT_POLICY as Record<string, unknown>).PreToolUse = {
          posture: 'advisory',
          enforcementReachable: false,
          rationale: 'disarmed',
        };
      }).toThrow(TypeError);
      expect(HOOK_ENFORCEMENT_POLICY.PreToolUse).toBe(before);
    });
  });
});
