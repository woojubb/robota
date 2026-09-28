import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { describe, expect, it, vi } from 'vitest';

import { startsNewTuiSession } from '../../startup/interactive-trust-prompt.js';
import { mcpServeProtocolArgs } from '../../startup/mcp-serve-invocation.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { argvCarryingSafeMode } from '../../startup/workspace-move-adapter.js';
import { resolveStartupWorkspaceProjectAccess } from '../../startup/workspace-project-composition.js';
import { runUserLocalDirectCommandIfRequested } from '../../user-local-direct-command.js';
import { parseCliArgs, subcommandWord } from '../cli-args.js';
import { optionArgv } from '../option-argv.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

const silentTerminal = {} as ITerminalOutput;

/** A host decision `resolveStartupWorkspaceProjectAccess` passes through unless a flag forces Restricted. */
const HOST_DECISION = createRestrictedWorkspaceProjectAccess('revoked', '/workspace');

describe('words after `--` are text, never a subcommand', () => {
  it('reads `robota -p -- init` as a prompt, not as `robota init`', () => {
    const args = parseCliArgs(['--safe-mode', '-p', '--', 'init']);

    expect(args.printMode).toBe(true);
    expect(args.positional).toEqual(['init']);
    expect(subcommandWord(args)).toBeUndefined();
  });

  it('still reads a subcommand given before `--`', () => {
    expect(subcommandWord(parseCliArgs(['init']))).toBe('init');
    expect(subcommandWord(parseCliArgs(['init', '--', 'extra']))).toBe('init');
  });

  it('does not reserve stdout for MCP when "mcp serve" is the prompt', () => {
    expect(mcpServeProtocolArgs(['-p', '--', 'mcp', 'serve'])).toBeUndefined();
    expect(mcpServeProtocolArgs(['mcp', 'serve'])).toBeDefined();
  });

  it('does not run the user-local command when "user-local" is the prompt', async () => {
    const args = parseCliArgs(['-p', '--', 'user-local', 'list']);

    await expect(
      runUserLocalDirectCommandIfRequested(args, '/nonexistent-robota-cwd', silentTerminal),
    ).resolves.toBe(false);
  });

  it('opens the terminal UI for `robota -- init`, since "init" is text there', () => {
    expect(startsNewTuiSession(parseCliArgs(['--', 'init']))).toBe(true);
    expect(startsNewTuiSession(parseCliArgs(['init']))).toBe(false);
  });
});

describe('flags are read only from the part of argv before `--`', () => {
  it('cuts argv at the first `--`', () => {
    expect(optionArgv(['node', 'robota', '-p', '--', '--attach'])).toEqual([
      'node',
      'robota',
      '-p',
    ]);
    expect(optionArgv(['node', 'robota', '--attach'])).toEqual(['node', 'robota', '--attach']);
  });

  it('does not start the attach command for a prompt that spells --attach', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const handled = await runPreparsedCliCommand(
        { providerDefinitions: [] },
        ['node', 'robota', '-p', '--', '--attach'],
        '/nonexistent-robota-attach-cwd',
      );
      expect(handled).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('does not force a Restricted start for a prompt that spells --safe-mode', async () => {
    const access = await resolveStartupWorkspaceProjectAccess(
      ['node', 'robota', '-p', '--', '--safe-mode'],
      '/nonexistent-robota-safe-mode-cwd',
      { projectAccess: HOST_DECISION },
    );
    expect(access).toBe(HOST_DECISION);
  });

  it("starts Restricted under an embedder's safe mode even with a prompt after `--`", async () => {
    const trusted = { status: 'trusted' } as never;
    const access = await resolveStartupWorkspaceProjectAccess(
      ['node', 'robota', '-p', '--', 'hello'],
      '/nonexistent-robota-safe-mode-cwd',
      { projectAccess: trusted, safeMode: true },
    );
    expect(access.status).toBe('restricted');
  });

  it('carries safe mode into a /cd target before any `--`, and is not fooled by prompt text', () => {
    expect(argvCarryingSafeMode(['-p', '--', 'hello'], true)).toEqual([
      '-p',
      '--safe-mode',
      '--',
      'hello',
    ]);
    expect(argvCarryingSafeMode(['--', '--safe-mode'], true)).toEqual([
      '--safe-mode',
      '--',
      '--safe-mode',
    ]);
    expect(argvCarryingSafeMode(['--safe-mode', '--', 'x'], true)).toEqual([
      '--safe-mode',
      '--',
      'x',
    ]);
  });
});
