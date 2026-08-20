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
import { buildPermissionEnforcer } from '../session-components.js';

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

// ---------------------------------------------------------------------------
// ARCH-040 Group C (issue #1934) — live preset re-application
// ---------------------------------------------------------------------------

describe('PermissionEnforcer — a preset re-applied live (ARCH-040 Group C)', () => {
  /**
   * The startup preset's patterns are already in `config.permissions` when the session begins —
   * `create-session.ts` bakes them in. So the base the enforcer composes onto must be SUPPLIED, not
   * read back out of the configured rules. Review found the first cut capturing it lazily, which
   * left the first preset's allowlist in the base forever: every later switch kept permitting a tool
   * the newly chosen preset never named, while the code comment two lines above described exactly
   * that failure.
   */
  function enforcerStartedWithAPreset(): PermissionEnforcer {
    return makeEnforcer({
      config: {
        // what the session actually starts with: base + the startup preset's `First(*)`
        permissions: { allow: ['Base(*)', 'First(*)'], deny: ['BaseDenied(*)'] },
      },
      presetFreePermissions: { allow: ['Base(*)'], deny: ['BaseDenied(*)'] },
    });
  }

  it('the composition root wires the base to where the enforcer READS it', () => {
    // `makeEnforcer` above constructs the enforcer directly, so it cannot see a wiring mistake in
    // `buildPermissionEnforcer` — which is where one was: `presetFreePermissions` went INSIDE
    // `config` while the constructor reads it at the top level, so production always fell back to
    // the contaminated rules and every case here stayed green. Excess-property checking did not
    // catch it either: the conditional-spread idiom this repository uses for
    // `exactOptionalPropertyTypes` suppresses it.
    const enforcer = buildPermissionEnforcer(
      {
        permissions: { allow: ['Base(*)', 'First(*)'], deny: [] },
        presetFreePermissions: { allow: ['Base(*)'], deny: [] },
        terminal: makeNoopTerminal(),
      } as never,
      'test-session',
      '/tmp',
      () => 'default',
      undefined,
    );
    enforcer.applyPresetToolLists({ allowedTools: ['Second'] });

    expect(enforcer.currentPermissionRules().allow).toEqual(['Base(*)', 'Second(*)']);
  });

  it('an allowlist REPLACES the previous preset rather than accumulating', () => {
    const enforcer = enforcerStartedWithAPreset();
    enforcer.applyPresetToolLists({ allowedTools: ['Second'] });

    const allow = enforcer.currentPermissionRules().allow;
    expect(allow).toContain('Base(*)');
    expect(allow).toContain('Second(*)');
    // the whole finding: the startup preset's tool must be gone
    expect(allow).not.toContain('First(*)');
  });

  it('the base survives every switch, so a preset chooses among what the session permits', () => {
    const enforcer = enforcerStartedWithAPreset();
    enforcer.applyPresetToolLists({ allowedTools: ['Second'] });
    enforcer.applyPresetToolLists({ allowedTools: ['Third'] });

    const allow = enforcer.currentPermissionRules().allow;
    expect(allow).toEqual(['Base(*)', 'Third(*)']);
  });

  it('a denial UNIONS onto the base and is not dropped by a later preset', () => {
    const enforcer = enforcerStartedWithAPreset();
    enforcer.applyPresetToolLists({ deniedTools: ['Dangerous'] });
    enforcer.applyPresetToolLists({ allowedTools: ['Third'] });

    // the base denial survives; the preset denial does not outlive the preset that stated it
    expect(enforcer.currentPermissionRules().deny).toEqual(['BaseDenied(*)']);
  });
});
