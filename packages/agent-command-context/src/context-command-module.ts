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
    description: 'Context window info',
    source: 'context',
    modelInvocable: false,
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
