/**
 * Unit tests for PermissionEnforcer session-allow behavior (CLI-030).
 *
 * Verifies that:
 *  - 'allow-session' response from permissionHandler adds tool to session allow list
 *  - Subsequent calls for the same tool are auto-approved without prompting
 *  - Session allow list is cleared by clearSessionAllowedTools()
 *  - 'allow-project' response calls onProjectAllowTool and also adds to session list
 *  - 'allow-session' response from promptForApprovalFn is handled the same way
 */

import { describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions, TPermissionResult } from '../permission-types.js';
import type { ITerminalOutput, TToolArgs } from '@robota-sdk/agent-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    cwd: '/tmp',
    getPermissionMode: () => 'default',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

const BASH_ARGS: TToolArgs = { command: 'pnpm test' };

// ---------------------------------------------------------------------------
// permissionHandler path
// ---------------------------------------------------------------------------

describe('PermissionEnforcer — permissionHandler session-allow', () => {
  it('Given allow-session response When called once Then adds tool to session list', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(enforcer.getSessionAllowedTools()).toContain('Bash');
  });

  it('Given allow-session granted earlier When called again Then handler is not called again', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Bash', BASH_ARGS);
    handler.mockClear();

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('Given session allow cleared When called again Then prompts user again', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Bash', BASH_ARGS);
    enforcer.clearSessionAllowedTools();
    handler.mockClear();
    handler.mockResolvedValue(true);

    await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('Given allow-project response When called Then calls onProjectAllowTool and adds to session', async () => {
    const onProjectAllowTool = vi.fn<[string], void>();
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-project');
    const enforcer = makeEnforcer({ permissionHandler: handler, onProjectAllowTool });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(onProjectAllowTool).toHaveBeenCalledWith('Bash');
    expect(enforcer.getSessionAllowedTools()).toContain('Bash');
  });

  it('Given deny response When called Then returns false', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue(false);
    const enforcer = makeEnforcer({ permissionHandler: handler });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(false);
    expect(enforcer.getSessionAllowedTools()).not.toContain('Bash');
  });

  it('Given allow-once response When called Then returns true without adding to session list', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue(true);
    const enforcer = makeEnforcer({ permissionHandler: handler });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(enforcer.getSessionAllowedTools()).not.toContain('Bash');
  });
});

// ---------------------------------------------------------------------------
// promptForApprovalFn path
// ---------------------------------------------------------------------------

describe('PermissionEnforcer — promptForApprovalFn session-allow', () => {
  it('Given allow-session from promptForApprovalFn When called once Then adds tool to session list', async () => {
    const promptFn = vi
      .fn<[ITerminalOutput, string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ promptForApprovalFn: promptFn });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(enforcer.getSessionAllowedTools()).toContain('Bash');
  });

  it('Given allow-session granted via promptFn When called again Then fn is not called again', async () => {
    const promptFn = vi
      .fn<[ITerminalOutput, string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ promptForApprovalFn: promptFn });

    await enforcer.checkPermission('Bash', BASH_ARGS);
    promptFn.mockClear();

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('Given allow-project from promptForApprovalFn When called Then calls onProjectAllowTool', async () => {
    const onProjectAllowTool = vi.fn<[string], void>();
    const promptFn = vi
      .fn<[ITerminalOutput, string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-project');
    const enforcer = makeEnforcer({ promptForApprovalFn: promptFn, onProjectAllowTool });

    const result = await enforcer.checkPermission('Bash', BASH_ARGS);

    expect(result).toBe(true);
    expect(onProjectAllowTool).toHaveBeenCalledWith('Bash');
  });
});

// ---------------------------------------------------------------------------
// getSessionAllowedTools
// ---------------------------------------------------------------------------

describe('PermissionEnforcer — getSessionAllowedTools', () => {
  it('Initially returns empty list', () => {
    const enforcer = makeEnforcer();
    expect(enforcer.getSessionAllowedTools()).toEqual([]);
  });

  it('After allow-session on multiple tools Returns all approved tools', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Bash', { command: 'ls' });
    await enforcer.checkPermission('Write', { filePath: '/tmp/a.txt', content: 'x' });

    const tools = enforcer.getSessionAllowedTools();
    expect(tools).toContain('Bash');
    expect(tools).toContain('Write');
  });

  it('After clearSessionAllowedTools Returns empty list again', async () => {
    const handler = vi
      .fn<[string, TToolArgs], Promise<TPermissionResult>>()
      .mockResolvedValue('allow-session');
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await enforcer.checkPermission('Bash', BASH_ARGS);
    enforcer.clearSessionAllowedTools();

    expect(enforcer.getSessionAllowedTools()).toEqual([]);
  });
});
