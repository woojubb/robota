/**
 * `/unlock` and `/lock` — credential actions for the person at this terminal only. Never
 * model-invocable, refused from any surface that is not that person's, and `/unlock` reads the
 * passphrase on the host's terminal inside the handoff, never through the session's input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createKeyCustodyCommandModule } from '../key-custody-command-module.js';

import type { IKeyCustodyCommandPort, IUnlockResult } from '../key-custody-command-port.js';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface/session';

function fakePort(answer: IUnlockResult = { outcome: 'unlocked', notices: [] }) {
  let unlocked = false;
  const port = {
    isUnlocked: vi.fn(() => unlocked),
    unlock: vi.fn(async () => {
      if (answer.outcome === 'unlocked') unlocked = true;
      return answer;
    }),
    lock: vi.fn(() => {
      unlocked = false;
    }),
    setUnlocked: (value: boolean) => {
      unlocked = value;
    },
  };
  return port satisfies IKeyCustodyCommandPort;
}

function handoff(enabled: boolean, onRun?: () => void): ITerminalHandoff {
  return {
    canHandoffTerminal: enabled,
    runWithTerminal: async (operation) => {
      onRun?.();
      return operation();
    },
  };
}

let session: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function start(port: IKeyCustodyCommandPort, terminal = handoff(true)): ScriptedSessionHarness {
  session = scriptedSession({
    turns: [{ text: 'unused' }],
    terminalHandoff: terminal,
    commandModules: [createKeyCustodyCommandModule(port)],
  });
  return session;
}

describe('/unlock and /lock', () => {
  it('are user-only commands whose palette and executable agree', () => {
    const module = createKeyCustodyCommandModule(fakePort());
    const palette = module.commandSources?.[0]?.getCommands() ?? [];
    expect(palette.map(({ name }) => name)).toEqual(['unlock', 'lock']);
    for (const command of [...palette, ...(module.systemCommands ?? [])]) {
      expect(command.modelInvocable, command.name).toBe(false);
      expect(command.userInvocable, command.name).toBe(true);
    }
    expect(palette[0]?.description).toMatch(/passphrase/);
    expect(palette[0]?.description).toMatch(/terminal/);
    expect(palette[1]?.description).toMatch(/\/unlock/);
  });

  it('/unlock asks once inside the terminal handoff and reports it', async () => {
    const port = fakePort({ outcome: 'unlocked', notices: ['The file has been repaired.'] });
    const runs = vi.fn();
    const result = await start(port, handoff(true, runs)).command('unlock', '');

    expect(result?.success).toBe(true);
    expect(result?.message).toMatch(/^Unlocked/);
    expect(result?.message).toContain('The file has been repaired.');
    expect(runs).toHaveBeenCalledTimes(1);
    expect(port.unlock).toHaveBeenCalledTimes(1);
  });

  it('/unlock says what happened when the keys stay locked', async () => {
    const declined = await start(fakePort({ outcome: 'declined', notices: [] })).command(
      'unlock',
      '',
    );
    expect(declined?.success).toBe(false);
    expect(declined?.message).toMatch(/not unlocked/i);
    await session?.dispose();

    const unavailable = await start(fakePort({ outcome: 'unavailable', notices: [] })).command(
      'unlock',
      '',
    );
    expect(unavailable?.success).toBe(false);
    expect(unavailable?.message).toMatch(/terminal/i);
  });

  it('/unlock asks nothing while already unlocked, and nothing without an interactive terminal', async () => {
    const open = fakePort();
    open.setUnlocked(true);
    const already = await start(open).command('unlock', '');
    expect(already?.success).toBe(true);
    expect(already?.message).toMatch(/already unlocked/i);
    expect(open.unlock).not.toHaveBeenCalled();
    await session?.dispose();

    const headless = fakePort();
    const refused = await start(headless, handoff(false)).command('unlock', '');
    expect(refused?.success).toBe(false);
    expect(refused?.message).toMatch(/interactive terminal/i);
    expect(headless.unlock).not.toHaveBeenCalled();
  });

  it('/lock drops the keys, and says so when they were not open', async () => {
    const port = fakePort();
    port.setUnlocked(true);
    const harness = start(port);

    const locked = await harness.command('lock', '');
    expect(locked?.success).toBe(true);
    expect(locked?.message).toMatch(/^Locked/);
    expect(port.lock).toHaveBeenCalledTimes(1);

    const again = await harness.command('lock', '');
    expect(again?.message).toMatch(/already locked/i);
    expect(port.lock).toHaveBeenCalledTimes(1);
  });

  it('refuses the model and a remote surface before reaching the port', async () => {
    const port = fakePort();
    port.setUnlocked(true);
    const harness = start(port);
    for (const name of ['unlock', 'lock']) {
      const byModel = await harness.session.executeModelCommand(name, '');
      expect(byModel?.success ?? false, name).toBe(false);
      const remote = await harness.session.executeCommand(name, '', 'remote');
      expect(remote?.success, name).toBe(false);
      expect(remote?.message, name).toMatch(/person at this terminal/);
    }
    expect(port.unlock).not.toHaveBeenCalled();
    expect(port.lock).not.toHaveBeenCalled();
  });
});
