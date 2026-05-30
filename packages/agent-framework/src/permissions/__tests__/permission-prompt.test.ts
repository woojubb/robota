/**
 * Unit tests for permission-prompt.ts (CLI-030).
 *
 * Verifies that the terminal-based permission prompt:
 *  - Renders the 3-option menu (Allow once / Allow for this session / Deny)
 *  - Returns true  when index 0 (Allow once) is selected
 *  - Returns 'allow-session' when index 1 (Allow for this session) is selected
 *  - Returns false when index 2 (Deny) is selected
 */

import { describe, it, expect, vi } from 'vitest';

import { promptForApproval } from '../permission-prompt.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

function makeTerminal(selectResult: number): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(selectResult),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

const TOOL_ARGS = { command: 'pnpm test' };

describe('promptForApproval', () => {
  it('Given Allow once selected (index 0) Then returns true', async () => {
    const terminal = makeTerminal(0);
    const result = await promptForApproval(terminal, 'Bash', TOOL_ARGS);
    expect(result).toBe(true);
  });

  it('Given Allow for this session selected (index 1) Then returns allow-session', async () => {
    const terminal = makeTerminal(1);
    const result = await promptForApproval(terminal, 'Bash', TOOL_ARGS);
    expect(result).toBe('allow-session');
  });

  it('Given Deny selected (index 2) Then returns false', async () => {
    const terminal = makeTerminal(2);
    const result = await promptForApproval(terminal, 'Bash', TOOL_ARGS);
    expect(result).toBe(false);
  });

  it('Passes 3 options to terminal.select', async () => {
    const terminal = makeTerminal(0);
    await promptForApproval(terminal, 'Bash', TOOL_ARGS);
    expect(terminal.select).toHaveBeenCalledWith(
      ['Allow once', 'Allow for this session', 'Deny'],
      0,
    );
  });

  it('Writes tool name to terminal before prompting', async () => {
    const terminal = makeTerminal(0);
    await promptForApproval(terminal, 'Write', { filePath: '/tmp/a.ts', content: 'x' });
    expect(terminal.writeError).toHaveBeenCalledWith(expect.stringContaining('Write'));
  });

  it('Formats args correctly for no-argument tools', async () => {
    const terminal = makeTerminal(0);
    await promptForApproval(terminal, 'Glob', {});
    expect(terminal.writeLine).toHaveBeenCalledWith(expect.stringContaining('(no arguments)'));
  });
});
