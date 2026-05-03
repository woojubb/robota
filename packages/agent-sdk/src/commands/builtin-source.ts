import type { ICommandModule } from '../command-api/command-module.js';
import type { ISystemCommand } from '../command-api/index.js';
import { createSystemCommands } from './system-command.js';
import type { ICommandSource, ICommand } from '../command-api/types.js';

function commandToPaletteEntry(command: ISystemCommand): ICommand {
  return {
    name: command.name,
    description: command.description,
    source: 'builtin',
    ...(command.subcommands ? { subcommands: [...command.subcommands] } : {}),
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    ...(command.modelInvocable !== undefined ? { modelInvocable: command.modelInvocable } : {}),
    ...(command.userInvocable !== undefined ? { userInvocable: command.userInvocable } : {}),
    ...(command.safety ? { safety: command.safety } : {}),
  };
}

/** Command source for SDK-owned built-in commands. */
export class BuiltinCommandSource implements ICommandSource {
  readonly name = 'builtin';
  private readonly commands: ICommand[];

  constructor(systemCommands: readonly ISystemCommand[] = createSystemCommands()) {
    this.commands = systemCommands.map(commandToPaletteEntry);
  }

  getCommands(): ICommand[] {
    return this.commands;
  }
}

export function createBuiltinCommandModule(): ICommandModule {
  const systemCommands = createSystemCommands();
  return {
    name: 'sdk-builtin',
    commandSources: [new BuiltinCommandSource(systemCommands)],
    systemCommands,
  };
}
