import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate.js';

/**
 * CORE-030: the argument key a pattern like `Bash(pnpm *)` is matched against is declared by the
 * package that DEFINES the tool, not by a name table in this one — so these cases declare it, the
 * same way `@robota-sdk/agent-tools` does. Without a declaration an argument-scoped pattern is
 * unevaluable and the gate prompts rather than matching, which is the behaviour asserted separately
 * in `unknown-tool-deny.test.ts`.
 */
beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', { argumentKey: 'command', riskClass: 'execute' });
  registerToolPermissionProfile('Shell', { argumentKey: 'command', riskClass: 'execute' });
  registerToolPermissionProfile('Read', { argumentKey: 'filePath', riskClass: 'inspect' });
  registerToolPermissionProfile('Write', { argumentKey: 'filePath', riskClass: 'modify' });
  registerToolPermissionProfile('Edit', { argumentKey: 'filePath', riskClass: 'modify' });
  registerToolPermissionProfile('Glob', { argumentKey: 'pattern', riskClass: 'inspect' });
  registerToolPermissionProfile('Grep', { argumentKey: 'pattern', riskClass: 'inspect' });
});

afterEach(() => {
  clearRegisteredToolProfiles();
});

describe('evaluatePermission deny precedence', () => {
  it('denies a deny-listed tool even in bypassPermissions mode', () => {
    const decision = evaluatePermission('Bash', { command: 'ls' }, 'bypassPermissions', {
      deny: ['Bash(*)'],
    });
    expect(decision).toBe('deny');
  });

  it('deny wins over a matching allow pattern', () => {
    const decision = evaluatePermission('Bash', { command: 'ls' }, 'default', {
      allow: ['Bash(*)'],
      deny: ['Bash(*)'],
    });
    expect(decision).toBe('deny');
  });

  it('does not deny tools outside the deny list', () => {
    const decision = evaluatePermission('Read', { filePath: '/tmp/a' }, 'bypassPermissions', {
      deny: ['Bash(*)'],
    });
    expect(decision).not.toBe('deny');
  });

  it('bare tool-name deny pattern matches any invocation', () => {
    const decision = evaluatePermission('Glob', { pattern: '**/*.ts' }, 'bypassPermissions', {
      deny: ['Glob'],
    });
    expect(decision).toBe('deny');
  });
});
