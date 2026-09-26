/**
 * #3189 — the commands a terminal attached to a workspace daemon runs in its own process.
 *
 * The attached terminal gives them its own handoff and working directory, applies the appearance
 * patch `/theme` asks for itself, and refuses any other host action by name instead of dropping it.
 */
import { createTerminalClientCommands } from '@robota-sdk/agent-command';
import { describe, expect, it, vi } from 'vitest';

import {
  createTuiClientCommandHost,
  findTuiClientCommand,
  runTuiClientCommand,
} from '../wire-tui-client-commands.js';

import type {
  ITuiClientCommand,
  ITuiClientCommands,
  TTuiClientCommandHost,
} from '../wire-tui-client-commands.js';
import type {
  ICommandResult,
  IThemeCatalogueEntry,
  IThemeCataloguePort,
  TAppearanceSettingsPatch,
  TCommandHostAction,
} from '@robota-sdk/agent-interface-command';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

/** Stands in for `/shell`: hands the terminal to a "child" that runs in the host's directory. */
const shellLike: ITuiClientCommand = {
  name: 'shell',
  async execute(host, args) {
    if (!host.canHandoffTerminal()) {
      return { success: false, message: 'An interactive shell is unavailable here.' };
    }
    const cwd = host.getCwd();
    const ran = await host.runWithTerminal(async () => `${args} in ${cwd}`);
    return { success: true, message: ran };
  },
};

function commandReturning(name: string, result: ICommandResult): ITuiClientCommand {
  return { name, execute: () => result };
}

function hostFor(terminalHandoff?: ITerminalHandoff): TTuiClientCommandHost {
  return createTuiClientCommandHost({ terminalHandoff, cwd: '/work/project' });
}

function writerSpy() {
  return {
    writeAppearanceSettings: vi.fn(async (_patch: TAppearanceSettingsPatch) => undefined),
  };
}

const THEMES: IThemeCatalogueEntry[] = [
  { id: 'dark', name: 'Dark', appearance: 'dark', source: 'built-in' },
  { id: 'light', name: 'Light', appearance: 'light', source: 'built-in' },
];
const themeCatalogue: IThemeCataloguePort = {
  listThemes: () => THEMES,
  getTheme: (id) => THEMES.find((theme) => theme.id === id),
  getAppearance: () => ({
    settings: { theme: 'dark', syntaxHighlighting: true, reducedMotion: false },
  }),
};

describe('createTuiClientCommandHost (#3189)', () => {
  it('hands this terminal to the command and runs it in this terminal’s directory', async () => {
    const handedOff = vi.fn();
    const handoff: ITerminalHandoff = {
      canHandoffTerminal: true,
      runWithTerminal: <T>(fn: () => Promise<T>): Promise<T> => {
        handedOff();
        return fn();
      },
    };
    const host = hostFor(handoff);

    const outcome = await runTuiClientCommand(shellLike, 'ls', host, writerSpy());

    expect(handedOff).toHaveBeenCalledTimes(1);
    expect(outcome.result).toEqual({ success: true, message: 'ls in /work/project' });
    expect(host.getCommandInvocationSource()).toBe('user');
  });

  it('without a handoff it cannot take the terminal, so the command takes its refusal path', async () => {
    const host = hostFor(undefined);

    expect(host.canHandoffTerminal()).toBe(false);
    const outcome = await runTuiClientCommand(shellLike, 'ls', host, writerSpy());

    expect(outcome.result).toEqual({
      success: false,
      message: 'An interactive shell is unavailable here.',
    });
    await expect(host.runWithTerminal(async () => 'never')).rejects.toThrow(/unavailable/u);
  });
});

describe('runTuiClientCommand (#3189)', () => {
  it('/theme with no arguments opens this terminal’s theme picker and writes nothing', async () => {
    const theme = commandReturning('theme', {
      success: true,
      message: 'Opening the theme picker...',
      uiIntents: [{ type: 'show-theme-picker' }],
    });
    const writers = writerSpy();

    const outcome = await runTuiClientCommand(theme, '', hostFor(), writers);

    expect(outcome.uiIntents).toEqual([{ type: 'show-theme-picker' }]);
    expect(outcome.result).toEqual({ success: true, message: 'Opening the theme picker...' });
    expect(writers.writeAppearanceSettings).not.toHaveBeenCalled();
  });

  it('/theme light, from the real client command set, is written before the command settles', async () => {
    let finishWrite: () => void = () => undefined;
    const written: TAppearanceSettingsPatch[] = [];
    const commands: ITuiClientCommands = {
      commands: createTerminalClientCommands({ themeCatalogue }),
      writeAppearanceSettings: (patch) => {
        written.push(patch);
        return new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
      },
    };
    const theme = findTuiClientCommand(commands, 'theme');
    if (!theme) throw new Error('the client command set has no /theme');

    let settled = false;
    const running = runTuiClientCommand(theme, 'light', hostFor(), commands).then((outcome) => {
      settled = true;
      return outcome;
    });
    await vi.waitFor(() => expect(written).toEqual([{ theme: 'light' }]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    finishWrite();
    const outcome = await running;

    expect(outcome.result.success).toBe(true);
    expect(outcome.result.hostActions).toBeUndefined();
    expect(outcome.result.data).toEqual({ appearance: { theme: 'light' } });
    expect(outcome.uiIntents).toEqual([]);
  });

  it('an invalid appearance patch writes nothing and fails', async () => {
    const command = commandReturning('theme', {
      success: true,
      message: 'Applied.',
      hostActions: [
        {
          type: 'appearance-settings-patch',
          patch: { reducedMotion: 'yes' } as unknown as TAppearanceSettingsPatch,
        },
      ],
    });
    const writers = writerSpy();

    const outcome = await runTuiClientCommand(command, 'x', hostFor(), writers);

    expect(outcome.result.success).toBe(false);
    expect(outcome.result.message).toContain('invalid appearance settings patch');
    expect(outcome.uiIntents).toEqual([]);
    expect(writers.writeAppearanceSettings).not.toHaveBeenCalled();
  });

  it('a host action this terminal cannot perform is refused by name, and nothing beside it is written', async () => {
    const hostActions: TCommandHostAction[] = [
      { type: 'appearance-settings-patch', patch: { theme: 'light' } },
      { type: 'session-exit' },
    ];
    const command = commandReturning('theme', {
      success: true,
      message: 'Applied.',
      hostActions,
      uiIntents: [{ type: 'show-theme-picker' }],
    });
    const writers = writerSpy();

    const outcome = await runTuiClientCommand(command, '', hostFor(), writers);

    expect(outcome).toEqual({
      result: { success: false, message: "Cannot apply 'session-exit' on this terminal." },
      uiIntents: [],
    });
    expect(writers.writeAppearanceSettings).not.toHaveBeenCalled();
  });

  it('a write that fails turns the result into that failure', async () => {
    const command = commandReturning('theme', {
      success: true,
      message: 'Applied.',
      hostActions: [{ type: 'appearance-settings-patch', patch: { theme: 'light' } }],
    });

    const outcome = await runTuiClientCommand(command, 'light', hostFor(), {
      writeAppearanceSettings: () => Promise.reject(new Error('disk full')),
    });

    expect(outcome.result).toEqual({
      success: false,
      message: "Failed to apply 'appearance-settings-patch': disk full",
    });
  });

  it('a failed result passes through unchanged and applies nothing', async () => {
    const failed: ICommandResult = {
      success: false,
      message: 'Unknown theme "nope".',
      hostActions: [{ type: 'appearance-settings-patch', patch: { theme: 'nope' } }],
    };
    const writers = writerSpy();

    const outcome = await runTuiClientCommand(
      commandReturning('theme', failed),
      'nope',
      hostFor(),
      writers,
    );

    expect(outcome.result).toBe(failed);
    expect(outcome.uiIntents).toEqual([]);
    expect(writers.writeAppearanceSettings).not.toHaveBeenCalled();
  });
});

describe('findTuiClientCommand (#3189)', () => {
  it('finds a client command by name, and nothing without a set', () => {
    const commands: ITuiClientCommands = {
      commands: [shellLike],
      writeAppearanceSettings: () => undefined,
    };

    expect(findTuiClientCommand(commands, 'shell')).toBe(shellLike);
    expect(findTuiClientCommand(commands, 'model')).toBeUndefined();
    expect(findTuiClientCommand(undefined, 'shell')).toBeUndefined();
  });
});
