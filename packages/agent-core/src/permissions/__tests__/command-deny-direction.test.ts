import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  matchesAnyPattern,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import { resolvePermissionByPolicy } from '../permission-policy.js';

/**
 * Issue #2427's fix made the `command` matcher answer `no-match` for any argument carrying an
 * unquoted separator (`;` `&&` `||` `|` `&` newline) or a substitution (`$(` backtick `<(` `>(`).
 * That is the right answer on the ALLOW side: `Bash(git *)` must not bless `git status; rm -rf /`.
 *
 * The same matcher also evaluates the DENY list, and there the identical answer reads "not denied":
 * `deny: ['Bash(rm *)']` stopped seeing `rm -rf / ; echo done`, the invocation fell through to
 * `allow: ['Bash']` or to the mode policy, and `bypassPermissions` auto-approved it. Appending a
 * second command to slip past a deny entry is exactly what a deny list exists to stop, so these
 * cases pin the deny direction while the #2427 allow-side cases keep passing.
 */
beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
});

afterEach(() => {
  clearRegisteredToolProfiles();
});

describe('issue #2427 regression — the separator rule is an ALLOW-side rule only', () => {
  it('a deny pattern still matches when the command carries a separator', () => {
    const deny = { deny: ['Bash(rm *)'] };
    expect(evaluatePermission('Bash', { command: 'rm -rf /' }, 'bypassPermissions', deny)).toBe(
      'deny',
    );
    for (const command of [
      'rm -rf / ; echo done',
      'rm -rf / && echo done',
      'rm -rf / || echo done',
      'rm -rf / | tee log',
      'rm -rf / & echo done',
      'rm -rf /\necho done',
    ]) {
      expect(
        evaluatePermission('Bash', { command }, 'bypassPermissions', deny),
        JSON.stringify(command),
      ).toBe('deny');
    }
  });

  it('a deny beats a broad allow for a chained command, in every mode', () => {
    const lists = { allow: ['Bash'], deny: ['Bash(rm *)'] };
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const) {
      expect(
        evaluatePermission('Bash', { command: 'rm -rf / ; echo done' }, mode, lists),
        mode,
      ).toBe('deny');
    }
  });

  it('a deny matches the denied command wherever it sits in the chain, or in a substitution', () => {
    const deny = { deny: ['Bash(rm *)'] };
    for (const command of [
      'git status; rm -rf /',
      'echo hi && rm -rf /tmp/x',
      'echo $(rm -rf /tmp/x)',
      'echo `rm -rf /tmp/x`',
      'diff <(rm -rf /tmp/x) b',
      'echo "$(rm -rf /tmp/x)"',
    ]) {
      expect(
        evaluatePermission('Bash', { command }, 'bypassPermissions', deny),
        JSON.stringify(command),
      ).toBe('deny');
    }
  });

  it('a wildcard-free deny pattern also catches its command inside a chain', () => {
    expect(
      evaluatePermission('Bash', { command: 'echo hi; rm -rf /' }, 'bypassPermissions', {
        deny: ['Bash(rm -rf /)'],
      }),
    ).toBe('deny');
  });

  it('the deny side still respects quoting — a separator inside quotes is one command', () => {
    // No false positive: `rm` inside a quoted string is an argument to `echo`, not a command.
    expect(
      evaluatePermission('Bash', { command: 'echo "rm -rf /"' }, 'bypassPermissions', {
        deny: ['Bash(rm *)'],
      }),
    ).toBe('auto');
    expect(
      evaluatePermission('Bash', { command: 'ls -la' }, 'bypassPermissions', {
        deny: ['Bash(rm *)'],
      }),
    ).toBe('auto');
  });

  it('the background/subagent policy resolver denies a chained command too (CORE-025)', () => {
    expect(
      resolvePermissionByPolicy(
        'preapproved',
        'Bash',
        { command: 'rm -rf / ; echo done' },
        { taskAllow: ['Bash'], taskDeny: ['Bash(rm *)'] },
      ),
    ).toBe('deny');
    expect(
      resolvePermissionByPolicy(
        'inherit-allowlist',
        'Bash',
        { command: 'git status && rm -rf /' },
        { parentAllow: ['Bash'], parentDeny: ['Bash(rm *)'] },
      ),
    ).toBe('deny');
  });

  it('the ALLOW side keeps the #2427 rule: a chained command is not blessed by `Bash(git *)`', () => {
    expect(
      evaluatePermission('Bash', { command: 'git status; rm -rf /' }, 'default', {
        allow: ['Bash(git *)'],
      }),
    ).not.toBe('auto');
    expect(matchesAnyPattern('Bash', { command: 'git status; rm -rf /' }, ['Bash(git *)'])).toBe(
      false,
    );
    expect(matchesAnyPattern('Bash', { command: 'git status' }, ['Bash(git *)'])).toBe(true);
  });
});
