import { describe, expect, it } from 'vitest';

import { startsNewTuiSession } from '../../startup/interactive-trust-prompt.js';
import { mcpServeProtocolArgs } from '../../startup/mcp-serve-invocation.js';
import { runUserLocalDirectCommandIfRequested } from '../../user-local-direct-command.js';
import { parseCliArgs, subcommandWord } from '../cli-args.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

const silentTerminal = {} as ITerminalOutput;

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
