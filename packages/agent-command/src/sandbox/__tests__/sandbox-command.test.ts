import { describe, expect, it, vi } from 'vitest';

import { executeSandboxCommand } from '../sandbox-command.js';

import type {
  ICommandSandboxAdapter,
  ICommandSandboxStatus,
  TSandboxCommandMode,
} from '@robota-sdk/agent-framework';

/** Issue #3082 — `/sandbox` shows and changes how shell commands are confined. */
function contextWith(
  status: Partial<ICommandSandboxStatus>,
  answer?: string,
): { context: Parameters<typeof executeSandboxCommand>[0]; setMode: ReturnType<typeof vi.fn> } {
  let current: ICommandSandboxStatus = {
    mode: 'off',
    backend: 'bubblewrap',
    network: false,
    excludedCommands: [],
    ...status,
  };
  const setMode = vi.fn((mode: TSandboxCommandMode) => {
    current = { ...current, mode };
  });
  const adapter: ICommandSandboxAdapter = { status: () => current, setMode };
  const ui =
    answer === undefined
      ? undefined
      : { ask: vi.fn().mockResolvedValue({ type: 'answer', values: [answer] }) };
  return {
    context: {
      getCommandHostAdapters: () => ({ sandbox: adapter }),
      getUserInteraction: () => ui,
    } as never,
    setMode,
  };
}

describe('/sandbox', () => {
  it('shows the current state when no mode is given and nobody is asked', async () => {
    const { context } = contextWith({ mode: 'auto-allow', excludedCommands: ['docker'] });
    const result = await executeSandboxCommand(context, '');
    expect(result.message).toContain('Sandbox: auto-allow (bubblewrap)');
    expect(result.message).toContain('Network: blocked.');
    expect(result.message).toContain('Run unconfined: docker.');
  });

  it('sets a mode named on the command line', async () => {
    const { context, setMode } = contextWith({});
    const result = await executeSandboxCommand(context, 'regular');
    expect(setMode).toHaveBeenCalledWith('regular');
    expect(result.message).toContain('Sandbox mode set to: regular');
  });

  it('asks for a mode through the picker', async () => {
    const { context, setMode } = contextWith({}, 'auto-allow');
    await executeSandboxCommand(context, '');
    expect(setMode).toHaveBeenCalledWith('auto-allow');
  });

  it('says what is missing when the backend cannot run', async () => {
    const { context } = contextWith({ mode: 'auto-allow', unavailable: 'missing bubblewrap' });
    const result = await executeSandboxCommand(context, '');
    expect(result.message).toContain(
      'Cannot run here: missing bubblewrap. Commands run unconfined.',
    );
  });

  it('refuses an unknown mode and a host without a sandbox', async () => {
    const { context, setMode } = contextWith({});
    expect((await executeSandboxCommand(context, 'loose')).success).toBe(false);
    expect(setMode).not.toHaveBeenCalled();
    const bare = {
      getCommandHostAdapters: () => ({}),
      getUserInteraction: () => undefined,
    } as never;
    expect((await executeSandboxCommand(bare, '')).message).toBe('This host has no OS sandbox.');
  });
});
