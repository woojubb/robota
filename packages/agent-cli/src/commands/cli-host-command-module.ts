import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';

function createPluginEntry(): ICommand {
  return {
    name: 'plugin',
    description: 'Manage plugins',
    source: 'cli',
    modelInvocable: false,
    argumentHint: 'manage',
  };
}

function createReloadPluginsEntry(): ICommand {
  return {
    name: 'reload-plugins',
    description: 'Reload all plugin resources',
    source: 'cli',
    modelInvocable: false,
  };
}

function createExitEntry(): ICommand {
  return {
    name: 'exit',
    description: 'Exit CLI',
    source: 'cli',
    modelInvocable: false,
  };
}

class CliHostCommandSource implements ICommandSource {
  readonly name = 'cli-host';

  getCommands(): ICommand[] {
    return [createPluginEntry(), createReloadPluginsEntry(), createExitEntry()];
  }
}

function createPluginSystemCommand(): ISystemCommand {
  const entry = createPluginEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    execute: (_session, _args) => ({
      success: true,
      message: 'Opening plugin manager...',
      effects: [{ type: 'plugin-tui-requested' }],
    }),
  };
}

function createReloadPluginsSystemCommand(): ISystemCommand {
  const entry = createReloadPluginsEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    execute: (_session, _args) => ({
      success: true,
      message: 'Plugins reload complete.',
    }),
  };
}

function createExitSystemCommand(): ISystemCommand {
  const entry = createExitEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    execute: (_session, _args) => ({
      success: true,
      message: 'Exit requested.',
      effects: [{ type: 'session-exit-requested' }],
    }),
  };
}

export function createCliHostCommandModule(): ICommandModule {
  return {
    name: 'cli-host',
    commandSources: [new CliHostCommandSource()],
    systemCommands: [
      createPluginSystemCommand(),
      createReloadPluginsSystemCommand(),
      createExitSystemCommand(),
    ],
  };
}
