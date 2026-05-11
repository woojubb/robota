import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';

export function createSettingsCommandEntry(): ICommand {
  return {
    name: 'settings',
    description: 'Open transport settings — enable/disable transports and configure options',
    source: 'settings',
    modelInvocable: false,
  };
}

function createSettingsSystemCommand(): ISystemCommand {
  const entry = createSettingsCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: async () => ({
      success: true,
      message: 'Opening settings...',
      effects: [{ type: 'settings-tui-requested' as const }],
    }),
  };
}

export class SettingsCommandSource implements ICommandSource {
  readonly name = 'settings';

  getCommands(): ICommand[] {
    return [createSettingsCommandEntry()];
  }
}

export function createSettingsCommandModule(): ICommandModule {
  return {
    name: 'agent-command-settings',
    commandSources: [new SettingsCommandSource()],
    systemCommands: [createSettingsSystemCommand()],
  };
}
