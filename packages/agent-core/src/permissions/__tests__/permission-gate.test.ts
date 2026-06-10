import { describe, expect, it } from 'vitest';
import { evaluatePermission } from '../permission-gate.js';

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
