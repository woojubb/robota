import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import {
  buildPermissionModeSubcommands,
  PERMISSION_MODE_ARGUMENT_HINT,
  PERMISSION_MODE_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';
import { executeModeCommand } from './mode-command.js';

export function createModeCommandEntry(): ICommand {
  return {
    name: 'mode',
    displayName: 'Interaction Mode',
    description: PERMISSION_MODE_COMMAND_DESCRIPTION,
    source: 'mode',
    argumentHint: PERMISSION_MODE_ARGUMENT_HINT,
    subcommands: buildPermissionModeSubcommands('mode'),
    modelInvocable: false,
  };
}

function createModeSystemCommand(): ISystemCommand {
  const entry = createModeCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executeModeCommand,
  };
}

export class ModeCommandSource implements ICommandSource {
  readonly name = 'mode';

  getCommands(): ICommand[] {
    return [createModeCommandEntry()];
  }
}

export function createModeCommandModule(): ICommandModule {
  return {
    name: 'agent-command-mode',
    commandSources: [new ModeCommandSource()],
    systemCommands: [createModeSystemCommand()],
  };
}
