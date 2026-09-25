import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '../permission-gate.js';
import { decideByPolicy } from './policy-decision.js';

/**
 * CORE-025 — the background/subagent permission POLICY resolver.
 * Precedence: `deny` policy → deny; explicit deny-list → deny; `prompt` → prompt; `preapproved` uses the
 * task allowlist, `inherit-allowlist` the parent allowlist (matched → allow, unmatched → deny).
 */
describe('resolvePermissionByPolicy (CORE-025)', () => {
  const args = { command: 'ls' };

  // CORE-030: the tool declares which argument its patterns are scoped to, so the cases below
  // declare it rather than relying on a table in this package.
  beforeEach(() => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Bash', {
      argument: { key: 'command', kind: 'command' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('Shell', {
      argument: { key: 'command', kind: 'command' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('Read', {
      argument: { key: 'filePath', kind: 'path' },
      riskClass: 'inspect',
    });
  });

  afterEach(() => {
    clearRegisteredToolProfiles();
  });

  it('`deny` policy denies every call, absolutely — even an allow-listed tool', () => {
    expect(
      decideByPolicy('deny', 'Bash', args, {
        taskAllow: ['Bash'],
        parentAllow: ['Bash'],
      }),
    ).toBe('deny');
  });

  it('`preapproved` allows a tool in the TASK allowlist, denies one that is not', () => {
    expect(decideByPolicy('preapproved', 'Read', {}, { taskAllow: ['Read'] })).toBe(
      'allow',
    );
    expect(decideByPolicy('preapproved', 'Write', {}, { taskAllow: ['Read'] })).toBe(
      'deny',
    );
  });

  it('`preapproved` ignores the PARENT allowlist (task-declared set only)', () => {
    expect(decideByPolicy('preapproved', 'Write', {}, { parentAllow: ['Write'] })).toBe(
      'deny',
    );
  });

  it('`inherit-allowlist` allows on the PARENT allowlist, denies (never prompts) on a miss', () => {
    expect(
      decideByPolicy('inherit-allowlist', 'Read', {}, { parentAllow: ['Read'] }),
    ).toBe('allow');
    expect(
      decideByPolicy('inherit-allowlist', 'Write', {}, { parentAllow: ['Read'] }),
    ).toBe('deny');
  });

  it('`inherit-allowlist` ignores the TASK allowlist (inherits the parent only)', () => {
    expect(
      decideByPolicy('inherit-allowlist', 'Write', {}, { taskAllow: ['Write'] }),
    ).toBe('deny');
  });

  it('`prompt` policy routes to the approver', () => {
    expect(decideByPolicy('prompt', 'Bash', args)).toBe('prompt');
  });

  it('an explicit deny-list match wins over allow, prompt, and preapproved (deny > allow)', () => {
    // deny beats the task allowlist under preapproved
    expect(
      decideByPolicy('preapproved', 'Bash', args, {
        taskAllow: ['Bash'],
        taskDeny: ['Bash'],
      }),
    ).toBe('deny');
    // parent deny beats inherit-allow
    expect(
      decideByPolicy('inherit-allowlist', 'Bash', args, {
        parentAllow: ['Bash'],
        parentDeny: ['Bash'],
      }),
    ).toBe('deny');
    // deny beats prompt
    expect(decideByPolicy('prompt', 'Bash', args, { taskDeny: ['Bash'] })).toBe('deny');
  });

  it('honors argument patterns (Bash(pnpm *)) via the shared matcher', () => {
    expect(
      decideByPolicy(
        'preapproved',
        'Bash',
        { command: 'pnpm build' },
        {
          taskAllow: ['Bash(pnpm *)'],
        },
      ),
    ).toBe('allow');
    expect(
      decideByPolicy(
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
    expect(decideByPolicy('inherit-allowlist', 'Bash', args)).toBe('deny');
    expect(decideByPolicy('preapproved', 'Bash', args)).toBe('deny');
  });
});
