import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  isToolDeniedOutright,
  registerToolPermissionProfile,
} from '../permission-gate.js';

/**
 * One implementation registered under two names (`Shell` and its model-familiar alias `Bash`,
 * issue #3115). A rule naming either name governs both, so a deny cannot be sidestepped by calling
 * the name it did not spell out.
 */
beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Shell', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
    aliases: ['Bash'],
  });
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
    aliases: ['Shell'],
  });
});

afterEach(() => clearRegisteredToolProfiles());

describe('tool aliases share one set of rules', () => {
  it.each([
    ['Shell', 'Bash'],
    ['Bash', 'Shell'],
  ])('a bare deny of %s withholds %s too', (denied, alias) => {
    expect(isToolDeniedOutright(alias, [denied])).toBe(true);
    expect(isToolDeniedOutright(denied, [denied])).toBe(true);
  });

  it('a name glob reaching one alias withholds the other', () => {
    expect(isToolDeniedOutright('Shell', ['Ba*'])).toBe(true);
  });

  it('neither alias is withheld when neither is denied', () => {
    expect(isToolDeniedOutright('Shell', ['Read'])).toBe(false);
    expect(isToolDeniedOutright('Bash', ['Read'])).toBe(false);
  });

  it('an argument-scoped deny on one alias refuses the same call through the other', () => {
    const lists = { deny: ['Shell(rm *)'], allow: ['Shell', 'Bash'] };
    expect(evaluatePermission('Bash', { command: 'rm -rf build' }, 'default', lists)).toBe('deny');
    expect(evaluatePermission('Bash', { command: 'ls' }, 'default', lists)).toBe('auto');
  });

  it('an allow on one alias approves the same call through the other', () => {
    const lists = { allow: ['Bash(pnpm *)'] };
    expect(evaluatePermission('Shell', { command: 'pnpm test' }, 'default', lists)).toBe('auto');
  });

  it('a tool that declares no alias still matches only its own name', () => {
    registerToolPermissionProfile('Read', { argument: { key: 'filePath', kind: 'path' } });
    expect(isToolDeniedOutright('Read', ['Shell'])).toBe(false);
  });
});
