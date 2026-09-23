import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import { resolvePermissionByPolicy } from '../permission-policy.js';

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
  // The tools whose argument key `@robota-sdk/agent-tools` declares. These cases are about what
  // happens for a tool NOBODY has declared, so the contrast needs the declared ones present.
  beforeEach(() => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Shell', {
      argument: { key: 'command', kind: 'text' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('Read', {
      argument: { key: 'filePath', kind: 'text' },
      riskClass: 'inspect',
    });
  });

  afterEach(() => clearRegisteredToolProfiles());

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
    registerToolPermissionProfile('MyTool', { argument: { key: 'path', kind: 'text' } });
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
    registerToolPermissionProfile('MyTool', { argument: { key: 'path', kind: 'text' } });
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

  it('a later declaration corrects an earlier one, so an owner can fix its own key', () => {
    registerToolPermissionProfile('Shell', { argument: { key: 'script', kind: 'text' } });
    expect(
      evaluatePermission('Shell', { script: 'rm -rf /', command: 'ls' }, 'default', {
        deny: ['Shell(rm*)'],
      }),
    ).toBe('deny');
  });
});

/**
 * The SIBLING gate, found in review of #1596. `resolvePermissionByPolicy` had the same defect and
 * was untouched by the first pass — a missed call site, not a deferred one.
 *
 * It is worse here. This is the gate for BACKGROUND and SUBAGENT calls
 * (`agent-session/src/permission-enforcer.ts:219`), it exists to be MORE restrictive than the
 * session mode, and it has no prompt at its allow step: an unevaluable deny beside a broader allow
 * resolved to `'allow'` outright.
 *
 * It denies rather than prompting, because a detached task has no human attached by definition —
 * the same reasoning the allow step already applies with "unmatched → deny (never prompt)".
 */
describe('the background/subagent gate has the same rule (CORE-030)', () => {
  beforeEach(() => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Shell', {
      argument: { key: 'command', kind: 'text' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('Read', {
      argument: { key: 'filePath', kind: 'text' },
      riskClass: 'inspect',
    });
  });

  afterEach(() => clearRegisteredToolProfiles());

  const context = { taskDeny: ['MyTool(secrets/**)'], taskAllow: ['MyTool'] };

  it('THE DEFECT: an unevaluable deny no longer resolves to allow', () => {
    // Previously `'allow'` — the deny could not match, and the allowlist decided.
    expect(
      resolvePermissionByPolicy('preapproved', 'MyTool', { path: 'secrets/key.pem' }, context),
    ).toBe('deny');
  });

  it('the same on the inherited path', () => {
    expect(
      resolvePermissionByPolicy(
        'inherit-allowlist',
        'MyTool',
        { path: 'secrets/key.pem' },
        {
          parentDeny: ['MyTool(secrets/**)'],
          parentAllow: ['MyTool'],
        },
      ),
    ).toBe('deny');
  });

  it('ALLOWS once the owner declares the key and the argument does not match the deny', () => {
    registerToolPermissionProfile('MyTool', { argument: { key: 'path', kind: 'text' } });
    expect(
      resolvePermissionByPolicy('preapproved', 'MyTool', { path: 'public/readme.md' }, context),
    ).toBe('allow');
    expect(
      resolvePermissionByPolicy('preapproved', 'MyTool', { path: 'secrets/key.pem' }, context),
    ).toBe('deny');
  });

  it('leaves a known tool alone', () => {
    expect(
      resolvePermissionByPolicy(
        'preapproved',
        'Shell',
        { command: 'ls' },
        {
          taskDeny: ['Shell(rm*)'],
          taskAllow: ['Shell'],
        },
      ),
    ).toBe('allow');
  });
});

describe('CORE-030 — a third-party tool can be classified, which is what the union prevented', () => {
  afterEach(() => {
    clearRegisteredToolProfiles();
  });

  it('a custom tool declares its class and is decided by it, not by the fallback', () => {
    // The union `'Shell' | 'Bash' | 'Read' | …` had no room for a tool the foundation had never
    // heard of, so no layer above — and no third-party author — could say what their tool does. The
    // best available answer was the fallback: prompt on every call, refused in plan.
    clearRegisteredToolProfiles();
    expect(evaluatePermission('MyTool', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('MyTool', {}, 'default')).toBe('approve');

    registerToolPermissionProfile('MyTool', {
      argument: { key: 'path', kind: 'text' },
      riskClass: 'inspect',
    });

    expect(evaluatePermission('MyTool', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('MyTool', {}, 'default')).toBe('auto');
  });

  it('its narrow deny beats a broad allow, in default AND acceptEdits', () => {
    // The item's required regression. Denying a narrow case while allowing the tool broadly is the
    // ordinary way to write these lists; for a tool the foundation did not know, the narrow deny
    // simply vanished and the call was auto-approved.
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('MyTool', {
      argument: { key: 'path', kind: 'text' },
      riskClass: 'inspect',
    });
    const lists = { deny: ['MyTool(secrets/**)'], allow: ['MyTool'] };

    for (const mode of ['default', 'acceptEdits'] as const) {
      expect(evaluatePermission('MyTool', { path: 'secrets/key.pem' }, mode, lists), mode).toBe(
        'deny',
      );
      // And the allow still works for anything the deny was not about.
      expect(evaluatePermission('MyTool', { path: 'public/readme.md' }, mode, lists), mode).toBe(
        'auto',
      );
    }
  });

  it('an owner can classify a tool without giving it an argument key', () => {
    // The two halves are independent: a tool with no path-like argument is still classifiable, and
    // requiring both would have pushed such a tool back onto the fallback.
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('NoArgsTool', { riskClass: 'execute' });
    expect(evaluatePermission('NoArgsTool', {}, 'acceptEdits')).toBe('approve');
    expect(evaluatePermission('NoArgsTool', {}, 'plan')).toBe('deny');
  });
});
