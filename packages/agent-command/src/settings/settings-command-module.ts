import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createSettingsCommandEntry(): ICommand {
  return {
    name: 'settings',
    displayName: 'Settings',
    description: 'Open transport settings — enable/disable transports and configure options',
    source: 'settings',
    modelInvocable: false,
  };
}

function createSettingsSystemCommand(): ISystemCommand {
  const entry = createSettingsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: async () => ({
      success: true,
      message: 'Opening settings...',
      uiIntents: [{ type: 'show-settings' as const }],
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
