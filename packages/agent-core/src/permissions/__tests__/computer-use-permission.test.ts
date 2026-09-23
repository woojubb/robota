import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate';
import { RISK_CLASS_POLICY } from '../permission-mode';

import type { TPermissionMode } from '../types';

/**
 * SELFHOST-010 TC-02 / TC-07 / TC-08 — decision layer.
 *
 * The computer-use perceive/act split is modeled on the repo's OWN `Read`(auto)-vs-`Shell`(approve)
 * precedent and routes through the EXISTING `evaluatePermission` path (no new gate).
 *
 * CORE-030: the classification now lives with the tools (`@robota-sdk/agent-tools`), so these
 * register the same profiles that package declares rather than reading a name table from this one.
 * "Decided exactly like Read / Shell" is now a statement about the DECLARATION — both are `inspect`,
 * both are `execute` — and is asserted where the declaration lives; what this file asserts is that
 * those declarations produce the decisions SELFHOST-010 specified.
 */

const ALL_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

describe('computer-use permission decisions (SELFHOST-010)', () => {
  beforeEach(() => {
    clearRegisteredToolProfiles();
    // Exactly what `@robota-sdk/agent-tools` declares for these four.
    registerToolPermissionProfile('Read', {
      argument: { key: 'filePath', kind: 'path' },
      riskClass: 'inspect',
    });
    registerToolPermissionProfile('Shell', {
      argument: { key: 'command', kind: 'command' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('ComputerView', { riskClass: 'inspect' });
    registerToolPermissionProfile('Computer', { riskClass: 'execute' });
    registerToolPermissionProfile('Write', {
      argument: { key: 'filePath', kind: 'path' },
      riskClass: 'modify',
    });
  });

  afterEach(() => {
    clearRegisteredToolProfiles();
  });

  // TC-02 / TC-08: ComputerView is `auto` in EVERY mode (read-only perception, incl. plan).
  it('TC-02/08: ComputerView is auto in every mode, exactly like Read', () => {
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('ComputerView', {}, mode), mode).toBe('auto');
      // decided EXACTLY like Read
      expect(evaluatePermission('ComputerView', {}, mode), mode).toBe(
        evaluatePermission('Read', {}, mode),
      );
    }
    // Explicitly: read-only inspection runs unapproved even in plan.
    expect(evaluatePermission('ComputerView', {}, 'plan')).toBe('auto');
  });

  // TC-02: a mutating Computer action is gated — deny in plan, approve in default.
  it('TC-02: Computer is deny in plan and approve in default (via the existing gate)', () => {
    expect(evaluatePermission('Computer', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('Computer', {}, 'default')).toBe('approve');
  });

  // TC-07: Computer is decided EXACTLY like Shell — never `auto` except under bypassPermissions.
  it('TC-07: Computer mirrors Shell in every mode and never auto-runs except bypassPermissions', () => {
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('Computer', {}, mode), mode).toBe(
        evaluatePermission('Shell', {}, mode),
      );
      const decision = evaluatePermission('Computer', {}, mode);
      if (mode === 'bypassPermissions') {
        expect(decision).toBe('auto');
      } else {
        expect(decision).not.toBe('auto');
      }
    }
  });

  // TC-07: the perceive/act split does not weaken the floor — a GUI mutation is not a file edit, so
  // acceptEdits (which auto-runs Write/Edit) still requires approval for Computer.
  it('TC-07: acceptEdits does not auto-run Computer (a GUI mutation is not a file edit)', () => {
    expect(evaluatePermission('Computer', {}, 'acceptEdits')).toBe('approve');
    expect(evaluatePermission('Write', { filePath: '/tmp/a', content: 'x' }, 'acceptEdits')).toBe(
      'auto',
    );
  });

  // TC-08: read-only inspection is reachable in plan while a mutation in the same mode is denied.
  it('TC-08: in plan mode ComputerView is auto while Computer is denied', () => {
    expect(evaluatePermission('ComputerView', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('Computer', {}, 'plan')).toBe('deny');
  });

  // No new gate: both are decided by their DECLARED class through the shared policy, not by the
  // unclassified fallback. The distinction matters — the fallback prompts and refuses in plan, so a
  // tool that reached it would look gated while actually being unclassified.
  it('is decided by the declared class, not by the unclassified fallback', () => {
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('ComputerView', {}, mode), mode).toBe(
        RISK_CLASS_POLICY[mode].inspect,
      );
      expect(evaluatePermission('Computer', {}, mode), mode).toBe(RISK_CLASS_POLICY[mode].execute);
    }

    // And with nothing declared, the same call takes the fallback — which is what makes the
    // assertions above about the declaration rather than about a coincidence.
    clearRegisteredToolProfiles();
    expect(evaluatePermission('ComputerView', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('ComputerView', {}, 'default')).toBe('approve');
  });
});
