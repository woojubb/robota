import { describe, expect, it } from 'vitest';

import { resolvePermissionByPolicy } from '../permission-policy.js';

/**
 * CORE-025 — the background/subagent permission POLICY resolver.
 * Precedence: `deny` policy → deny; explicit deny-list → deny; `prompt` → prompt; `preapproved` uses the
 * task allowlist, `inherit-allowlist` the parent allowlist (matched → allow, unmatched → deny).
 */
describe('resolvePermissionByPolicy (CORE-025)', () => {
  const args = { command: 'ls' };

  it('`deny` policy denies every call, absolutely — even an allow-listed tool', () => {
    expect(
      resolvePermissionByPolicy('deny', 'Bash', args, {
        taskAllow: ['Bash'],
        parentAllow: ['Bash'],
      }),
    ).toBe('deny');
  });

  it('`preapproved` allows a tool in the TASK allowlist, denies one that is not', () => {
    expect(resolvePermissionByPolicy('preapproved', 'Read', {}, { taskAllow: ['Read'] })).toBe(
      'allow',
    );
    expect(resolvePermissionByPolicy('preapproved', 'Write', {}, { taskAllow: ['Read'] })).toBe(
      'deny',
    );
  });

  it('`preapproved` ignores the PARENT allowlist (task-declared set only)', () => {
    expect(resolvePermissionByPolicy('preapproved', 'Write', {}, { parentAllow: ['Write'] })).toBe(
      'deny',
    );
  });

  it('`inherit-allowlist` allows on the PARENT allowlist, denies (never prompts) on a miss', () => {
    expect(
      resolvePermissionByPolicy('inherit-allowlist', 'Read', {}, { parentAllow: ['Read'] }),
    ).toBe('allow');
    expect(
      resolvePermissionByPolicy('inherit-allowlist', 'Write', {}, { parentAllow: ['Read'] }),
    ).toBe('deny');
  });

  it('`inherit-allowlist` ignores the TASK allowlist (inherits the parent only)', () => {
    expect(
      resolvePermissionByPolicy('inherit-allowlist', 'Write', {}, { taskAllow: ['Write'] }),
    ).toBe('deny');
  });

  it('`prompt` policy routes to the approver', () => {
    expect(resolvePermissionByPolicy('prompt', 'Bash', args)).toBe('prompt');
  });

  it('an explicit deny-list match wins over allow, prompt, and preapproved (deny > allow)', () => {
    // deny beats the task allowlist under preapproved
    expect(
      resolvePermissionByPolicy('preapproved', 'Bash', args, {
        taskAllow: ['Bash'],
        taskDeny: ['Bash'],
      }),
    ).toBe('deny');
    // parent deny beats inherit-allow
    expect(
      resolvePermissionByPolicy('inherit-allowlist', 'Bash', args, {
        parentAllow: ['Bash'],
        parentDeny: ['Bash'],
      }),
    ).toBe('deny');
    // deny beats prompt
    expect(resolvePermissionByPolicy('prompt', 'Bash', args, { taskDeny: ['Bash'] })).toBe('deny');
  });

  it('honors argument patterns (Bash(pnpm *)) via the shared matcher', () => {
    expect(
      resolvePermissionByPolicy(
        'preapproved',
        'Bash',
        { command: 'pnpm build' },
        {
          taskAllow: ['Bash(pnpm *)'],
        },
      ),
    ).toBe('allow');
    expect(
      resolvePermissionByPolicy(
        'preapproved',
        'Bash',
        { command: 'rm -rf /' },
        {
          taskAllow: ['Bash(pnpm *)'],
        },
      ),
    ).toBe('deny');
  });

  it('empty context denies for allowlist policies (fail-closed, no rules to match)', () => {
    expect(resolvePermissionByPolicy('inherit-allowlist', 'Bash', args)).toBe('deny');
    expect(resolvePermissionByPolicy('preapproved', 'Bash', args)).toBe('deny');
  });
});
