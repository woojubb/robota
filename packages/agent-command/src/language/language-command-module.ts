import {
  buildLanguageCommandSubcommands,
  LANGUAGE_COMMAND_ARGUMENT_HINT,
  LANGUAGE_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import { executeLanguageCommand } from './language-command.js';

import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';

export function createLanguageCommandEntry(): ICommand {
  return {
    name: 'language',
    displayName: 'Language',
    description: LANGUAGE_COMMAND_DESCRIPTION,
    source: 'language',
    argumentHint: LANGUAGE_COMMAND_ARGUMENT_HINT,
    subcommands: buildLanguageCommandSubcommands('language'),
    modelInvocable: false,
  };
}

function createLanguageSystemCommand(): ISystemCommand {
  const entry = createLanguageCommandEntry();
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
    execute: executeLanguageCommand,
  };
}

export class LanguageCommandSource implements ICommandSource {
  readonly name = 'language';

  getCommands(): ICommand[] {
    return [createLanguageCommandEntry()];
  }
}

export function createLanguageCommandModule(): ICommandModule {
  return {
    name: 'agent-command-language',
    commandSources: [new LanguageCommandSource()],
    systemCommands: [createLanguageSystemCommand()],
  };
}
