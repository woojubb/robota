/**
 * Issue #3081 — the enforcer runs ONE evaluation order for every caller: ask rules and the
 * never-auto-approve set hold under bypassPermissions, and a background policy only narrows.
 */

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
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
    cwd: '/w/project',
    homeDirectory: '/home/me',
    getPermissionMode: () => 'bypassPermissions',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
  registerToolPermissionProfile('Write', {
    argument: { key: 'filePath', kind: 'path' },
    riskClass: 'modify',
  });
});

afterEach(() => clearRegisteredToolProfiles());

describe('bypassPermissions no longer proceeds past what must reach a person', () => {
  it('an ask rule asks the handler', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [], deny: [], ask: ['Bash(git push*)'] } },
      permissionHandler: handler,
    });
    await expect(enforcer.checkPermission('Bash', { command: 'git push' })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('with no approver attached, the ask is a denial', async () => {
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [], deny: [], ask: ['Bash(git push*)'] } },
    });
    await expect(enforcer.checkPermission('Bash', { command: 'git push' })).resolves.toBe(false);
    await expect(enforcer.checkPermission('Bash', { command: 'git status' })).resolves.toBe(true);
  });

  it('removing the home directory is not auto-approved', async () => {
    const enforcer = makeEnforcer();
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf ~' })).resolves.toBe(false);
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf build' })).resolves.toBe(true);
  });

  it('writing a settings file is not auto-approved', async () => {
    const enforcer = makeEnforcer();
    await expect(
      enforcer.checkPermission('Write', { filePath: '/w/project/.robota/settings.json' }),
    ).resolves.toBe(false);
  });

  it('a malformed ask rule is refused at construction', () => {
    expect(() =>
      makeEnforcer({ config: { permissions: { allow: [], deny: [], ask: ['Bash(git push'] } } }),
    ).toThrow(/permissions\.allow\/deny\/ask/);
  });
});

describe('a background policy only narrows the shared order', () => {
  it('`inherit-allowlist` asks about a never-auto call inside its ceiling', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({
      permissionPolicy: 'inherit-allowlist',
      config: { permissions: { allow: ['Bash'], deny: [] } },
      permissionHandler: handler,
    });
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf ~' })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('`inherit-allowlist` denies outside its ceiling without asking', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({
      permissionPolicy: 'inherit-allowlist',
      config: { permissions: { allow: ['Write'], deny: [] } },
      permissionHandler: handler,
    });
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf ~' })).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('a remembered consent never answers a call that must reach a person', () => {
  it('"allow always" for `rm -rf build` does not approve `rm -rf ~`', async () => {
    const handler = vi.fn().mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({
      getPermissionMode: () => 'default',
      permissionHandler: handler,
    });
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf build' })).resolves.toBe(true);
    handler.mockResolvedValue(false);
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf ~' })).resolves.toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
    // The ordinary remembered scope still answers an ordinary call.
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf dist' })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('"allow always" for `git status` does not answer the `git push` ask rule', async () => {
    const handler = vi.fn().mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({
      getPermissionMode: () => 'default',
      config: { permissions: { allow: [], deny: [], ask: ['Bash(git push*)'] } },
      permissionHandler: handler,
    });
    await enforcer.checkPermission('Bash', { command: 'git status' });
    handler.mockResolvedValue(false);
    await expect(enforcer.checkPermission('Bash', { command: 'git push' })).resolves.toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('an "allow always" answer to a protected write is not remembered', async () => {
    const handler = vi.fn().mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });
    const filePath = '/w/project/.robota/settings.json';
    await expect(enforcer.checkPermission('Write', { filePath })).resolves.toBe(true);
    expect(enforcer.getSessionAllowedTools()).toEqual([]);
    handler.mockResolvedValue(false);
    await expect(enforcer.checkPermission('Write', { filePath })).resolves.toBe(false);
  });
});

describe('a bare-name deny hides the tool (issue #3081)', () => {
  it('is read live from the current deny list', () => {
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [], deny: ['Bash', 'Write(/w/project/secret/**)'] } },
    });
    expect(enforcer.isToolVisible('Bash')).toBe(false);
    expect(enforcer.isToolVisible('Write')).toBe(true);
    enforcer.applyPresetToolLists({ deniedTools: ['Write'] });
    expect(enforcer.isToolVisible('Write')).toBe(false);
  });

  it('registers wrapped tool parameters so a parameter rule applies', async () => {
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [], deny: ['Bash(run_in_background:true)'] } },
    });
    enforcer.wrapTools([
      {
        schema: {
          name: 'Bash',
          description: 'shell',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' }, run_in_background: { type: 'boolean' } },
          },
        },
        execute: vi.fn(),
      } as unknown as Parameters<PermissionEnforcer['wrapTools']>[0][number],
    ]);
    await expect(
      enforcer.checkPermission('Bash', { command: 'sleep 9', run_in_background: true }),
    ).resolves.toBe(false);
    await expect(enforcer.checkPermission('Bash', { command: 'sleep 9' })).resolves.toBe(true);
  });
});

describe('parameter rules on tools whose parameters arrive with the schema (issue #3081)', () => {
  it('construct, then apply once the tools are wrapped — on argument-less and URL tools too', async () => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Agent', { riskClass: 'execute' });
    registerToolPermissionProfile('WebFetch', {
      argument: { key: 'url', kind: 'url' },
      riskClass: 'inspect',
    });
    const enforcer = makeEnforcer({
      config: {
        permissions: { allow: [], deny: ['Agent(model:opus*)', 'WebFetch(prompt:*secret*)'] },
      },
    });
    const tool = (name: string, properties: Record<string, object>) =>
      ({
        schema: { name, description: name, parameters: { type: 'object', properties } },
        execute: vi.fn(),
      }) as unknown as Parameters<PermissionEnforcer['wrapTools']>[0][number];
    enforcer.wrapTools([
      tool('Agent', { model: { type: 'string' }, prompt: { type: 'string' } }),
      tool('WebFetch', { url: { type: 'string' }, prompt: { type: 'string' } }),
    ]);
    await expect(enforcer.checkPermission('Agent', { model: 'opus-4', prompt: 'x' })).resolves.toBe(
      false,
    );
    await expect(enforcer.checkPermission('Agent', { model: 'haiku', prompt: 'x' })).resolves.toBe(
      true,
    );
    await expect(
      enforcer.checkPermission('WebFetch', { url: 'https://a.example/', prompt: 'the secret' }),
    ).resolves.toBe(false);
  });

  it('a live preset cannot add an unanchored allow glob', () => {
    const enforcer = makeEnforcer();
    expect(() => enforcer.applyPresetToolLists({ allowedTools: ['*'] })).toThrow(/allowedTools/);
    expect(enforcer.currentPermissionRules().allow).toEqual([]);
  });
});

describe('recent denials (issue #3082)', () => {
  it('records why each refused call was refused, most recent first', async () => {
    const enforcer = makeEnforcer({
      getPermissionMode: () => 'default',
      config: { permissions: { allow: [], deny: ['Bash(rm *)'], ask: [] } },
    });
    await enforcer.checkPermission('Bash', { command: 'rm -rf build' });
    // No approver attached: the ask fails closed.
    await enforcer.checkPermission('Write', { filePath: '/w/project/a.txt' });
    const withHandler = makeEnforcer({
      getPermissionMode: () => 'default',
      permissionHandler: vi.fn().mockResolvedValue(false),
    });
    await withHandler.checkPermission('Bash', { command: 'git push' });

    expect(
      enforcer
        .getRecentDenials()
        .map(({ toolName, argument, reason }) => ({ toolName, argument, reason })),
    ).toEqual([
      { toolName: 'Write', argument: '/w/project/a.txt', reason: 'no-approver' },
      { toolName: 'Bash', argument: 'rm -rf build', reason: 'policy' },
    ]);
    expect(withHandler.getRecentDenials()).toEqual([
      expect.objectContaining({ toolName: 'Bash', argument: 'git push', reason: 'user' }),
    ]);
  });

  it('records nothing for an allowed call and keeps only the latest entries', async () => {
    const enforcer = makeEnforcer({
      getPermissionMode: () => 'default',
      config: { permissions: { allow: ['Bash(ls*)'], deny: ['Bash(rm *)'], ask: [] } },
    });
    await enforcer.checkPermission('Bash', { command: 'ls' });
    expect(enforcer.getRecentDenials()).toEqual([]);
    for (let i = 0; i < 25; i++) await enforcer.checkPermission('Bash', { command: `rm f${i}` });
    const denials = enforcer.getRecentDenials();
    expect(denials).toHaveLength(20);
    expect(denials[0]?.argument).toBe('rm f24');
  });
});

describe('a turn cancelled before anyone is asked (issue #3082)', () => {
  it('is not recorded as a refusal', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({
      getPermissionMode: () => 'default',
      permissionHandler: handler,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      enforcer.checkPermission('Bash', { command: 'git push' }, controller.signal),
    ).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(enforcer.getRecentDenials()).toEqual([]);
  });
});
