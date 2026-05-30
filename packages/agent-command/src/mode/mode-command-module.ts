import {
  buildPermissionModeSubcommands,
  PERMISSION_MODE_ARGUMENT_HINT,
  PERMISSION_MODE_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import { executeModeCommand } from './mode-command.js';

import type {
  ICommand,
  ICommandInteractionHint,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';

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

const MODE_INTERACTION_HINTS: Record<string, ICommandInteractionHint> = {
  mode: {
    type: 'pick',
    getItems: () =>
      buildPermissionModeSubcommands().map((sub) => ({
        label: sub.name,
        value: sub.name,
        description: sub.description,
      })),
  },
};

export function createModeCommandModule(): ICommandModule {
  return {
    name: 'agent-command-mode',
    commandSources: [new ModeCommandSource()],
    systemCommands: [createModeSystemCommand()],
    interactionHints: MODE_INTERACTION_HINTS,
  };
}
