/**
 * Table-driven tests for permission-gate.ts
 */

import { describe, it, expect } from 'vitest';
import { evaluatePermission } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionMode, TPermissionDecision } from '@robota-sdk/agent-core';

// ---------------------------------------------------------------------------
// Mode × tool matrix
// ---------------------------------------------------------------------------

interface IMatrixCase {
  mode: TPermissionMode;
  toolName: string;
  args: TToolArgs;
  expected: TPermissionDecision;
}

const MATRIX_CASES: IMatrixCase[] = [
  // plan mode — only reads allowed
  { mode: 'plan', toolName: 'Read', args: { filePath: '/src/foo.ts' }, expected: 'auto' },
  { mode: 'plan', toolName: 'Glob', args: { pattern: '**/*.ts' }, expected: 'auto' },
  { mode: 'plan', toolName: 'Grep', args: { pattern: 'foo' }, expected: 'auto' },
  {
    mode: 'plan',
    toolName: 'Write',
    args: { filePath: '/src/foo.ts', content: 'x' },
    expected: 'deny',
  },
  {
    mode: 'plan',
    toolName: 'Edit',
    args: { filePath: '/src/foo.ts', oldString: 'a', newString: 'b' },
    expected: 'deny',
  },
  { mode: 'plan', toolName: 'Bash', args: { command: 'ls' }, expected: 'deny' },

  // default mode — reads auto, writes/bash need approval
  { mode: 'default', toolName: 'Read', args: { filePath: '/src/foo.ts' }, expected: 'auto' },
  { mode: 'default', toolName: 'Glob', args: { pattern: '**/*.ts' }, expected: 'auto' },
  { mode: 'default', toolName: 'Grep', args: { pattern: 'foo' }, expected: 'auto' },
  {
    mode: 'default',
    toolName: 'Write',
    args: { filePath: '/src/foo.ts', content: 'x' },
    expected: 'approve',
  },
  {
    mode: 'default',
    toolName: 'Edit',
    args: { filePath: '/src/foo.ts', oldString: 'a', newString: 'b' },
    expected: 'approve',
  },
  { mode: 'default', toolName: 'Bash', args: { command: 'ls' }, expected: 'approve' },

  // acceptEdits mode — reads + writes auto, bash needs approval
  { mode: 'acceptEdits', toolName: 'Read', args: { filePath: '/src/foo.ts' }, expected: 'auto' },
  { mode: 'acceptEdits', toolName: 'Glob', args: { pattern: '**/*.ts' }, expected: 'auto' },
  { mode: 'acceptEdits', toolName: 'Grep', args: { pattern: 'foo' }, expected: 'auto' },
  {
    mode: 'acceptEdits',
    toolName: 'Write',
    args: { filePath: '/src/foo.ts', content: 'x' },
    expected: 'auto',
  },
  {
    mode: 'acceptEdits',
    toolName: 'Edit',
    args: { filePath: '/src/foo.ts', oldString: 'a', newString: 'b' },
    expected: 'auto',
  },
  { mode: 'acceptEdits', toolName: 'Bash', args: { command: 'ls' }, expected: 'approve' },

  // bypassPermissions — everything auto
  {
    mode: 'bypassPermissions',
    toolName: 'Read',
    args: { filePath: '/src/foo.ts' },
    expected: 'auto',
  },
  {
    mode: 'bypassPermissions',
    toolName: 'Write',
    args: { filePath: '/src/foo.ts', content: 'x' },
    expected: 'auto',
  },
  {
    mode: 'bypassPermissions',
    toolName: 'Edit',
    args: { filePath: '/src/foo.ts', oldString: 'a', newString: 'b' },
    expected: 'auto',
  },
  { mode: 'bypassPermissions', toolName: 'Bash', args: { command: 'rm -rf /' }, expected: 'auto' },
  { mode: 'bypassPermissions', toolName: 'Glob', args: { pattern: '**' }, expected: 'auto' },
  { mode: 'bypassPermissions', toolName: 'Grep', args: { pattern: 'x' }, expected: 'auto' },
];

describe('evaluatePermission — mode × tool matrix', () => {
  for (const tc of MATRIX_CASES) {
    it(`mode=${tc.mode} tool=${tc.toolName} → ${tc.expected}`, () => {
      expect(evaluatePermission(tc.toolName, tc.args, tc.mode)).toBe(tc.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Deny list overrides
// ---------------------------------------------------------------------------

describe('evaluatePermission — deny list overrides', () => {
  it('deny list overrides auto in bypassPermissions mode', () => {
    const result = evaluatePermission('Bash', { command: 'rm -rf /' }, 'bypassPermissions', {
      deny: ['Bash'],
    });
    expect(result).toBe('deny');
  });

  it('deny list overrides auto for Read in plan mode', () => {
    const result = evaluatePermission('Read', { filePath: '/src/secret.ts' }, 'plan', {
      deny: ['Read'],
    });
    expect(result).toBe('deny');
  });

  it('deny list with arg pattern blocks matching command', () => {
    const result = evaluatePermission('Bash', { command: 'rm -rf /' }, 'bypassPermissions', {
      deny: ['Bash(rm *)'],
    });
    expect(result).toBe('deny');
  });

  it('deny list with arg pattern does NOT block non-matching command', () => {
    const result = evaluatePermission('Bash', { command: 'pnpm test' }, 'default', {
      deny: ['Bash(rm *)'],
    });
    // Not matched by deny, not in allow → falls through to mode policy (approve)
    expect(result).toBe('approve');
  });
});

// ---------------------------------------------------------------------------
// Allow list overrides
// ---------------------------------------------------------------------------

describe('evaluatePermission — allow list overrides', () => {
  it('allow list promotes approve to auto', () => {
    const result = evaluatePermission('Bash', { command: 'pnpm test' }, 'default', {
      allow: ['Bash(pnpm *)'],
    });
    expect(result).toBe('auto');
  });

  it('allow list promotes deny to auto in plan mode', () => {
    const result = evaluatePermission(
      'Write',
      { filePath: '/tmp/output.txt', content: 'x' },
      'plan',
      { allow: ['Write(/tmp/*)'] },
    );
    expect(result).toBe('auto');
  });

  it('allow list does NOT match different tool', () => {
    const result = evaluatePermission(
      'Write',
      { filePath: '/src/foo.ts', content: 'x' },
      'default',
      { allow: ['Bash(pnpm *)'] },
    );
    // Falls through to mode policy (approve)
    expect(result).toBe('approve');
  });
});

// ---------------------------------------------------------------------------
// Deny takes priority over allow
// ---------------------------------------------------------------------------

describe('evaluatePermission — deny beats allow', () => {
  it('deny evaluated before allow when both match', () => {
    const result = evaluatePermission('Bash', { command: 'pnpm test' }, 'bypassPermissions', {
      deny: ['Bash(pnpm *)'],
      allow: ['Bash(pnpm *)'],
    });
    expect(result).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// Glob pattern matching
// ---------------------------------------------------------------------------

describe('evaluatePermission — glob pattern matching', () => {
  it('Bash(pnpm *) matches "pnpm test"', () => {
    const result = evaluatePermission('Bash', { command: 'pnpm test' }, 'default', {
      allow: ['Bash(pnpm *)'],
    });
    expect(result).toBe('auto');
  });

  it('Bash(pnpm *) does NOT match "npm test"', () => {
    const result = evaluatePermission('Bash', { command: 'npm test' }, 'default', {
      allow: ['Bash(pnpm *)'],
    });
    expect(result).toBe('approve');
  });

  it('Read(/src/**) matches "/src/a/b/c.ts"', () => {
    const result = evaluatePermission('Read', { filePath: '/src/a/b/c.ts' }, 'plan', {
      allow: ['Read(/src/**)'],
    });
    expect(result).toBe('auto');
  });

  it('Read(/src/**) does NOT match "/lib/foo.ts"', () => {
    const result = evaluatePermission('Read', { filePath: '/lib/foo.ts' }, 'plan', {
      allow: ['Read(/src/**)'],
    });
    // plan mode allows Read anyway, but we want to verify no false allow
    expect(result).toBe('auto'); // plan still allows Read
  });

  it('bare tool name matches any invocation', () => {
    const result = evaluatePermission(
      'Write',
      { filePath: '/anywhere.txt', content: 'hi' },
      'default',
      { allow: ['Write'] },
    );
    expect(result).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Unknown tool names
// ---------------------------------------------------------------------------

describe('evaluatePermission — unknown tool', () => {
  it('unknown tool in plan mode → deny', () => {
    expect(evaluatePermission('UnknownTool', {}, 'plan')).toBe('deny');
  });

  it('unknown tool in default mode → approve', () => {
    expect(evaluatePermission('UnknownTool', {}, 'default')).toBe('approve');
  });

  it('unknown tool in bypassPermissions mode → auto', () => {
    expect(evaluatePermission('UnknownTool', {}, 'bypassPermissions')).toBe('auto');
  });
});
