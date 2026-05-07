import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeContextCommand } from './context-command.js';

export function createContextCommandEntry(): ICommand {
  return {
    name: 'context',
    description: 'Context window info, reference inventory, and auto-compact controls',
    source: 'context',
    modelInvocable: false,
    argumentHint: 'list | add <path> | remove <path> | clear | auto ...',
    subcommands: [
      { name: 'list', description: 'List loaded context references', source: 'context' },
      { name: 'add', description: 'Add a file to active context references', source: 'context' },
      { name: 'remove', description: 'Remove a context reference', source: 'context' },
      { name: 'clear', description: 'Clear context references', source: 'context' },
      { name: 'auto', description: 'Inspect or change auto-compact policy', source: 'context' },
    ],
  };
}

function createContextSystemCommand(): ISystemCommand {
  const entry = createContextCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    execute: executeContextCommand,
  };
}

export class ContextCommandSource implements ICommandSource {
  readonly name = 'context';

  getCommands(): ICommand[] {
    return [createContextCommandEntry()];
  }
}

export function createContextCommandModule(): ICommandModule {
  return {
    name: 'agent-command-context',
    commandSources: [new ContextCommandSource()],
    systemCommands: [createContextSystemCommand()],
  };
}
