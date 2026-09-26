/**
 * #3189 — the commands a terminal attached to a workspace daemon runs in its own process.
 *
 * The attached terminal routes by this set, not by the daemon's catalog, so the set must name exactly
 * the commands the default assembly marks `runner: 'client'` — a command in one list and not the
 * other would either run on the daemon or never run at all. And each client command must answer as
 * the in-process command does, because it is the same command running somewhere else.
 */
import { describe, expect, it, vi } from 'vitest';

import { createDefaultCommandModules } from '../../default/index.js';
import { createEditorCommandModule } from '../../editor/index.js';
import { createKeybindingsCommandModule } from '../../keybindings/index.js';
import { createShellCommandModule } from '../../shell/index.js';
import { createThemeCommandModule } from '../../theme/index.js';
import { createTerminalClientCommands } from '../terminal-client-commands.js';

import type { ITerminalClientCommand } from '../terminal-client-commands.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  ICommandHostContext,
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
  ICommandModule,
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import type {
  IThemeCatalogueEntry,
  IThemeCataloguePort,
} from '@robota-sdk/agent-interface-command';

const providerDefinitions: readonly IProviderDefinition[] = [];
const providerSettingsAdapter: IProviderCommandSettingsAdapter = {
  readMergedSettings: () => ({}) as TProviderSettingsDocument,
  readTargetSettings: () => ({}) as TProviderSettingsDocument,
  writeTargetSettings: () => undefined,
};

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

function allPortsGiven(): readonly ITerminalClientCommand[] {
  return createTerminalClientCommands({
    keybindingsFile: { ensureFile: async () => '/tmp/keybindings.json' },
    themeCatalogue,
  });
}

function find(commands: readonly ITerminalClientCommand[], name: string): ITerminalClientCommand {
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) throw new Error(`no terminal client command "${name}"`);
  return command;
}

/** A terminal the command cannot take over: a host with no interactive TTY. */
function hostWithoutTerminal(): ICommandHostTerminalHandoff & ICommandHostWorkspace {
  return {
    canHandoffTerminal: () => false,
    runWithTerminal: vi.fn(async () => {
      throw new Error('a refused handoff must not be attempted');
    }),
    getCwd: () => '/tmp',
    getCommandInvocationSource: () => 'user',
  };
}

/** What the in-process command answers for the same host and arguments. */
async function inProcess(module: ICommandModule, host: unknown, args: string) {
  const command = module.systemCommands?.[0];
  if (!command) throw new Error(`module ${module.name} has no command`);
  return command.execute(host as ICommandHostContext, args);
}

describe('createTerminalClientCommands (#3189)', () => {
  it('names exactly the commands the default assembly marks as client-run', () => {
    const { modules } = createDefaultCommandModules({
      cwd: '/tmp',
      userLocalStorageRoot: '/tmp/robota-test',
      providerDefinitions,
      providerSettingsAdapter,
    });
    const clientRun = modules
      .flatMap((module) => module.systemCommands ?? [])
      .filter((command) => command.runner === 'client')
      .map((command) => command.name)
      .sort();

    expect(clientRun.length).toBeGreaterThan(0);
    expect(
      allPortsGiven()
        .map((command) => command.name)
        .sort(),
    ).toEqual(clientRun);
  });

  it('/shell refuses a host that cannot hand off the terminal exactly as the in-process command does', async () => {
    const host = hostWithoutTerminal();

    const client = await find(allPortsGiven(), 'shell').execute(host, 'ls');

    expect(client).toEqual(await inProcess(createShellCommandModule(), host, 'ls'));
    expect(client.success).toBe(false);
    expect(host.runWithTerminal).not.toHaveBeenCalled();
  });

  it('/editor and /keybindings refuse a host without a terminal as their in-process commands do', async () => {
    const keybindingsFile = { ensureFile: vi.fn(async () => '/tmp/keybindings.json') };
    const commands = createTerminalClientCommands({ keybindingsFile, themeCatalogue });

    const editorHost = hostWithoutTerminal();
    const editor = await find(commands, 'editor').execute(editorHost, 'draft');
    expect(editor).toEqual(await inProcess(createEditorCommandModule(), editorHost, 'draft'));
    expect(editor.success).toBe(false);

    const keybindingsHost = hostWithoutTerminal();
    const keybindings = await find(commands, 'keybindings').execute(keybindingsHost, '');
    expect(keybindings).toEqual(
      await inProcess(createKeybindingsCommandModule(keybindingsFile), keybindingsHost, ''),
    );
    expect(keybindings.success).toBe(false);
    expect(keybindingsFile.ensureFile).not.toHaveBeenCalled();
  });

  it('/theme with no arguments asks the terminal to open its theme picker', async () => {
    const result = await find(allPortsGiven(), 'theme').execute(hostWithoutTerminal(), '');

    expect(result).toMatchObject({ success: true, uiIntents: [{ type: 'show-theme-picker' }] });
    expect(result.hostActions).toBeUndefined();
  });

  it('/theme with a known id returns one appearance settings patch for the terminal to write', async () => {
    const result = await find(allPortsGiven(), 'theme').execute(hostWithoutTerminal(), 'light');

    expect(result.success).toBe(true);
    expect(result.hostActions).toEqual([
      { type: 'appearance-settings-patch', patch: { theme: 'light' } },
    ]);
    expect(result).toEqual(await inProcess(createThemeCommandModule(themeCatalogue), {}, 'light'));
  });

  it('without their ports, /keybindings and /theme still run on the terminal and answer as in-process', async () => {
    const commands = createTerminalClientCommands({});
    // The set does not shrink: a command missing from it would be sent to the daemon instead.
    expect(commands.map((command) => command.name).sort()).toEqual(
      allPortsGiven()
        .map((command) => command.name)
        .sort(),
    );

    const host = hostWithoutTerminal();
    expect(await find(commands, 'keybindings').execute(host, '')).toEqual(
      await inProcess(createKeybindingsCommandModule(undefined), host, ''),
    );
    expect(await find(commands, 'theme').execute(host, 'light')).toEqual(
      await inProcess(createThemeCommandModule(undefined), host, 'light'),
    );
  });
});
