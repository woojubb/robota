import { describe, expect, it, vi } from 'vitest';

import { runAcpSlashCommand } from '../acp-command-port.js';

import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IExecutionResult } from '@robota-sdk/agent-interface-session';

type TListener = (result: IExecutionResult) => void;

function session(
  execute: (
    name: string,
    args: string,
    ...rest: unknown[]
  ) => Promise<ICommandResult | null>,
) {
  const listeners = new Set<TListener>();
  return {
    executeCommand: vi.fn(execute),
    on: vi.fn((_event: 'complete', handler: TListener) => listeners.add(handler)),
    off: vi.fn((_event: 'complete', handler: TListener) => listeners.delete(handler)),
    complete: (response: string) => listeners.forEach((l) => l({ response } as IExecutionResult)),
    listenerCount: () => listeners.size,
  };
}

const signal = new AbortController().signal;

describe('runAcpSlashCommand', () => {
  it('runs the command as a transport-origin one on this machine and returns its message', async () => {
    const s = session(async () => ({ success: true, message: 'Commands: /help' }));
    await expect(runAcpSlashCommand(s, '/help', signal)).resolves.toBe('Commands: /help');
    expect(s.executeCommand).toHaveBeenCalledWith('help', '', 'remote', 'owner', 'local', {
      signal,
    });
  });

  it("hands the prompt's signal to the command, so cancelling the prompt reaches the turn it starts", async () => {
    const controller = new AbortController();
    const s = session(async () => ({ success: true, message: '', data: { sessionExecution: true } }));
    await runAcpSlashCommand(s, '/review', controller.signal);
    expect(s.executeCommand.mock.calls[0]![5]).toEqual({ signal: controller.signal });
  });

  it('splits the name from its arguments and tolerates leading whitespace', async () => {
    const s = session(async () => ({ success: true, message: 'ok' }));
    await runAcpSlashCommand(s, '  /model  gpt-5 --fast', signal);
    expect(s.executeCommand).toHaveBeenCalledWith(
      'model',
      'gpt-5 --fast',
      'remote',
      'owner',
      'local',
      { signal },
    );
  });

  it('says so for an unknown command', async () => {
    const s = session(async () => null);
    await expect(runAcpSlashCommand(s, '/nope now', signal)).resolves.toBe(
      'Unknown command "/nope".',
    );
  });

  it('asks for a command name after a bare slash without running anything', async () => {
    const s = session(async () => null);
    await expect(runAcpSlashCommand(s, '/', signal)).resolves.toContain('command name');
    expect(s.executeCommand).not.toHaveBeenCalled();
  });

  it('returns the reply of the turn a command started, and stops listening', async () => {
    const s = session(async () => {
      s.complete('Skill output');
      return { success: true, message: '', data: { sessionExecution: true } };
    });
    await expect(runAcpSlashCommand(s, '/review', signal)).resolves.toBe('Skill output');
    expect(s.listenerCount()).toBe(0);
  });

  it('stops listening when the command throws', async () => {
    const s = session(async () => {
      throw new Error('boom');
    });
    await expect(runAcpSlashCommand(s, '/x', signal)).rejects.toThrow('boom');
    expect(s.listenerCount()).toBe(0);
  });
});
