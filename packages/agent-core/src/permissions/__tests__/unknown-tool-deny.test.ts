import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolArgumentKeys,
  evaluatePermission,
  registerToolArgumentKey,
} from '../permission-gate.js';

/**
 * CORE-030 — a deny the gate could not EVALUATE was overridden by a broader allow.
 *
 * `primaryArg` is a hardcoded switch over PRODUCT tool names in the vendor-neutral foundation. For a
 * tool it has never heard of it returns `undefined`, `matchesPattern` answers `false`, and `false`
 * from a DENY list means "not denied" — so evaluation walked on to the allow list.
 *
 * **The audit's severity claim was overstated, and measuring it is what showed that.** It said the
 * unevaluable deny "falls through to `UNKNOWN_TOOL_FALLBACK = 'approve'`", read as fail-open. But in
 * this vocabulary `'approve'` means PROMPT THE USER; `'auto'` is the one that proceeds silently. So
 * a deny with no allow beside it already ended at a prompt.
 *
 * The real fail-open needs both entries, and it is genuine. Measured against the previous code:
 *
 *   deny: ['MyTool(secrets/**)']                     -> approve   (prompt — already fine)
 *   deny: ['MyTool(secrets/**)'], allow: ['MyTool']  -> auto      (silently approved)
 *   deny: ['Shell(rm*)'],        allow: ['Shell']    -> deny      (known tool, correct)
 *
 * An operator who denies a narrow case and allows the tool broadly is the ordinary way to write
 * these lists, and for any tool the foundation does not know the narrow deny simply vanished.
 */
describe('an unevaluable deny is not overridden by a broader allow (CORE-030)', () => {
  afterEach(() => clearRegisteredToolArgumentKeys());

  const narrowDenyBroadAllow = { deny: ['MyTool(secrets/**)'], allow: ['MyTool'] };

  it('THE DEFECT: a narrow deny plus a broad allow no longer auto-approves', () => {
    // Previously `'auto'` — proceed with no prompt at all.
    expect(
      evaluatePermission('MyTool', { path: 'secrets/key.pem' }, 'default', narrowDenyBroadAllow),
    ).toBe('approve');
  });

  it('the same in acceptEdits', () => {
    expect(
      evaluatePermission(
        'MyTool',
        { path: 'secrets/key.pem' },
        'acceptEdits',
        narrowDenyBroadAllow,
      ),
    ).toBe('approve');
  });

  it('and in bypassPermissions, where the allow list would otherwise be moot', () => {
    // `bypassPermissions` auto-approves everything, but an unevaluable DENY is still a deny the
    // operator wrote; it prompts rather than proceeding.
    expect(
      evaluatePermission(
        'MyTool',
        { path: 'secrets/key.pem' },
        'bypassPermissions',
        narrowDenyBroadAllow,
      ),
    ).toBe('approve');
  });

  it('plan mode denies outright, matching its own fallback', () => {
    expect(
      evaluatePermission('MyTool', { path: 'secrets/key.pem' }, 'plan', narrowDenyBroadAllow),
    ).toBe('deny');
  });

  it('DENIES once the tool owner declares which argument the pattern is about', () => {
    registerToolArgumentKey('MyTool', 'path');
    expect(
      evaluatePermission('MyTool', { path: 'secrets/key.pem' }, 'default', narrowDenyBroadAllow),
    ).toBe('deny');
    // …and a non-matching argument goes back to the allow list, as it should.
    expect(
      evaluatePermission('MyTool', { path: 'public/readme.md' }, 'default', narrowDenyBroadAllow),
    ).toBe('auto');
  });

  /**
   * The distinction review of #1596 caught: the first version folded these two into one condition,
   * so a REGISTERED tool invoked without its declared argument was treated as unevaluable — which
   * contradicted the comment beside it and the test below it.
   *
   * A key nobody declared is unevaluable. A declared key that this invocation simply does not carry
   * is a real NON-match: the pattern is about `path`, there is no path, so there is nothing to deny.
   */
  it('a DECLARED key absent from the invocation is a real non-match, not an unevaluable one', () => {
    registerToolArgumentKey('MyTool', 'path');
    // No `path` in the args at all. The deny cannot apply, so the allow list decides.
    expect(evaluatePermission('MyTool', { other: 'x' }, 'default', narrowDenyBroadAllow)).toBe(
      'auto',
    );
  });

  it('leaves an unknown tool with no argument-scoped deny alone', () => {
    expect(
      evaluatePermission('MyTool', { path: 'x' }, 'default', {
        deny: ['OtherTool(x)'],
        allow: ['MyTool'],
      }),
    ).toBe('auto');
  });

  it('still denies a whole-tool deny for an unknown tool', () => {
    expect(
      evaluatePermission('MyTool', { path: 'x' }, 'default', {
        deny: ['MyTool'],
        allow: ['MyTool'],
      }),
    ).toBe('deny');
  });

  it('does not disturb the built-in tools, whose argument key is already known', () => {
    const lists = { deny: ['Shell(rm*)'], allow: ['Shell'] };
    expect(evaluatePermission('Shell', { command: 'rm -rf /tmp/x' }, 'default', lists)).toBe(
      'deny',
    );
    expect(evaluatePermission('Shell', { command: 'ls' }, 'default', lists)).toBe('auto');
  });

  it('a registered key wins over the built-in switch, so an owner can correct it', () => {
    registerToolArgumentKey('Shell', 'script');
    expect(
      evaluatePermission('Shell', { script: 'rm -rf /', command: 'ls' }, 'default', {
        deny: ['Shell(rm*)'],
      }),
    ).toBe('deny');
  });
});
