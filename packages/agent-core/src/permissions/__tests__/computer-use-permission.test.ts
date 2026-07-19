import { describe, expect, it } from 'vitest';

import { evaluatePermission } from '../permission-gate';
import { MODE_POLICY } from '../permission-mode';

import type { TPermissionMode } from '../types';

/**
 * SELFHOST-010 TC-02 / TC-07 / TC-08 — decision layer.
 *
 * The computer-use perceive/act split is modeled on the repo's OWN `Read`(auto)-vs-`Shell`(approve)
 * precedent and routes through the EXISTING `evaluatePermission` → `MODE_POLICY` path (no new gate). These
 * assert the decisions AND that they are decided EXACTLY like `Read` / `Shell` in every mode.
 */

const ALL_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

describe('computer-use permission decisions (SELFHOST-010)', () => {
  // TC-02 / TC-08: ComputerView is `auto` in EVERY mode (read-only perception, incl. plan).
  it('TC-02/08: ComputerView is auto in every mode, exactly like Read', () => {
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('ComputerView', {}, mode), mode).toBe('auto');
      // decided EXACTLY like Read
      expect(MODE_POLICY[mode].ComputerView, mode).toBe(MODE_POLICY[mode].Read);
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
      expect(MODE_POLICY[mode].Computer, mode).toBe(MODE_POLICY[mode].Shell);
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

  // No new gate: both tools are decided through MODE_POLICY (the known-tool path), not the
  // UNKNOWN_TOOL_FALLBACK — i.e. they are registered known tools.
  it('routes through MODE_POLICY (both are registered known tools, not unknown-fallback)', () => {
    for (const mode of ALL_MODES) {
      expect(MODE_POLICY[mode].ComputerView, mode).toBeDefined();
      expect(MODE_POLICY[mode].Computer, mode).toBeDefined();
    }
  });
});
