import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  isToolDeniedOutright,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import {
  findInvalidPermissionPatterns,
  findPermissionPatternWarnings,
} from '../pattern-validation.js';

/**
 * Issue #3081 — the rule model beyond one primary argument: named-parameter rules, globs in the
 * tool-name position, and a bare-name deny that removes the tool.
 */
beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
    parameters: ['command', 'run_in_background', 'timeout'],
  });
  registerToolPermissionProfile('WebFetch', {
    argument: { key: 'url', kind: 'url' },
    riskClass: 'inspect',
    parameters: ['url', 'prompt'],
  });
  registerToolPermissionProfile('Agent', {
    riskClass: 'execute',
    parameters: ['model', 'prompt', 'subagent_type'],
  });
  registerToolPermissionProfile('github__create_issue', { parameters: ['repo', 'title'] });
});

afterEach(() => clearRegisteredToolProfiles());

describe('Tool(param:value)', () => {
  it('denies by a named top-level parameter', () => {
    const deny = ['Bash(run_in_background:true)'];
    expect(
      evaluatePermission('Bash', { command: 'sleep 1', run_in_background: true }, 'bypassPermissions', { deny }),
    ).toBe('deny');
    expect(
      evaluatePermission('Bash', { command: 'sleep 1', run_in_background: false }, 'bypassPermissions', { deny }),
    ).toBe('auto');
  });

  it('never matches an omitted parameter', () => {
    expect(
      evaluatePermission('Bash', { command: 'sleep 1' }, 'bypassPermissions', {
        deny: ['Bash(run_in_background:*)'],
      }),
    ).toBe('auto');
  });

  it('globs the value and compares numbers by their text', () => {
    expect(
      evaluatePermission('Agent', { model: 'opus-large', prompt: 'x' }, 'default', {
        allow: ['Agent'],
        ask: ['Agent(model:opus*)'],
      }),
    ).toBe('approve');
    expect(
      evaluatePermission('Bash', { command: 'x', timeout: 600000 }, 'bypassPermissions', {
        deny: ['Bash(timeout:6*)'],
      }),
    ).toBe('deny');
  });

  it('works on an MCP tool, which declares no primary field', () => {
    expect(
      evaluatePermission('github__create_issue', { repo: 'acme/secret', title: 't' }, 'bypassPermissions', {
        deny: ['github__create_issue(repo:acme/*)'],
      }),
    ).toBe('deny');
  });

  it('treats an object value as unevaluable, which asks', () => {
    expect(
      evaluatePermission('Agent', { model: { name: 'opus' } }, 'bypassPermissions', {
        deny: ['Agent(model:opus)'],
      }),
    ).toBe('approve');
  });

  it('keeps a URL pattern a URL pattern — `https` is not a WebFetch parameter', () => {
    expect(
      evaluatePermission('WebFetch', { url: 'https://evil.example/x' }, 'default', {
        deny: ['WebFetch(https://evil.example/**)'],
      }),
    ).toBe('deny');
  });

  it('never grants from an allow list', () => {
    expect(
      evaluatePermission('Bash', { command: 'rm x', run_in_background: true }, 'default', {
        allow: ['Bash(run_in_background:true)'],
      }),
    ).toBe('approve');
    expect(findInvalidPermissionPatterns(['Bash(run_in_background:true)'], 'allow')).toHaveLength(1);
    expect(findInvalidPermissionPatterns(['Bash(run_in_background:true)'], 'deny')).toEqual([]);
  });

  it('a rule on the primary field asks on every call and is reported', () => {
    expect(
      evaluatePermission('Bash', { command: 'ls' }, 'bypassPermissions', {
        deny: ['Bash(command:rm *)'],
      }),
    ).toBe('approve');
    const [warning] = findPermissionPatternWarnings(['Bash(command:rm *)']);
    expect(warning?.reason).toContain('Bash(rm *)');
  });
});

describe('globs in the tool-name position', () => {
  it('a deny or ask glob names every tool of an MCP server', () => {
    expect(
      evaluatePermission('github__create_issue', {}, 'bypassPermissions', { deny: ['github__*'] }),
    ).toBe('deny');
    expect(
      evaluatePermission('github__create_issue', {}, 'bypassPermissions', { ask: ['github__*'] }),
    ).toBe('approve');
    expect(
      evaluatePermission('gitlab__create_issue', {}, 'bypassPermissions', { deny: ['github__*'] }),
    ).toBe('auto');
  });

  it('an allow glob must be anchored to a literal server prefix', () => {
    expect(findInvalidPermissionPatterns(['github__*'], 'allow')).toEqual([]);
    expect(findInvalidPermissionPatterns(['*'], 'allow')).toHaveLength(1);
    expect(findInvalidPermissionPatterns(['Read*'], 'allow')).toHaveLength(1);
    expect(findInvalidPermissionPatterns(['*'], 'deny')).toEqual([]);
    expect(
      evaluatePermission('github__create_issue', {}, 'default', { allow: ['github__*'] }),
    ).toBe('auto');
  });
});

describe('a bare-name deny removes the tool', () => {
  it('names the bare, (*) and glob forms, not an argument-scoped deny', () => {
    expect(isToolDeniedOutright('Bash', ['Bash'])).toBe(true);
    expect(isToolDeniedOutright('Bash', ['Bash(*)'])).toBe(true);
    expect(isToolDeniedOutright('github__create_issue', ['github__*'])).toBe(true);
    expect(isToolDeniedOutright('Bash', ['Bash(rm *)'])).toBe(false);
    expect(isToolDeniedOutright('Read', ['Bash'])).toBe(false);
  });
});
