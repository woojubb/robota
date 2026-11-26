/**
 * Which surface of the secure table an invocation runs as, decided from its arguments alone before
 * any session store is built. A command is never a surface whatever flags follow it, so a locked
 * key holder is never given to a command; a run that serves or reads nothing a person asked for is
 * none either. A session started at the terminal is the terminal surface, the one a person unlocks.
 */
import { holdsNoReadKey, unlocksAtTerminal } from '@robota-sdk/agent-local-host';
import { describe, expect, it } from 'vitest';

import { processSurfaceOf } from '../process-surface.js';

const CLI = 'test-product';
const surfaceOf = (...args: string[]) => processSurfaceOf(['node', 'cli', ...args], CLI);

describe('the surfaces that only write what they seal', () => {
  it.each([
    [['-p', 'say hi'], 'print'],
    [['say hi', '-p'], 'print'],
    [['-p', '--model', 'fixture', 'say hi'], 'print'],
    [['--goal', 'finish the task'], 'print'],
    [['-p', '--', 'init'], 'print'],
    [['-p', '/context prompt'], 'print'],
    [['-p', 'hi', '--no-session-persistence'], 'print'],
    [['acp'], 'acp'],
    [['mcp', 'serve'], 'mcp-stdio'],
    [['mcp', 'serve', '--ask-client'], 'mcp-stdio'],
  ] as const)('%j runs as %s', (args, surface) => {
    expect(surfaceOf(...args)).toBe(surface);
    expect(holdsNoReadKey(surface)).toBe(true);
  });
});

describe('the terminal, which a person unlocks', () => {
  it.each([
    ['no arguments', []],
    ['a continued session', ['--continue']],
    ['a resumed session', ['--resume', 'session_abc']],
    ['a forked session', ['--continue', '--fork-session']],
    ['a first prompt typed in the terminal', ['fix the failing test']],
    ['options that shape the session', ['--model', 'fixture', '--permission-mode', 'plan']],
    ['text after the option terminator that spells a subcommand', ['--', 'usage']],
    ['text after the option terminator that spells a print flag', ['--', '-p']],
    ['a restricted workspace', ['--restricted-workspace']],
  ] as const)('%s runs as the terminal', (_label, args) => {
    expect(surfaceOf(...args)).toBe('tui');
  });

  it('is the one surface a person unlocks, and holds a key no print, acp or MCP process does', () => {
    expect(unlocksAtTerminal('tui')).toBe(true);
    expect(holdsNoReadKey('tui')).toBe(false);
    for (const surface of ['print', 'acp', 'mcp-stdio'] as const) {
      expect(unlocksAtTerminal(surface), surface).toBe(false);
    }
    expect(unlocksAtTerminal('supervised-runtime')).toBe(false);
  });
});

describe('what is no surface of its own', () => {
  it.each([
    ['usage', ['usage']],
    ['the direct user-local command', ['user-local', 'list']],
    ['the direct user-local command with a print flag', ['user-local', 'list', '-p']],
    ['the direct user-local command after a print flag', ['-p', 'user-local', 'list']],
    ['usage with a print flag', ['usage', '-p']],
    ['a session listing with a print flag', ['session', 'list', '-p']],
    ['a background session start', ['session', 'start', '--background']],
    ['a daemon start', ['daemon', 'start']],
    ['a daemon start with a print flag', ['daemon', 'start', '-p']],
    ['a keyring command', ['secure', 'status']],
    ['workspace trust', ['trust', 'status']],
    ['the doctor', ['doctor']],
    ['project setup', ['init']],
    ['an evaluation', ['eval', 'definition.ts']],
    ['an MCP login', ['mcp', 'login', 'docs']],
    ['an MCP server add', ['mcp', 'add', 'exa']],
    ['the attached terminal', ['--attach']],
    ['the attached terminal with a print flag', ['-p', '--attach']],
    ['a served runtime', ['--serve']],
    ['a served runtime with a print flag', ['--serve', '-p', 'hi']],
    ['MCP over HTTP', ['mcp', 'serve', '--http-token-file', '/tmp/robota-token']],
    ['a print flag with help', ['-p', '--help']],
    ['the version', ['--version']],
    ['a reset with a print flag', ['-p', '--reset']],
    ['an update check with a print flag', ['-p', '--check-update']],
    ['ACP with a print flag', ['acp', '-p']],
    ['MCP over stdio with a print flag', ['mcp', 'serve', '-p']],
    ['an invalid invocation', ['-p', '--no-such-flag']],
    ['a prompt that is a subcommand name, read as the subcommand', ['-p', 'session']],
  ] as const)('%s', (_label, args) => {
    expect(surfaceOf(...args)).toBeUndefined();
  });
});
