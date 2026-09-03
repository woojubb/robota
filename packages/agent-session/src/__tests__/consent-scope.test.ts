/**
 * Issue #2351 — "don't ask again" is remembered per ARGUMENT SCOPE, not per tool.
 *
 * Before: approving `Bash` for `git status` allowed `rm -rf /` for the rest of the session, and the
 * project record was `Bash(*)`. Now the record is a pattern projected from the argument by kind, and
 * a materially different argument prompts again.
 */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { consentScopeFor } from '../consent-scope.js';
import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions, TPermissionHandler } from '../permission-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

registerToolPermissionProfile('Bash', {
  argument: { key: 'command', kind: 'command' },
  riskClass: 'execute',
});
registerToolPermissionProfile('Write', {
  argument: { key: 'filePath', kind: 'path' },
  riskClass: 'modify',
});
registerToolPermissionProfile('WebFetch', {
  argument: { key: 'url', kind: 'url' },
  riskClass: 'inspect',
});
registerToolPermissionProfile('Grep', {
  argument: { key: 'pattern', kind: 'text' },
  riskClass: 'inspect',
});

function makeTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/work',
    getPermissionMode: () => 'default',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeTerminal(),
    ...overrides,
  });
}

describe('consentScopeFor', () => {
  it('projects by the declared argument kind', () => {
    expect(consentScopeFor('Bash', { command: 'git status --short' })).toBe('Bash(git *)');
    expect(consentScopeFor('Write', { filePath: '/w/src/a.ts', content: '' })).toBe(
      'Write(/w/src/**)',
    );
    expect(consentScopeFor('WebFetch', { url: 'https://example.com/a?b=1' })).toBe(
      'WebFetch(https://example.com/**)',
    );
  });

  it('falls back to the tool name for text kinds, missing arguments and unprofiled tools', () => {
    expect(consentScopeFor('Grep', { pattern: 'TODO' })).toBe('Grep');
    expect(consentScopeFor('Bash', {})).toBe('Bash');
    expect(consentScopeFor('NoSuchTool', { x: 'y' })).toBe('NoSuchTool');
  });
});

describe('session consent is scoped to the argument (issue #2351)', () => {
  it('approving one command does not allow a different program', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Bash', { command: 'git status' });
    expect(enforcer.getSessionAllowedTools()).toEqual(['Bash(git *)']);

    handler.mockClear();
    await enforcer.checkPermission('Bash', { command: 'git log' });
    expect(handler, 'a same-program command prompted again').not.toHaveBeenCalled();

    await enforcer.checkPermission('Bash', { command: 'rm -rf /' });
    expect(handler, 'a different program was silently allowed').toHaveBeenCalledTimes(1);
  });

  it('approving one file allows its directory, not the filesystem', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Write', { filePath: '/w/src/a.ts', content: '' });
    handler.mockClear();

    await enforcer.checkPermission('Write', { filePath: '/w/src/b.ts', content: '' });
    expect(handler).not.toHaveBeenCalled();

    await enforcer.checkPermission('Write', { filePath: '/etc/passwd', content: '' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('project consent persists the same scope pattern', async () => {
    const onProjectAllowTool = vi.fn<(scope: string) => void>();
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue('allow-project');
    const enforcer = makeEnforcer({ permissionHandler: handler, onProjectAllowTool });

    await enforcer.checkPermission('Bash', { command: 'git push origin' });

    expect(onProjectAllowTool).toHaveBeenCalledWith('Bash(git *)');
  });
});
